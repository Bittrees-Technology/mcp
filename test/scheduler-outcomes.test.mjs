import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/service/engine.mjs';
import {emptyState} from '../src/service/store.mjs';
import {Operations} from '../src/service/operations.mjs';
import {runtime} from '../src/service/runtime.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
async function fixture(){
 let now=Date.now();let state=emptyState();
 const store={transaction:async fn=>{const copy=structuredClone(state);const result=await fn(copy);state=copy;return result;}};
 const engine=new Engine(store,{clock:()=>now});
 const actor={tenant:'test',subject:'owner',audience:'https://mcp.bittrees.org',expiresAt:now+86400000,projectIds:['agent'],permissions:['profile:write','rule:write','automation:write','automation:read','automation:execute']};
 const automation=await engine.act(actor,'automation.setup',{projectId:'agent',intervalSeconds:3600,idempotencyKey:'scheduled'});
 await engine.act(actor,'resume',{id:automation.id});now+=3600000;
 return {engine,actor,store,get state(){return state},advance:ms=>now+=ms,now:()=>now};
}
test('temporary enqueue failure remains visible and retries one stable occurrence',async()=>{
 const f=await fixture(),original=f.engine.enqueue.bind(f.engine);let calls=0;
 f.engine.enqueue=async(...args)=>{if(++calls===1)throw Object.assign(Error('private provider message'),{transient:true});return original(...args)};
 const ops=new Operations(f.engine,{clock:f.now});
 const first=await ops.tick(()=>f.actor,'vercel-cron');assert.equal(first.deferred,1);assert.equal(first.queued,0);
 const run=Object.values(f.state.runs)[0],due=Object.values(f.state.automations)[0].nextAt;
 assert.equal(run.status,'deferred');assert.equal(run.scheduledFor,due);assert.equal((await ops.snapshot()).jobState,'needs-attention');assert.ok(!JSON.stringify(run).includes('private provider'));
 await f.engine.tick(()=>f.actor);assert.equal(calls,1);
 f.advance(300000);const second=await f.engine.tick(()=>f.actor);assert.equal(second.queued,1);assert.equal(Object.keys(f.state.runs).length,1);assert.equal(f.state.runs[run.id].status,'succeeded');
 await f.engine.tick(()=>f.actor);assert.equal(Object.keys(f.state.runs).length,1);
});
test('explicit denial is recorded without transient retry; revocation denies pending retry',async()=>{
 const f=await fixture();await f.engine.tick(()=>null);assert.equal(Object.values(f.state.runs)[0].status,'denied');
 const g=await fixture();g.engine.enqueue=async()=>{throw Object.assign(Error(),{transient:true})};await g.engine.tick(()=>g.actor);g.advance(300000);await g.engine.tick(()=>null);assert.equal(Object.values(g.state.runs)[0].status,'denied');assert.equal(Object.keys(g.state.runs).length,1);
});
test('temporary enqueue retries are bounded; cancel ends a deferred occurrence',async()=>{
 const f=await fixture();f.engine.enqueue=async()=>{throw Object.assign(Error(),{statusCode:503})};
 await f.engine.tick(()=>f.actor);f.advance(300000);await f.engine.tick(()=>f.actor);f.advance(600000);await f.engine.tick(()=>f.actor);
 assert.equal(Object.values(f.state.runs)[0].status,'failed');assert.equal(Object.values(f.state.runs)[0].enqueueAttempts.length,3);
 const g=await fixture();g.engine.enqueue=f.engine.enqueue;await g.engine.tick(()=>g.actor);await g.engine.act(g.actor,'cancel',{id:Object.values(g.state.automations)[0].id});assert.equal(Object.values(g.state.runs)[0].status,'cancelled');
});
test('cold database outage preserves public pages, status and empty notification response',async()=>{
 const handler=await runtime({NODE_ENV:'production',MCP_DATABASE_URL:'postgres://unavailable:unavailable@127.0.0.1:1/unavailable'});
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/connect')).status,200);
  const status=await fetch(base+'/status.json');assert.equal(status.status,503);assert.equal((await status.json()).storage,'unavailable');
  const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});assert.equal(r.status,202);assert.equal(await r.text(),'');
  assert.equal((await fetch(base+'/v1/history')).status,503);
 }finally{server.close();await once(server,'close');}
});
test('worker time budget holds remaining occurrences for a later tick without dropping them',async()=>{
 const f=await fixture();let wall=0;f.engine.wallClock=()=>wall;
 const original=f.engine.enqueue.bind(f.engine);f.engine.enqueue=async(...args)=>{const run=await original(...args);wall=46000;return run};
 const first=await f.engine.tick(()=>f.actor);assert.equal(first.queued,1);assert.equal(first.processed,0);assert.equal(Object.values(f.state.runs)[0].status,'queued');
 f.engine.enqueue=original;wall=0;await f.engine.tick(()=>f.actor);assert.equal(Object.values(f.state.runs)[0].status,'succeeded');
});
test('AI worker reserves enough time for a full lease and finalization',async()=>{
 const {AiWorker}=await import('../src/service/ai-worker.mjs');let wall=0;
 const state=emptyState();for(const id of ['one','two','three']){state.runs[id]={};state.aiDispatchOutbox[id]={state:'queued',intent:{}};}
 const worker=new AiWorker({transaction:async fn=>fn(state)},{transport:{},resolveActor:()=>null,catalog:{}});worker.authorized=()=>true;
 let attempts=0;worker.outbox.process=async id=>{attempts++;wall+=30000;state.aiDispatchOutbox[id].state='accepted';};
 assert.equal(await worker.tick({deadline:60000,wallClock:()=>wall}),1);assert.equal(attempts,1);assert.equal(state.aiDispatchOutbox.two.state,'queued');
});
