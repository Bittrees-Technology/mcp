import{deviceFixture}from'./fixtures/private-device-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import{randomUUID}from'node:crypto';
import{PrivateReadJournal}from'../src/service/private-read-journal.mjs';import{PrivateReads}from'../src/service/private-reads.mjs';
import{requestMessage}from'../src/service/roles-proof.mjs';import{emptyState}from'../src/service/store.mjs';import{privateFixture}from'./fixtures/private-read-fixture.mjs';
const name='private_insights_read_analytics',args={siteIds:['site']};
async function challenge(f,tool=name,parameters=args){let e;try{await f.reads.call(f.actor,f.actor.projectIds,tool,parameters);}catch(x){e=x;}assert.equal(e?.statusCode,428);return e;}
async function resume(f,e,tool=name,parameters=args){return f.reads.call({...f.actor,rolesProof:f.signChallenge(e)},f.actor.projectIds,tool,parameters,{operationId:e.deviceChallenge.operationId});}
test('durable device challenge resumes the same source operation with externally held key and one result',async()=>{
 for(const source of ['insights','mail']){
  const f=deviceFixture(source),tool=source==='mail'?'private_mail_read_selected_message':name,parameters=source==='mail'?{selection:{id:'2'.repeat(64),folder:'INBOX'},expectedVersion:'3'.repeat(64),content:'metadata'}:args;
  const e=await challenge(f,tool,parameters),again=await challenge(f,tool,parameters);assert.deepEqual(again.deviceChallenge,e.deviceChallenge);assert.equal(f.calls.length,1);assert.equal(f.effects(),0);assert.ok(!f.binding.privateKey);
  // A new provider instance reads the same durable operation, not process memory.
  const restored=new PrivateReads({enabled:true,deviceEnabled:true,store:f.store,connections:[f.connection],rolesConsumer:f.consumer,request:f.reads.request,clock:f.clock});f.reads=restored;
  await resume(f,e,tool,parameters);assert.equal(f.calls.length,2);assert.equal(f.effects(),1);assert.equal(f.proofs[0].request.operationId,e.deviceChallenge.operationId);assert.deepEqual(f.proofs[0].request,e.deviceChallenge.request);
  await assert.rejects(resume(f,e,tool,parameters));assert.equal(f.effects(),1);const rows=Object.values(f.state.privateReadOperations);assert.equal(rows.length,1);assert.equal(rows[0].status,'completed');assert.ok(!JSON.stringify(rows).includes('PRIVATE KEY'));assert.ok(!JSON.stringify(rows).includes(f.connection.token));assert.ok(!JSON.stringify(rows).includes('synthetic-only'));
 }
});
test('concurrent signed resumes atomically permit one dispatch and no automatic replay',async()=>{
 const f=deviceFixture(),e=await challenge(f);const results=await Promise.allSettled([resume(f,e),resume(f,e)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.effects(),1);assert.equal(f.calls.length,2);
});
test('unknown operation, owner/config/selection changes and forged device proofs issue no further source requests',async()=>{
 for(const change of [f=>f.connection.selectionRevision='0'.repeat(64),f=>f.connection.connectionBindingDigest='0'.repeat(64),f=>f.actor.subject='other',f=>f.actor.tokenHash='0'.repeat(64),f=>f.binding.delegationId=randomUUID(),f=>f.binding.permissions=[]]){
  const f=deviceFixture(),e=await challenge(f);change(f);await assert.rejects(resume(f,e));assert.equal(f.effects(),0);assert.equal(f.calls.length,1);
 }
 const f=deviceFixture(),e=await challenge(f);await assert.rejects(f.reads.call({...f.actor,rolesProof:{request:e.deviceChallenge.request,signature:'forged'}},['insights'],name,args,{operationId:e.deviceChallenge.operationId}));
 await assert.rejects(resume(f,{deviceChallenge:{...e.deviceChallenge,operationId:randomUUID()}}));await assert.rejects(resume(f,e,name,{siteIds:['different']}));assert.equal(f.calls.length,1);assert.equal(f.effects(),0);
});
test('expired original requests are held without renewed signatures, new IDs or private reads',async()=>{
 const f=deviceFixture(),e=await challenge(f);f.setNow(25001);await assert.rejects(resume(f,e));await assert.rejects(f.reads.call(f.actor,['insights'],name,args));assert.equal(f.calls.length,1);assert.equal(f.effects(),0);
 const late=deviceFixture(),c=await challenge(late);late.setDelay(5000);await assert.rejects(resume(late,c));assert.equal(late.effects(),1);assert.equal(Object.values(late.state.privateReadOperations)[0].status,'held');await assert.rejects(resume(late,c));assert.equal(late.effects(),1);
});
test('native path requires separate flag, durable store, delegated public-key binding and no lease',async()=>{
 for(const change of [f=>f.reads.deviceEnabled=false,f=>f.reads.journal.store=undefined,f=>f.binding.privateKey=f.principal.privateKey,f=>f.binding.leaseId=randomUUID(),f=>f.binding.delegationId=null]){
  const f=deviceFixture();change(f);assert.deepEqual(f.reads.list(f.actor,['insights']),[]);await assert.rejects(f.reads.call(f.actor,['insights'],name,args));assert.equal(f.calls.length,0);
 }
});
test('fresh intent after an undispatched expired challenge preserves the old record; held outcomes never renew',async()=>{
 const f=deviceFixture(),old=await challenge(f);f.setNow(25001);let next;
 try{await f.reads.call(f.actor,['insights'],name,args,{fresh:true});}catch(e){next=e;}
 assert.equal(next.statusCode,428);assert.notEqual(next.deviceChallenge.operationId,old.deviceChallenge.operationId);assert.equal(Object.keys(f.state.privateReadOperations).length,2);assert.equal(f.effects(),0);
 const held=deviceFixture(),h=await challenge(held);held.setDelay(5000);await assert.rejects(resume(held,h));await assert.rejects(held.reads.call(held.actor,['insights'],name,args,{fresh:true}));assert.equal(held.calls.length,2);assert.equal(Object.keys(held.state.privateReadOperations).length,1);
});
test('the delegated challenge flag cannot authorize other project/resource/action/stage combinations',async()=>{
 for(const patch of [{project:'crm',resource:'workspace:projects',action:'task:read'},{project:'mail',resource:'analytics:permissioned',action:'mail.read_selected_metadata'},{project:'insights',resource:'mail:selected-read',action:'analytics.read'},{project:'insights',resource:'analytics:permissioned',action:'mail.read_selected_plain'},{project:'mail',resource:'mail:selected-read',action:'mail.send'},{project:'insights',resource:'analytics:permissioned',action:'analytics.read',stage:'enqueue'}]){
  const f=deviceFixture(),scope={project:'insights',resource:'analytics:permissioned',action:'analytics.read',operationId:randomUUID(),stage:'execute',deviceChallenge:true,delegatedDeviceReadChallenge:true,...patch};
  f.actor.projectIds.push(scope.project);f.binding.permissions=[scope];await assert.rejects(f.consumer.execute(f.actor,'worker',scope,{},()=>assert.fail('effect')),e=>e.statusCode===403&&!e.deviceChallenge);assert.equal(f.effects(),0);
 }
 const f=deviceFixture(),e=await challenge(f);f.denyRoles();await assert.rejects(resume(f,e));assert.equal(f.effects(),0);assert.equal(f.calls.length,1);
});
test('actual FileStore persists the original challenge across reopened stores and fails closed on full journal',async()=>{
 const{mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{FileStore}=await import('../src/service/store.mjs');
 const dir=await mkdtemp(join(tmpdir(),'mcp-private-journal-test-'));
 try{
  const f=deviceFixture(),path=join(dir,'state.json');f.reads.journal=new PrivateReadJournal(new FileStore(path),{clock:f.clock});
  const first=await challenge(f);f.reads.journal=new PrivateReadJournal(new FileStore(path),{clock:f.clock});assert.deepEqual((await challenge(f)).deviceChallenge,first.deviceChallenge);await resume(f,first);assert.equal(f.effects(),1);
  const saved=await new FileStore(path).transaction(s=>s.privateReadOperations);assert.equal(Object.values(saved)[0].status,'completed');
  const full=new PrivateReadJournal(new FileStore(path),{clock:f.clock,maxEntries:1});await assert.rejects(full.begin('different',{}));assert.equal(Object.keys(await new FileStore(path).transaction(s=>s.privateReadOperations)).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('awaited durable completion cannot release a result after proof expiry or connection revocation',async()=>{
 for(const revoke of [false,true]){
  const f=deviceFixture(),e=await challenge(f),original=f.reads.journal.store;let changed=false;
  f.reads.journal.store={transaction:async fn=>{const result=await original.transaction(fn);const completed=Object.values(f.state.privateReadOperations??{}).some(r=>r.status==='completed');if(completed&&!changed){changed=true;await Promise.resolve();if(revoke)f.connection.enabled=false;else f.setNow(f.clock()+5000);}return result;}};
  await assert.rejects(resume(f,e));assert.equal(f.effects(),1);assert.equal(Object.values(f.state.privateReadOperations)[0].status,'completed');await assert.rejects(resume(f,e));assert.equal(f.effects(),1);
 }
});
