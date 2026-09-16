import assert from 'node:assert/strict';
const base=process.env.MCP_SMOKE_ORIGIN??'https://mcp.bittrees.org';
if(new URL(base).origin!=='https://mcp.bittrees.org')throw Error('Production smoke is restricted to MCP origin');
const a=process.env.MCP_SMOKE_TOKEN_A,b=process.env.MCP_SMOKE_TOKEN_B,worker=process.env.MCP_WORKER_TOKEN;
if(!a||!b||!worker)throw Error('Isolated smoke credentials required');
async function call(path,body,token=a,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(r.status,expected,path);return r.json();}
let automation;
try{
 for(const path of ['/','/connect','/projects','/automations','/rules','/status','/assets/site.css','/assets/workspace.js']){const r=await fetch(base+path,{redirect:'error'});assert.equal(r.status,200,path);}
 const health=await call('/health',null,null);assert.equal(health.storage,'ready');
 await call('/v1/history',null,null,403);await call('/v1/history',null,'invalid-token-for-denial',401);
 const selection={schema:'agent.bittrees.selection.v1',version:1,revision:1,mode:'selected',selectedIds:['agent'],excludedIds:[]};
 const profile=await call('/v1/profiles',{selection});
 const rule=await call('/v1/rules',{projectIds:['agent'],tools:['get_bittrees_project'],enabled:true});
 automation=await call('/v1/automations',{profileId:profile.id,ruleId:rule.id,projectId:'agent',tool:'get_bittrees_project',trigger:{type:'manual'}});assert.equal(automation.status,'paused');
 await call('/v1/automations/resume',{id:automation.id},b,404);
 await call('/v1/automations/trigger',{id:automation.id,idempotencyKey:'paused-check'},a,409);
 await call('/v1/automations/resume',{id:automation.id});
 const key=crypto.randomUUID();const run=await call('/v1/automations/trigger',{id:automation.id,idempotencyKey:key});const again=await call('/v1/automations/trigger',{id:automation.id,idempotencyKey:key});assert.equal(run.id,again.id);
 await call('/internal/tick',{},worker);
 const history=await call('/v1/history');assert.equal(history.runs.find(r=>r.id===run.id)?.status,'succeeded');
 const other=await call('/v1/history',null,b);assert.ok(!other.automations.some(x=>x.id===automation.id));
 await call('/v1/rules/update',{id:rule.id,expectedVersion:1,projectIds:['agent'],tools:['get_bittrees_project'],enabled:false});
 const denied=await call('/v1/automations/trigger',{id:automation.id,idempotencyKey:crypto.randomUUID()});await call('/internal/tick',{},worker);const after=await call('/v1/history');assert.equal(after.runs.find(r=>r.id===denied.id)?.status,'denied');
 console.log(JSON.stringify({service:health.service,release:health.release,storage:health.storage,siteRoutes:'pass',tenantIsolation:'pass',idempotency:'pass',ruleDenial:'pass',durableExecution:'pass'}));
}finally{if(automation)await call('/v1/automations/cancel',{id:automation.id});}
