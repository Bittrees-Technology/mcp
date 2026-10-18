import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID,sign,verify} from 'node:crypto';
import {RolesConsumer} from '../src/service/roles-consumer.mjs';
import {requestMessage,decisionMessage} from '../src/service/roles-proof.mjs';
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function setup(){const gateway=keys(),actorKey=keys(),roles=keys(),operationId=randomUUID();let calls=0,requests=[],alter=d=>d;
 const actor={tenant:'tenant',subject:'subject',tokenHash:'a'.repeat(64),projectIds:['crm']};
 const scope={project:'crm',operationId,resource:`operation:${operationId}`,action:'source:execute'};
 const binding={id:'worker',...actor,actorTokenHash:actor.tokenHash,workspace:'workspace',principal:`agent:${randomUUID()}`,credentialId:createHash('sha256').update(actorKey.publicKey).digest('hex'),privateKey:actorKey.privateKey,permissions:[{...scope}]};
 const consumer=new RolesConsumer({gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,bindings:[binding],clock:()=>10000,request:async(url,options)=>{
  calls++;const body=JSON.parse(options.body);requests.push(body.request);const bytes=Buffer.from(requestMessage(body.request));
  assert.ok(verify(null,bytes,gateway.publicKey,Buffer.from(body.signature,'base64')));assert.ok(verify(null,bytes,actorKey.publicKey,Buffer.from(body.principalSignature,'base64')));
  let d=alter({version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request:body.request,checkedAt:10000,expiresAt:15000,allowed:true,requiresSourceAuthorization:true});
  return new Response(JSON.stringify({decision:d,signature:sign(null,Buffer.from(decisionMessage(d)),roles.privateKey).toString('base64')}));
 }});return {consumer,actor,scope,binding,actorKey,requests,alter:fn=>alter=fn,calls:()=>calls};}
test('Roles consumer binds dual proofs, exact arguments and fresh attempts without returning reusable allows',async()=>{
 const f=setup();let effects=0;
 for(let i=0;i<2;i++)assert.equal(await f.consumer.execute(f.actor,'worker',f.scope,{value:1},()=>++effects),i+1);
 assert.equal(f.requests.length,2);assert.notEqual(f.requests[0].requestId,f.requests[1].requestId);assert.equal(f.requests[0].operationId,f.requests[1].operationId);
 assert.equal(f.requests[0].parametersDigest,createHash('sha256').update('{"value":1}').digest('hex'));
});
test('signed denial, expiry, wrong stage/resource/audience, missing source requirement and untrusted signature prevent effects',async()=>{
 for(const alter of [d=>({...d,allowed:false}),d=>({...d,expiresAt:9999}),d=>({...d,expiresAt:16000}),d=>({...d,audience:'other'}),d=>({...d,requiresSourceAuthorization:false}),d=>({...d,request:{...d.request,stage:'enqueue'}}),d=>({...d,request:{...d.request,resource:'other'}})]){
  const f=setup();f.alter(alter);let effects=0;await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,{},()=>effects++));assert.equal(effects,0);
 }
 const f=setup();f.consumer.decisionKey=keys().publicKey;await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,{},()=>assert.fail('effect')));
});
test('missing enrollment, cross-owner scopes, excluded projects, person keys and unavailable authority fail closed',async()=>{
 for(const change of [f=>f.binding.principal=`person:${randomUUID()}`,f=>f.actor.tenant='other',f=>f.scope.project='wallet',f=>f.scope.resource='other',f=>f.binding.credentialId='0'.repeat(64),f=>f.consumer.gatewayKey=undefined,f=>f.consumer.request=async()=>{throw Error('private error')}]){
 const f=setup();change(f);await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,{},()=>assert.fail('effect')),/Current Roles execution authority required|Roles temporarily unavailable/);
 }
});
test('only transport unavailability is retryable; invalid or denied proofs stay denied',async()=>{
 for(const status of [403,502,503,504]){const f=setup();f.consumer.request=async()=>new Response('{}',{status});await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,{},()=>assert.fail('effect')),e=>e.statusCode===(status===403?403:503)&&Boolean(e.transient)===(status!==403));}
 const f=setup();f.consumer.request=async()=>new Response('{invalid');await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,{},()=>assert.fail('effect')),e=>e.statusCode===403&&!e.transient);
});

test('device-held keys authorize only the exact signed request without gateway custody',async()=>{
 const f=setup(),parameters={value:1};
 f.binding.publicKey=f.actorKey.publicKey;delete f.binding.privateKey;
 const request={version:1,source:'mcp.bittrees.org',audience:'https://roles.bittrees.org/api/authority/mcp-decision',requestId:randomUUID(),operationId:f.scope.operationId,parametersDigest:createHash('sha256').update('{"value":1}').digest('hex'),issuedAt:10000,principal:f.binding.principal,credentialId:f.binding.credentialId,delegationId:null,tenant:f.binding.tenant,workspace:f.binding.workspace,project:f.scope.project,resource:f.scope.resource,action:f.scope.action,stage:'execute'};
 const proof={request,signature:sign(null,Buffer.from(requestMessage(request)),f.actorKey.privateKey).toString('base64')};
 await assert.rejects(f.consumer.execute(f.actor,'worker',f.scope,parameters,()=>assert.fail('unsigned')));
 const actor={...f.actor,rolesProof:proof};
 assert.equal(await f.consumer.execute(actor,'worker',f.scope,parameters,()=> 'completed'),'completed');
 assert.deepEqual(f.requests[0],request);
 await assert.rejects(f.consumer.execute(actor,'worker',f.scope,{value:2},()=>assert.fail('altered arguments')));
 await assert.rejects(f.consumer.execute(actor,'worker',{...f.scope,stage:'enqueue'},parameters,()=>assert.fail('altered stage')));
 await assert.rejects(f.consumer.execute({...actor,rolesProof:{...proof,signature:'forged'}},'worker',f.scope,parameters,()=>assert.fail('forged')));
 f.consumer.clock=()=>30001;
 await assert.rejects(f.consumer.execute(actor,'worker',f.scope,parameters,()=>assert.fail('stale')));
 assert.equal(f.calls(),1);
});
