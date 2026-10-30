import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {canonical} from '../src/service/roles-proof.mjs';
import {WorkflowDevices} from '../src/service/workflow-devices.mjs';
import {workflowDeviceArguments,workflowDeviceResult,readWorkflowDeviceResponse} from '../src/service/workflow-device-contract.mjs';
const base=()=>({connectionId:randomUUID(),workflowId:'review',operationId:randomUUID()});
const evidence={model:'local',modelDigest:'pinned-digest',inputHash:'a'.repeat(64),output:'done'};
const completion=()=>({...base(),jobId:randomUUID(),leaseId:randomUUID(),evidence});
test('strict workflow input rejects extra authority, malformed leases and unbounded model evidence',()=>{
 const a=completion();assert.deepEqual(workflowDeviceArguments('workflow_complete',a),a);
 for(const bad of [{...a,jobId:'bad'},{...a,leaseId:'bad'},{...a,permissions:[]},{...a,evidence:{...evidence,model:''}},{...a,evidence:{...evidence,modelDigest:'x'.repeat(161)}},{...a,evidence:{...evidence,inputHash:'wrong'}},{...a,evidence:{...evidence,output:'😀'.repeat(6000)}},{...a,evidence:{...evidence,executionReceipt:{}}}])assert.throws(()=>workflowDeviceArguments('workflow_complete',bad));
 assert.throws(()=>workflowDeviceArguments('workflow_register',base()));
});
test('source replies bind the input hash and reject invented completion or extra authority',()=>{
 const input={title:'Draft',instruction:'Return ready.'};
 const j={id:randomUUID(),runId:randomUUID(),stepIndex:0,leaseId:randomUUID(),leaseUntil:new Date(Date.now()+60000).toISOString(),input,inputHash:createHash('sha256').update(canonical(input)).digest('hex')};
 assert.deepEqual(workflowDeviceResult('workflow_claim',{job:j}),{job:j});
 for(const job of [{...j,inputHash:'a'.repeat(64)},{...j,stepIndex:30},{...j,leaseUntil:'tomorrow'},{...j,grant:true}])assert.throws(()=>workflowDeviceResult('workflow_claim',{job}));
 const done={completed:true,runId:j.runId,followUpQueued:true};
 assert.deepEqual(workflowDeviceResult('workflow_complete',{...done,replayed:true}),{...done,replayed:true});
 for(const bad of [{...done,completed:false},{...done,replayed:false},{...done,grant:true},{...done,runId:'wrong'}])assert.throws(()=>workflowDeviceResult('workflow_complete',bad));
});
test('bounded source reader denies encoding, malformed UTF8, redirects and streamed overflow',async()=>{
 const signal=new AbortController().signal;
 for(const r of [Response.json({job:null},{status:403}),new Response('{bad',{headers:{'content-type':'application/json'}}),new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),Response.json({job:null},{headers:{'content-encoding':'gzip'}}),new Response('{}')])await assert.rejects(readWorkflowDeviceResponse(r,'workflow_claim',signal));
 let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(Buffer.from('é'.repeat(32001)))},cancel(){cancelled=true}});
 await assert.rejects(readWorkflowDeviceResponse(new Response(stream,{headers:{'content-type':'application/json'}}),'workflow_claim',signal),/too large/);assert.equal(cancelled,true);
 const redirected=Response.json({job:null});Object.defineProperty(redirected,'redirected',{value:true});await assert.rejects(readWorkflowDeviceResponse(redirected,'workflow_claim',signal));
});
test('a stalled source read aborts without awaiting a stalled cancellation',async()=>{
 const control=new AbortController();let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{})}});
 const pending=readWorkflowDeviceResponse(new Response(stream,{headers:{'content-type':'application/json'}}),'workflow_claim',control.signal);
 control.abort(Error('deadline'));await assert.rejects(pending,/deadline/);assert.equal(cancelled,true);
});
function setup(){
 const args=base(),actor={tenant:'t',subject:'device',tokenHash:'h',audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,permissions:['workflow:execute'],projectIds:['workflow'],rolesAuthorityBinding:'binding'};
 const c={tenant:'t',subject:'device',actorTokenHash:'h',token:'s'.repeat(32),connections:[{connectionId:args.connectionId,workflowId:args.workflowId}]};
 let checks=0,forwards=0,before=()=>{},reply=()=>Response.json({job:null});
 const adapter=new WorkflowDevices({connections:[c],rolesConsumer:{execute:async(a,b,s,p,effect)=>{checks++;await before();return effect(p,{})}},request:async()=>{forwards++;return reply()}});
 return {args,actor,c,adapter,checks:()=>checks,forwards:()=>forwards,before:fn=>before=fn,reply:fn=>reply=fn};
}
test('revoked configuration during Roles checks denies dispatch; scope mutation cannot switch source',async()=>{
 const f=setup();f.before(()=>{f.c.connections=[]});await assert.rejects(f.adapter.call(f.actor,['workflow'],'workflow_claim',f.args));assert.equal(f.forwards(),0);
 const g=setup();g.before(()=>{g.args.workflowId='injected'});await g.adapter.call(g.actor,['workflow'],'workflow_claim',g.args);assert.equal(g.forwards(),1,'caller arguments were snapshotted before await');
});
test('post-dispatch local revocation holds the result and never silently replays the effect',async()=>{
 const f=setup();f.reply(()=>{f.adapter.connections=[];return Response.json({job:null})});await assert.rejects(f.adapter.call(f.actor,['workflow'],'workflow_claim',f.args));assert.equal(f.forwards(),1);
 await assert.rejects(f.adapter.call(f.actor,['workflow'],'workflow_claim',f.args));assert.equal(f.forwards(),1);
});
test('duplicate actor connections and mutated advertised schema cannot expand authority',async()=>{
 const f=setup();const listed=f.adapter.list(f.actor,['workflow']);listed[0].inputSchema.required=[];
 assert.ok(f.adapter.list(f.actor,['workflow'])[0].inputSchema.required.length>0);
 f.adapter.connections.push({...f.c});assert.deepEqual(f.adapter.list(f.actor,['workflow']),[]);
 await assert.rejects(f.adapter.call(f.actor,['workflow'],'workflow_claim',f.args));assert.equal(f.checks(),0);
});
