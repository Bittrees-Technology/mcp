import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import{PrivateReads}from'../src/service/private-reads.mjs';
import{MAIL_AUDIENCE,INSIGHTS_AUDIENCE}from'../src/service/private-read-contract.mjs';
import{privateFixture}from'./fixtures/private-read-fixture.mjs';
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const mailArgs={selection:{id:'2'.repeat(64),folder:'INBOX'},expectedVersion:'3'.repeat(64),content:'metadata'};
test('actual Roles consumer retains only original public proofs and private family sends exact fixed read routes',async()=>{
 const f=privateFixture();assert.equal(f.reads.list(f.actor,['insights']).length,2);
 await f.reads.call(f.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']});
 await f.reads.call(f.actor,['insights'],'private_insights_export_analytics',{siteIds:['site'],dataset:'summary',format:'csv'});
 assert.deepEqual(f.calls.map(x=>x.url),[INSIGHTS_AUDIENCE+'/read-analytics',INSIGHTS_AUDIENCE+'/export-analytics']);
 assert.notEqual(f.proofs[0].request.requestId,f.proofs[1].request.requestId);assert.notEqual(f.proofs[0].request.action,f.proofs[1].request.action);
 const m=privateFixture('mail');await m.reads.call(m.actor,['mail'],'private_mail_read_selected_message',mailArgs);
 assert.deepEqual(m.calls.map(x=>x.url),[MAIL_AUDIENCE+'/operations',MAIL_AUDIENCE]);
 assert.equal(m.proofs[0].request.action,'mail.read_selected_metadata');assert.equal(m.proofs[0].request.resource,'mail:selected-read');
});
test('disabled, absent, duplicate, revoked, wrong actor, wrong scope or expired bindings produce no private requests',async()=>{
 for(const change of [f=>f.reads.enabled=false,f=>f.reads.connections=[],f=>f.reads.connections.push({...f.connection}),f=>f.connection.enabled=false,f=>f.actor.subject='other',f=>f.actor.permissions=[],f=>f.actor.projectIds=[],f=>f.actor.rolesAuthorityBinding='other',f=>f.connection.expiresAt=10000,f=>f.connection.operations=[],f=>f.connection.connectionBindingDigest='invalid']){
  const f=privateFixture();change(f);assert.equal(f.reads.list(f.actor,['insights']).length,0);await assert.rejects(f.reads.call(f.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(f.calls.length,0);
 }
 const f=privateFixture();assert.deepEqual(new PrivateReads({connections:[f.connection],rolesConsumer:f.consumer}).list(f.actor,['insights']),[]);
 await assert.rejects(f.reads.call(f.actor,[],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(f.calls.length,0);
});
test('unapproved arguments, write tools, origin overrides and prototype names never issue a source request',async()=>{
 for(const args of [{siteIds:['site'],url:'https://other.invalid'},{siteIds:[]},{siteIds:['same','same']},{siteIds:['site'],dataset:'summary'},{siteIds:['site'],days:1},{siteIds:['site'],path:'//evil'},{siteIds:['site'],path:'/a b'},{siteIds:['site'],path:'/a\\b'}]){
  const f=privateFixture();await assert.rejects(f.reads.call(f.actor,['insights'],'private_insights_read_analytics',args));assert.equal(f.calls.length,0);
 }
 const f=privateFixture();for(const name of ['private_insights_delete','private_mail_send','__proto__','constructor'])await assert.rejects(f.reads.call(f.actor,['insights'],name,{}));assert.equal(f.calls.length,0);
});
test('source challenges must exactly bind source-issued selection, descriptor and operation without renewal',async()=>{
 for(const alter of [x=>({...x,expiresAt:10000}),x=>({...x,expiresAt:71000}),x=>({...x,url:'https://other.invalid'}),x=>({...x,operationId:randomUUID()}),x=>({...x,parameters:{...x.parameters,connectionId:'9'.repeat(64)}}),x=>({...x,parameters:{...x.parameters,content:'plain'}}),x=>({...x,parameters:{...x.parameters,selectionRevision:'0'.repeat(64)}})]){
  const f=privateFixture('mail');f.alterChallenge(alter);await assert.rejects(f.reads.call(f.actor,['mail'],'private_mail_read_selected_message',mailArgs));assert.equal(f.calls.length,1);assert.equal(f.effects(),0);
 }
});
test('denied authority and late private results are discarded with no retry or exposure',async()=>{
 const f=privateFixture();f.denyRoles();await assert.rejects(f.reads.call(f.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(f.calls.length,0);
 const late=privateFixture();late.setDelay(5000);await assert.rejects(late.reads.call(late.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(late.calls.length,1);assert.equal(late.effects(),1);
 const wrong=privateFixture();wrong.connection.actorPublicKey=keys().publicKey;await assert.rejects(wrong.reads.call(wrong.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(wrong.calls.length,0);
});
test('metadata consent cannot become plain-text authority and read consent cannot become export authority',async()=>{
 const m=privateFixture('mail');m.binding.permissions=m.binding.permissions.filter(p=>p.action==='mail.read_selected_metadata');
 await assert.rejects(m.reads.call(m.actor,['mail'],'private_mail_read_selected_message',{...mailArgs,content:'plain'}));assert.equal(m.calls.length,1);assert.equal(m.effects(),0);
 const f=privateFixture();f.binding.permissions=f.binding.permissions.filter(p=>p.action==='analytics.read');
 await assert.rejects(f.reads.call(f.actor,['insights'],'private_insights_export_analytics',{siteIds:['site'],dataset:'summary',format:'json'}));assert.equal(f.calls.length,0);
});
test('configuration changes or redirects during a private read never release the returned data',async()=>{
 const changed=privateFixture();changed.setSourceVerifier(async()=>{changed.connection.connectionBindingDigest='0'.repeat(64);});
 await assert.rejects(changed.reads.call(changed.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(changed.calls.length,1);
 const redirect=privateFixture();redirect.reads.request=async()=>new Response(null,{status:302,headers:{location:'https://other.invalid'}});
 await assert.rejects(redirect.reads.call(redirect.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));
 const huge=privateFixture();huge.reads.request=async()=>new Response('x'.repeat(512001));
 await assert.rejects(huge.reads.call(huge.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));
});
test('legacy source responses without exact execution receipts never release private data',async()=>{
 for(const headers of [{},{'Request-Id':'wrong','Operation-Id':'wrong','Decision-Digest':'0'.repeat(64)}]){
  const f=privateFixture();let calls=0;f.reads.request=async()=>{calls++;return Response.json({sensitive:'synthetic-only'},{headers});};
  await assert.rejects(f.reads.call(f.actor,['insights'],'private_insights_read_analytics',{siteIds:['site']}));assert.equal(calls,1);
 }
});
