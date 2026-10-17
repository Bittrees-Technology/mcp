import { randomUUID } from 'node:crypto';
export const CADENCE_MS = 300000;
export const STALE_MS = 900000;
export class Operations {
  constructor(engine, {clock=Date.now}={}) { this.engine=engine; this.store=engine.store; this.clock=clock; }
  async tick(resolveActor, source) {
    const id=randomUUID(), startedAt=this.clock();
    const acquired=await this.store.transaction(state=>{
      const ops=state.operations??={};
      if(ops.worker?.leaseUntil>startedAt)return false;
      ops.worker={...ops.worker,attemptId:id,startedAt,leaseUntil:startedAt+180000,source,state:'running'};
      return true;
    });
    if(!acquired)return {skipped:true,reason:'Worker already running'};
    try {
      const result=await this.engine.tick(resolveActor);
      await this.store.transaction(state=>{
        const w=state.operations?.worker;if(w?.attemptId!==id)return;
        const finishedAt=this.clock();
        Object.assign(w,{...(source==='vercel-cron'?{lastCronSuccessAt:finishedAt}:{}),state:'succeeded',leaseUntil:0,finishedAt,lastSuccessAt:finishedAt,lastError:null,
          lastResult:result, samples:[...(w.samples??[]),{startedAt,finishedAt,source}].slice(-12)});
      });
      return result;
    } catch(error) {
      try {await this.store.transaction(state=>{const w=state.operations?.worker;if(w?.attemptId===id)Object.assign(w,{state:'failed',leaseUntil:0,finishedAt:this.clock(),lastError:'Worker failed; inspect protected deployment logs'});});}catch{}
      throw error;
    }
  }
  async snapshot() {
    return this.store.transaction(state=>{
      const now=this.clock(),w=state.operations?.worker;
      const age=w?.lastSuccessAt?Math.max(0,now-w.lastSuccessAt):null;
      const samples=w?.samples??[];
      return {state:!w?'not-observed':w.state==='failed'?'failed':w.state==='running'&&w.leaseUntil<=now?'stalled':age===null?'awaiting-first-success':age>STALE_MS?'stale':'healthy',
        scheduledState:!w?.lastCronSuccessAt?'not-observed':now-w.lastCronSuccessAt>STALE_MS?'stale':'healthy',
        lastScheduledSuccessAt:w?.lastCronSuccessAt??null,expectedIntervalSeconds:CADENCE_MS/1000,staleAfterSeconds:STALE_MS/1000,
        lastStartedAt:w?.startedAt??null,lastFinishedAt:w?.finishedAt??null,lastSuccessAt:w?.lastSuccessAt??null,
        ageSeconds:age===null?null:Math.floor(age/1000),source:w?.source??null,
        observedIntervalsSeconds:samples.slice(1).map((s,i)=>Math.round((s.startedAt-samples[i].startedAt)/1000)),
        jobOutcomes:w?.lastResult??null, jobState:!w?.lastResult?'not-observed':(w.lastResult.blocked||w.lastResult.deferred||w.lastResult.jobFailures)?'needs-attention':'no-enqueue-blockers',
        lastError:w?.lastError??null};
    });
  }
  async privateMetrics(actor) {
    return this.store.transaction(state=>{
      const owns=row=>row.tenant===actor.tenant && row.subject===actor.subject;
      const runs=Object.values(state.runs).filter(owns);
      const pending=runs.filter(r=>['queued','retrying','deferred','dispatch_pending','uncertain'].includes(r.status));
      return {runs:runs.length,auditEntries:state.audit.filter(owns).length, pendingCount:pending.length,blockedCount:runs.filter(r=>["denied","failed"].includes(r.status)).length,
        oldestDueAt:pending.length?Math.min(...pending.map(r=>r.scheduledFor??r.nextAt??r.createdAt)):null,
        recordLimit:10000, retention:"Operator-reviewed archival required; no automatic deletion",
        oldestPendingAt:pending.length?Math.min(...pending.map(r=>r.createdAt)):null};
    });
  }
}
