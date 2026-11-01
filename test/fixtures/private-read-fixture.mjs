import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID,sign} from 'node:crypto';
import {RolesConsumer} from '../../src/service/roles-consumer.mjs';
import {canonical,requestMessage,decisionMessage,verifyEd25519} from '../../src/service/roles-proof.mjs';
import {PrivateReads} from '../../src/service/private-reads.mjs';
import {insightsContext,mailContext,MAIL_AUDIENCE,INSIGHTS_AUDIENCE} from '../../src/service/private-read-contract.mjs';
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const hash=x=>createHash('sha256').update(x).digest('hex');
export function privateFixture(source='insights'){
 const gateway=keys(),principal=keys(),roles=keys();let now=10000,delay=0,denyRoles=false,sourceEffect=0;const calls=[],proofs=[];
 const actor={expiresAt:100000,tenant:'tenant',subject:'subject',tokenHash:'a'.repeat(64),rolesAuthorityBinding:'worker',permissions:['sources:propose'],projectIds:[source]};
 const binding={id:'worker',tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,workspace:'workspace',principal:'agent:'+randomUUID(),credentialId:hash(principal.publicKey),delegationId:randomUUID(),privateKey:principal.privateKey,permissions:source==='insights'?['analytics.read','analytics.export'].map(action=>({project:source,resource:'analytics:permissioned',action})):['mail.read_selected_metadata','mail.read_selected_plain'].map(action=>({project:source,resource:'mail:selected-read',action}))};
 const connection={proofMode:'gateway-held-delegated-v1',enabled:true,source,tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,rolesAuthorityBinding:binding.id,expiresAt:100000,token:'b'.repeat(64),connectionId:source==='mail'?'c'.repeat(64):randomUUID(),connectionBindingDigest:'d'.repeat(64),mailboxBinding:'e'.repeat(64),selectionRevision:'f'.repeat(64),operations:source==='mail'?['mail.read_selected_message']:['insights.read_analytics','insights.export_analytics'],gatewayPublicKey:gateway.publicKey,actorPublicKey:principal.publicKey};
 const consumer=new RolesConsumer({gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,bindings:[binding],clock:()=>now,request:async(url,o)=>{
  const body=JSON.parse(o.body);assert.equal(url,'https://roles.bittrees.org/api/authority/mcp-decision');
  assert.ok(verifyEd25519(requestMessage(body.request),body.signature,gateway.publicKey));assert.ok(verifyEd25519(requestMessage(body.request),body.principalSignature,principal.publicKey));
  const d={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request:body.request,checkedAt:now,expiresAt:now+5000,allowed:!denyRoles,requiresSourceAuthorization:true,reason:'Synthetic allowed',policyVersion:1,policyDigest:'1'.repeat(64),delegationId:binding.delegationId};
  return Response.json({decision:d,signature:sign(null,Buffer.from(decisionMessage(d)),roles.privateKey).toString('base64')});
 }});
 let alterChallenge=x=>x,sourceVerifier=async()=>{};
 const reads=new PrivateReads({enabled:true,connections:[connection],rolesConsumer:consumer,clock:()=>now,request:async(url,o)=>{
  calls.push({url,options:o});assert.equal(o.redirect,'error');assert.equal(o.headers.authorization,'Bearer '+connection.token);
  const args=JSON.parse(o.body);
  if(url===INSIGHTS_AUDIENCE+'/operations'){const operationId=randomUUID();return Response.json(alterChallenge({version:1,operationId,parameters:insightsContext(connection,args.operation,args.arguments),expiresAt:now+60000}));}
  if(url===MAIL_AUDIENCE+'/operations'){const operationId=randomUUID();return Response.json(alterChallenge({version:1,operationId,parameters:mailContext(connection,args,operationId),expiresAt:now+60000}));}
  const proof=JSON.parse(Buffer.from(o.headers['x-bittrees-mcp-decision'],'base64url'));proofs.push(proof);
  assert.deepEqual(Object.keys(proof).sort(),['decisionEnvelope','principalSignature','request','signature']);
  assert.ok(verifyEd25519(requestMessage(proof.request),proof.signature,gateway.publicKey));assert.ok(verifyEd25519(requestMessage(proof.request),proof.principalSignature,principal.publicKey));
  assert.ok(!JSON.stringify(proof).includes('PRIVATE KEY'));
  const expected=source==='mail'?mailContext(connection,args.params.arguments,o.headers['x-bittrees-mcp-operation-id']):insightsContext(connection,url.endsWith('export-analytics')?'insights.export_analytics':'insights.read_analytics',args);
  assert.equal(proof.request.parametersDigest,hash(canonical(expected)));await sourceVerifier({proof,parameters:expected,body:args,options:o,url});sourceEffect++;now+=delay;
  return Response.json(source==='mail'?{jsonrpc:'2.0',id:args.id,result:{structuredContent:{metadata:{subject:'synthetic'}}}}:{summary:{views:3}},{headers:{'X-Bittrees-Mcp-Request-Id':proof.request.requestId,'X-Bittrees-Mcp-Operation-Id':proof.request.operationId,'X-Bittrees-Mcp-Decision-Digest':hash(canonical(proof.decisionEnvelope))}});
 }});
 return {actor,binding,connection,consumer,reads,calls,proofs,gateway,principal,roles,clock:()=>now,setNow:x=>now=x,setDelay:x=>delay=x,setSourceVerifier:fn=>sourceVerifier=fn,denyRoles:()=>denyRoles=true,alterChallenge:fn=>alterChallenge=fn,effects:()=>sourceEffect};
}
