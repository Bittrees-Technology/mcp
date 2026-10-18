import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {connectTaskSync,activationReceiptMessage} from '../src/service/task-sync-connect.mjs';
import {RolesConsumer} from '../src/service/roles-consumer.mjs';
import {requestMessage,decisionMessage} from '../src/service/roles-proof.mjs';
const pair=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function fixture(){
 const now=Date.now(),roles=pair(),worker=pair(),gateway=pair(),principal='agent:'+randomUUID(),sourceWorkspace=randomUUID(),nativeToken=randomBytes(32).toString('base64url');let allowed=true;
 const actor={tenant:'roles:'+randomUUID(),subject:principal,audience:'https://mcp.bittrees.org',tokenHash:createHash('sha256').update(nativeToken).digest('hex'),expiresAt:now+7200000,rolesAuthorityBinding:'native',projectIds:['crm','agent'],permissions:['catalog:read','task-sync:read','task-sync:write']};
 const binding={id:'native',tenant:actor.tenant,subject:principal,workspace:'crm:'+sourceWorkspace,actorTokenHash:actor.tokenHash,principal,publicKey:worker.publicKey,credentialId:createHash('sha256').update(worker.publicKey).digest('hex'),leaseId:randomUUID(),runtimeBindingDigest:'a'.repeat(64),permissions:[{project:'crm',resource:'workspace:projects',action:'task:read'}]};
 const connection={tenant:actor.tenant,subject:principal,actorTokenHash:actor.tokenHash,sourceWorkspace,nativeToken,token:'private-source-token-never-returned',expiresAt:now+7200000};
 const receipt={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',leaseId:binding.leaseId,policyDigest:'b'.repeat(64),principal,credentialId:binding.credentialId,runtimeBindingDigest:binding.runtimeBindingDigest,tenant:actor.tenant,workspace:binding.workspace,sourceWorkspace,activatedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3599000).toISOString(),renewable:false};
 const envelope=()=>({receipt,signature:sign(null,Buffer.from(activationReceiptMessage(receipt)),roles.privateKey).toString('base64')});
 const rolesConsumer=new RolesConsumer({bindings:[binding],gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,request:async(url,options)=>{const {request,runtimeAttestation}=JSON.parse(options.body);assert.ok(runtimeAttestation);const time=Date.now(),decision={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request,checkedAt:time,expiresAt:time+4000,requiresSourceAuthorization:true,allowed};return Response.json({decision,signature:sign(null,Buffer.from(decisionMessage(decision)),roles.privateKey).toString('base64')})}});
 const options={credentials:[actor],rolesConsumer,connections:[connection]};
 return {actor,binding,connection,receipt,envelope,options,setAllowed:v=>allowed=v,sign:request=>({request,signature:sign(null,Buffer.from(requestMessage(request)),worker.privateKey).toString('base64'),attestation:{request:{},signature:'fixture'}})};
}
test('native credential exchange requires receipt, fresh device proof and current lease allow',async()=>{
 const f=fixture();let challenge;
 await assert.rejects(connectTaskSync({leaseReceipt:f.envelope()},f.options),e=>{challenge=e.deviceChallenge;return e.statusCode===428});
 const proof=f.sign(challenge.request),result=await connectTaskSync({leaseReceipt:f.envelope(),proof},f.options);
 assert.equal(result.token,f.connection.nativeToken);assert.equal(result.identity.sourceWorkspace,f.connection.sourceWorkspace);assert.equal(result.identity.subject,f.actor.subject);assert.equal(result.identity.expiresAt,Date.parse(f.receipt.expiresAt));assert.ok(!JSON.stringify(result).includes(f.connection.token));
 f.setAllowed(false);await assert.rejects(connectTaskSync({leaseReceipt:f.envelope(),proof},f.options),e=>e.statusCode===403);
});
test('forged, expired, extended, cross-worker and unprepared source exchange cannot reveal a credential',async()=>{
 for(const change of [f=>f.receipt.expiresAt=new Date(Date.now()-1).toISOString(),f=>f.receipt.expiresAt=new Date(Date.now()+7200000).toISOString(),f=>f.receipt.principal='agent:'+randomUUID(),f=>f.receipt.sourceWorkspace=randomUUID(),f=>f.connection.nativeToken=randomBytes(32).toString('base64url'),f=>f.actor.permissions.push('sources:execute'),f=>f.binding.privateKey='not-allowed']){
 const f=fixture();change(f);await assert.rejects(connectTaskSync({leaseReceipt:f.envelope()},f.options),e=>e.statusCode===403);
 }
 const f=fixture(),bad=f.envelope();bad.signature='forged';await assert.rejects(connectTaskSync({leaseReceipt:bad},f.options),e=>e.statusCode===403);
});
