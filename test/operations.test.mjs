import test from 'node:test';
import assert from 'node:assert/strict';
import {Operations,STALE_MS} from '../src/service/operations.mjs';
import {emptyState} from '../src/service/store.mjs';
import {createMcpHandler} from '../src/service/http.mjs';
import {serviceStatus} from '../src/service/status.mjs';
import {CATALOG} from '../src/ecosystem/catalog.mjs';
import {createServer} from 'node:http';import {once} from 'node:events';
function fixture(tick=async()=>({processed:0})){const state=emptyState();let now=1000000;return {state,setNow:v=>now=v,operations:new Operations({store:{transaction:async fn=>fn(state)},tick},{clock:()=>now})};}
test('heartbeat preserves records and shows missing, healthy, stale, failed and stalled states',async()=>{
 const f=fixture();f.state.profiles.private={tenant:'private'};
 assert.equal((await f.operations.snapshot()).state,'not-observed');
 await f.operations.tick(()=>null,'vercel-cron');assert.equal((await f.operations.snapshot()).state,'healthy');
 f.setNow(1300000);await f.operations.tick(()=>null,'vercel-cron');assert.deepEqual((await f.operations.snapshot()).observedIntervalsSeconds,[300]);
 f.setNow(1300000+STALE_MS+1);assert.equal((await f.operations.snapshot()).state,'stale');
 f.operations.engine.tick=async()=>{throw Error('secret provider response')};await assert.rejects(f.operations.tick(()=>null,'manual-worker'));
 const failed=await f.operations.snapshot();assert.equal(failed.state,'failed');assert.ok(!JSON.stringify(failed).includes('secret'));assert.ok(!JSON.stringify(failed).includes('private'));
 f.state.operations.worker.state='running';f.state.operations.worker.leaseUntil=0;assert.equal((await f.operations.snapshot()).state,'stalled');assert.equal(f.state.profiles.private.tenant,'private');
});
test('overlapping ticks are skipped, expired lease recovers, sample history is bounded',async()=>{
 let release;const f=fixture(()=>new Promise(r=>release=r));const first=f.operations.tick(()=>null,'vercel-cron');await new Promise(r=>setImmediate(r));
 assert.equal((await f.operations.tick(()=>null,'vercel-cron')).skipped,true);release({});await first;
 f.state.operations.worker.state='running';f.state.operations.worker.leaseUntil=0;
 f.operations.engine.tick=async()=>({});await f.operations.tick(()=>null,'vercel-cron');assert.equal((await f.operations.snapshot()).state,'healthy');for(let i=0;i<20;i++){f.setNow(2000000+i*300000);await f.operations.tick(()=>null,'vercel-cron');}
 assert.equal(f.state.operations.worker.samples.length,12);
});
test('cron and manual secrets are separate; status reports configuration without claiming activation',async()=>{
 const f=fixture();const engine=f.operations.engine;
 const server=createServer(createMcpHandler({engine,cronToken:'dedicated-cron',workerToken:'dedicated-worker'}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [path,method,token,status] of [['/internal/cron','GET','',401],['/internal/cron','GET','dedicated-worker',401],['/internal/cron','POST','dedicated-cron',405],['/internal/tick','POST','dedicated-cron',401],['/internal/cron','GET','dedicated-cron',200]])assert.equal((await fetch(base+path,{method,headers:token?{authorization:'Bearer '+token}:{}})).status,status);
 const r=await(await fetch(base+'/status.json')).json();assert.equal(r.scheduler.provider,'vercel-cron');assert.equal(r.scheduler.state,'healthy');assert.equal(r.capabilities.aiAutomation,'not-configured');assert.equal(r.capabilities.roles.consumerEnforcement,'not-integrated');
 }finally{server.close();await once(server,'close');}
 const r=await serviceStatus({catalog:CATALOG,operations:{snapshot:async()=>{throw Error('secret')}},release:'test',observeRoles:async()=>({state:'unavailable'})});assert.equal(r.storage,'unavailable');assert.equal(r.scheduler.state,'unavailable');
});

test('workspace metrics never include another owner',async()=>{
 const f=fixture();f.state.runs={a:{tenant:'a',subject:'a',status:'queued',createdAt:10},b:{tenant:'b',subject:'b',status:'queued',createdAt:1}};
 f.state.audit=[{tenant:'b',subject:'b'}];
 assert.deepEqual(await f.operations.privateMetrics({tenant:'a',subject:'a'}),{runs:1,auditEntries:0,oldestPendingAt:10});
});

test('manual recovery does not conceal a stale scheduler',async()=>{
 const f=fixture();await f.operations.tick(()=>null,'vercel-cron');
 f.setNow(1000000+STALE_MS+1);await f.operations.tick(()=>null,'manual-worker');
 const status=await f.operations.snapshot();assert.equal(status.state,'healthy');assert.equal(status.scheduledState,'stale');
});
