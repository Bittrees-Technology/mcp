import test from 'node:test';import assert from 'node:assert/strict';import {TaskSync} from '../src/service/task-sync.mjs';import {emptyState} from '../src/service/store.mjs';
const projectId='00000000-0000-4000-8000-000000000001',workspaceId='00000000-0000-4000-8000-000000000002';
function setup(){const state=emptyState(),calls=[],proofs=[];let deny=false,uncertain=false,current={found:false};let mapping=true;
 const actor={tenant:'test',subject:'owner',audience:'https://mcp.bittrees.org',expiresAt:Date.now()+3600000,projectIds:['crm','agent'],permissions:['task-sync:read','task-sync:write'],tokenHash:'a'.repeat(64),rolesAuthorityBinding:'approved'};
 const feed={data:{schema:'agent.bittrees.task-feed.v1',source:'https://agent.bittrees.org',revision:'a'.repeat(64),tombstones:[],projects:[{projectId:'agent',siteUrl:'https://agent.bittrees.org',tasks:[{sourceId:'agent-readiness:agent:task',projectId:'agent',title:'Fix readiness',description:'Review evidence',status:'todo',priority:'P1',area:'gateway',acceptanceCriteria:[],progressNote:'',sourceUrl:'https://agent.bittrees.org/readiness#task',contentHash:'a'.repeat(64)}]}]}};
 const connection={tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,token:'synthetic-crm-token',expiresAt:Date.now()+3600000};
 const gateway=new TaskSync({transaction:async fn=>fn(state)},{connections:[connection],rolesConsumer:{execute:async(a,b,scope,payload,effect)=>{proofs.push({scope,payload});if(deny&&scope.action==='task:import')throw Object.assign(Error('denied'),{statusCode:403});return effect(payload)}},request:async(url,options={})=>{
  if(url==='https://agent.bittrees.org/tasks.json'){assert.equal(options.headers,undefined);return Response.json(feed)}
  assert.equal(url,'https://crm.bittrees.org/api/integrations/datasets/mcp');const body=JSON.parse(options.body),{name,arguments:args}=body.params;calls.push(body);
  let data;if(name==='projects.list')data={projects:[{id:projectId,workspaceId,tasks:false,backlogSourceProjectId:mapping?'agent':null,backlogSourceSiteUrl:'https://agent.bittrees.org',expiresAt:new Date(Date.now()+3600000).toISOString()}]};
  else if(name==='tasks.import_source_status')data=current;
  else if(name==='tasks.import_source'){if(uncertain)throw Error('lost reply');data={taskId:'task-id',version:1,contentHash:args.contentHash,created:true,unchanged:false};}
  else assert.fail(name);
  return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify(data)}]}});
 }});
 return {state,actor,gateway,calls,proofs,feed,connection,setMapping:v=>mapping=v,setDenied:v=>deny=v,setUncertain:v=>uncertain=v,setCurrent:v=>current=v};
}
test('task import uses exact source mapping and fresh proof with stable uncertain retries',async()=>{
 const f=setup(),preview=await f.gateway.call(f.actor,['crm','agent'],'task_sync_preview',{}),task=preview.tasks[0];
 assert.equal(task.destination.projectId,projectId);const args={sourceId:task.sourceId,expectedFingerprint:task.fingerprint,confirmed:true};
 f.setUncertain(true);await assert.rejects(f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args));
 f.setUncertain(false);const result=await f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args);assert.equal(result.state,'accepted');
 const writes=f.calls.filter(c=>c.params.name==='tasks.import_source');assert.equal(writes.length,2);assert.deepEqual(writes[0].params,writes[1].params);assert.equal(writes[0].params.arguments.expectedVersion,undefined);
 assert.equal(f.proofs.filter(p=>p.scope.action==='task:import').length,2);assert.equal(Object.values(f.state.taskImports)[0].status,'accepted');
});
test('missing roles, changed content, source conflicts and revoked authority prevent task effects',async()=>{
 const f=setup();assert.deepEqual(f.gateway.list({...f.actor,rolesAuthorityBinding:null},['crm','agent']),[]);
 const task=(await f.gateway.preview(f.actor,['crm','agent'])).tasks[0],args={sourceId:task.sourceId,expectedFingerprint:task.fingerprint,confirmed:true};
 await assert.rejects(f.gateway.call(f.actor,['crm'],'task_sync_execute',args));
 f.feed.data.projects[0].tasks[0].title='Changed';await assert.rejects(f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args));f.feed.data.projects[0].tasks[0].title='Fix readiness';
 f.setCurrent({found:true,conflict:true});await assert.rejects(f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args));f.setCurrent({found:false});
 f.setDenied(true);await assert.rejects(f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args));assert.equal(f.calls.filter(c=>c.params.name==='tasks.import_source').length,0);
});
test('updates retain source version and do not send CRM-owned fields',async()=>{
 const f=setup(),task=(await f.gateway.preview(f.actor,['crm','agent'])).tasks[0];f.setCurrent({found:true,taskId:'task-id',version:7,contentHash:'old',conflict:false});
 await f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',{sourceId:task.sourceId,expectedFingerprint:task.fingerprint,confirmed:true});
 const payload=f.calls.find(c=>c.params.name==='tasks.import_source').params.arguments;assert.equal(payload.expectedVersion,7);for(const key of ['owner','ownerId','dueDate','status','comments','workspaceId'])assert.ok(!Object.hasOwn(payload,key));
});

test('ordinary backlog import does not need AI-task permission and missing mapping still blocks writes',async()=>{
 const f=setup(),task=(await f.gateway.preview(f.actor,['crm','agent'])).tasks[0];
 assert.equal(task.destination.projectId,projectId);
 const args={sourceId:task.sourceId,expectedFingerprint:task.fingerprint,confirmed:true};
 f.setMapping(false);
 await assert.rejects(f.gateway.call(f.actor,['crm','agent'],'task_sync_execute',args));
 assert.equal(f.calls.filter(c=>c.params.name==='tasks.import_source').length,0);
});

test('native device completes bounded challenges with fresh proofs and lease denial prevents imports',async()=>{
 const {generateKeyPairSync,createHash,randomUUID,sign}=await import('node:crypto');
 const {RolesConsumer}=await import('../src/service/roles-consumer.mjs');
 const {requestMessage,decisionMessage}=await import('../src/service/roles-proof.mjs');
 const pair=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const f=setup(),device=pair(),gateway=pair(),roles=pair(),seen=new Set();let allowed=true;
 const binding={id:'approved',tenant:f.actor.tenant,subject:f.actor.subject,actorTokenHash:f.actor.tokenHash,workspace:'bittrees',principal:`agent:${randomUUID()}`,credentialId:createHash('sha256').update(device.publicKey).digest('hex'),publicKey:device.publicKey,leaseId:randomUUID(),runtimeBindingDigest:'b'.repeat(64),permissions:[{project:'crm',resource:'workspace:projects',action:'task:read'},{project:'crm',resource:`project:${projectId}`,action:'task:read'},{project:'crm',resource:`project:${projectId}`,action:'task:import'}]};
 f.gateway.rolesConsumer=new RolesConsumer({bindings:[binding],gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,request:async(url,options)=>{
  const {request,runtimeAttestation}=JSON.parse(options.body);assert.equal(runtimeAttestation.request.requestDigest,createHash('sha256').update((await import('../src/service/roles-proof.mjs')).canonical(request)).digest('hex'));assert.equal(request.leaseId,binding.leaseId);assert.equal(request.runtimeBindingDigest,binding.runtimeBindingDigest);assert.ok(!seen.has(request.requestId),'each retry needs fresh nonce');seen.add(request.requestId);
  const now=Date.now(),decision={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request,checkedAt:now,expiresAt:now+5000,allowed,requiresSourceAuthorization:true};
  return Response.json({decision,signature:sign(null,Buffer.from(decisionMessage(decision)),roles.privateKey).toString('base64')});
 }});
 async function invoke(name,args){const challenges=[];for(let attempt=0;attempt<4;attempt++){
  const proofs=challenges.map(c=>{const request={...c.request,requestId:randomUUID(),issuedAt:Date.now()};return {request,signature:sign(null,Buffer.from(requestMessage(request)),device.privateKey).toString('base64'),attestation:{request:{requestDigest:createHash('sha256').update(requestMessage(request).split('\n').slice(1).join('\n')).digest('hex')},signature:'synthetic-attestation-verified-by-Roles'}}});
  try{return {result:await f.gateway.call({...f.actor,rolesProof:{proofs}},['crm','agent'],name,args),challenges}}
  catch(error){if(error.statusCode!==428)throw error;assert.equal(error.deviceChallenge.type,'roles-proof-required');challenges.push(error.deviceChallenge);assert.ok(challenges.length<=3);}
 }assert.fail('exceeded bounded continuation');}
 const preview=await invoke('task_sync_preview',{});assert.equal(preview.challenges.length,1);
 const task=preview.result.tasks[0],args={sourceId:task.sourceId,expectedFingerprint:task.fingerprint,confirmed:true};
 const imported=await invoke('task_sync_execute',args);assert.equal(imported.challenges.length,3);assert.equal(imported.result.state,'accepted');
 assert.equal(f.calls.filter(c=>c.params.name==='tasks.import_source').length,1);
 allowed=false;await assert.rejects(invoke('task_sync_execute',args),e=>e.statusCode===403);assert.equal(f.calls.filter(c=>c.params.name==='tasks.import_source').length,1);
});
