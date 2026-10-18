import {createHash,randomUUID} from 'node:crypto';
import {canonical,verifyEd25519} from './roles-proof.mjs';
import {authorize,fail} from './engine.mjs';
const fields='activatedAt,audience,credentialId,expiresAt,issuer,leaseId,policyDigest,principal,renewable,runtimeBindingDigest,sourceWorkspace,tenant,version,workspace';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hex=/^[a-f0-9]{64}$/;
export const activationReceiptMessage=r=>'Bittrees MCP lease activation receipt v1\n'+canonical(r);
/** Device possession exchange only. Operator prepares exact bindings; no enrollment or authority is minted here. */
export async function connectTaskSync(input,{credentials,rolesConsumer,connections,clock=Date.now}){
 const denied=()=>fail('Approved native task-sync connection required',403);
 if(!input||Object.keys(input).some(k=>!['leaseReceipt','proof'].includes(k)))throw denied();
 const receipt=input.leaseReceipt?.receipt,signature=input.leaseReceipt?.signature,now=clock();
 if(!receipt||Object.keys(receipt).sort().join(',')!==fields||receipt.version!==1||receipt.issuer!=='https://roles.bittrees.org'||receipt.audience!=='https://mcp.bittrees.org'||receipt.renewable!==false||!uuid.test(receipt.leaseId)||!/^agent:/.test(receipt.principal)||!uuid.test(receipt.principal.slice(6))||![receipt.credentialId,receipt.runtimeBindingDigest,receipt.policyDigest].every(x=>hex.test(x??''))||!verifyEd25519(activationReceiptMessage(receipt),signature,rolesConsumer?.decisionKey))throw denied();
 const activatedAt=Date.parse(receipt.activatedAt),expiresAt=Date.parse(receipt.expiresAt);
 if(!Number.isFinite(activatedAt)||!Number.isFinite(expiresAt)||activatedAt>now||expiresAt<=now||expiresAt<=activatedAt||expiresAt-activatedAt>3600000)throw denied();
 const matches=rolesConsumer.bindings.filter(b=>b.leaseId===receipt.leaseId&&b.principal===receipt.principal&&b.credentialId===receipt.credentialId&&b.runtimeBindingDigest===receipt.runtimeBindingDigest&&b.tenant===receipt.tenant&&b.workspace===receipt.workspace&&b.subject===receipt.principal&&b.publicKey&&!b.privateKey&&!b.delegationId);
 if(matches.length!==1)throw denied();const binding=matches[0];
 const actors=credentials.filter(a=>a.tenant===binding.tenant&&a.subject===binding.subject&&a.rolesAuthorityBinding===binding.id&&a.tokenHash===binding.actorTokenHash);
 if(actors.length!==1)throw denied();const actor=actors[0];
 for(const permission of ['catalog:read','task-sync:read','task-sync:write'])authorize(actor,permission);
 if(actor.expiresAt<expiresAt||actor.managed||actor.permissions.length!==3||!actor.projectIds.includes('crm'))throw denied();
 const sources=connections.filter(c=>c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash);
 if(sources.length!==1)throw denied();const source=sources[0];
 if(!uuid.test(source.sourceWorkspace??'')||receipt.sourceWorkspace!==source.sourceWorkspace||receipt.workspace!=='crm:'+source.sourceWorkspace||source.expiresAt<expiresAt||!Number.isFinite(source.expiresAt)||typeof source.nativeToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(source.nativeToken)||createHash('sha256').update(source.nativeToken).digest('hex')!==actor.tokenHash||typeof source.token!=='string'||source.token.length<16||source.token.length>4096||/\s/.test(source.token))throw denied();
 const parameters={tool:'projects.list',arguments:{}},proof=input.proof;
 const operationId=proof?.request?.operationId??randomUUID();
 return rolesConsumer.execute({...actor,rolesProof:proof},binding.id,{project:'crm',resource:'workspace:projects',action:'task:read',operationId,stage:'execute',deviceChallenge:true},parameters,()=>{
  // Recheck local expiry after the asynchronous authority decision, before revealing the transport credential.
  if(clock()>=expiresAt||clock()>=actor.expiresAt||clock()>=source.expiresAt)throw denied();
  return {identity:{principal:binding.principal,credentialId:binding.credentialId,tenant:binding.tenant,workspace:binding.workspace,sourceWorkspace:source.sourceWorkspace,subject:actor.subject,leaseId:binding.leaseId,runtimeBindingDigest:binding.runtimeBindingDigest,activatedAt,expiresAt},token:source.nativeToken,projectIds:[...actor.projectIds],permissions:[...actor.permissions]};
 });
}
