import {createHash} from 'node:crypto';
import {canonical} from './roles-proof.mjs';
import {authorize,fail} from './engine.mjs';

const WORKFLOWS='https://workflow.bittrees.org';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const allowed=new Set(['intake','claim','task','write','receipt','complete','completion']);

/** Default-off protected gateway. resolve must bind the enrolled actor to a
 * reviewed assignment and source transport. resolve is rechecked before and
 * after protected dispatch and must return the same configured source adapter.
 * Current source/Role authorization belongs in that resolver and source service;
 * this continuity check never manufactures a permission. CRM retains its key. */
export function createCrmAssignmentGateway({resolve,rolesConsumer,request=fetch,now=Date.now}){
 return async (actor,input)=>{
  actor=structuredClone(actor);input=structuredClone(input);
  if(!input||!allowed.has(input.kind)||!uuid.test(input.assignmentId??'')||
     !actor?.rolesAuthorityBinding||!actor.projectIds?.includes('crm')||!actor.projectIds?.includes('workflow'))
   throw fail('Protected CRM assignment binding required',403);
  authorize(actor,'workflow:execute');
  const session=await resolve(actor,input.assignmentId);
  if(!session||session.actorTokenHash!==actor.tokenHash||session.binding!==actor.rolesAuthorityBinding||
     !uuid.test(session.connectionId)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now()||
     !/^[\x21-\x7e]{32,4096}$/.test(session.workflowToken??''))
   throw fail('Current CRM assignment binding required',403);
  const {crm,connectionId,workflowToken}=session;
  const fingerprint=value=>digest({actorTokenHash:value.actorTokenHash,binding:value.binding,
   connectionId:value.connectionId,principal:value.principal,workflowId:value.workflowId,
   projectId:value.projectId,expiresAt:value.expiresAt,workflowTokenDigest:digest(value.workflowToken)});
  const pinned=fingerprint(session);
  const id=input.assignmentId,kind=input.kind;
  const current=async()=>{
   authorize(actor,'workflow:execute');
   const fresh=await resolve(actor,id);
   if(!fresh||fresh.expiresAt<=now()||fingerprint(fresh)!==pinned||fresh.crm!==crm)
    throw fail('CRM assignment connection revoked or changed; reconcile the original operation',403);
  };
  const call=async(path,method,{body,operationId,crmProof,decision}={})=>{
   await current();
   const headers={Authorization:'Bearer '+workflowToken,Accept:'application/json',
    ...(body?{'Content-Type':'application/json'}:{}),
    ...(operationId?{'Idempotency-Key':operationId}:{}),
    'x-bittrees-connection-id':connectionId,
    ...(crmProof?{'x-bittrees-crm-proof':encode(crmProof)}:{}),
    ...(decision?{'x-bittrees-roles-decision':encode(decision)}:{})};
   const response=await request(WORKFLOWS+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(10000),
    ...(body?{body:JSON.stringify(body)}:{})});
   if(!response.ok){await response.body?.cancel();throw fail('Workflows rejected the CRM assignment operation',response.status);}
   const reader=response.body?.getReader();if(!reader)throw fail('Missing Workflows receipt',502);
   const chunks=[];let size=0;
   try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>16000)throw fail('Oversized Workflows receipt',502);chunks.push(next.value);}}
   finally{await reader.cancel();}
   await current();
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  };
  await current();
  const {assignment,envelope}=await crm.assignment(id,connectionId);
  await current();
  if(assignment.assignmentId!==id||assignment.principal!==session.principal||
     assignment.workflowId!==session.workflowId||assignment.projectId!==session.projectId)
   throw fail('CRM assignment no longer matches the reviewed connection',403);
  const assignmentDigest=digest(assignment);
  if(kind==='task'){
   await current();
   const task=await crm.task(id,connectionId);
   await current();
   if(digest(task.assignment)!==assignmentDigest)throw fail('CRM assignment changed during read',409);
   return task;
  }
  const base='/api/task-assignments/'+id;
  if(kind==='intake')return call(base+'/intake','POST',{body:{assignment},crmProof:envelope});
  if(kind==='claim'){
   if(!uuid.test(input.operationId??''))throw fail('Claim operation ID required',400);
   const args={connectionId,workflowId:assignment.workflowId,operationId:input.operationId,assignmentDigest};
   return rolesConsumer.execute(actor,session.binding,{project:'workflow',resource:'workflow:'+assignment.workflowId,
    action:'workflow:claim',operationId:input.operationId,stage:'execute',deviceChallenge:true},
    {tool:'workflow_claim',arguments:args},(_params,decision)=>call(base+'/claim','POST',{body:{assignment},operationId:input.operationId,decision}));
  }
  const {runId,leaseId,crmOperationId}=input;
  if(![runId,leaseId,crmOperationId].every(x=>typeof x==='string'&&uuid.test(x)))throw fail('Exact CRM result binding required',400);
  const resultInput={assignmentId:id,connectionId,runId,leaseId,crmOperationId};
  if(kind==='write'){
   await current();
   const result=await crm.result({...resultInput,result:input.result},{write:true});
   await current();
   return result.receipt;
  }
  await current();
  const result=await crm.result(resultInput);
  await current();
  if(kind==='receipt')return result.receipt;
  const {operationId}=input;
  if(!uuid.test(operationId??'')||result.receipt.resultDigest!==input.resultDigest)throw fail('Completion differs from the CRM receipt',409);
  const method=kind==='complete'?'PUT':'GET';
  if(method==='PUT'&&(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=now()))throw fail('Active workflow lease required',409);
  const args={runId,operationId,method,connectionId,assignmentDigest,leaseId,crmOperationId,resultDigest:result.receipt.resultDigest};
  return rolesConsumer.execute(actor,session.binding,{project:'workflow',resource:'workflow:'+assignment.workflowId,
   action:'workflow:complete',operationId,stage:'execute',deviceChallenge:true},
   {tool:'workflow_crm_completion',arguments:args},(_params,decision)=>call('/api/task-runs/'+runId+'/completions/'+operationId,method,{
    operationId,decision,crmProof:result.envelope,
    ...(method==='PUT'?{body:{assignment,claim:{assignmentDigest,runId,leaseId,expiresAt:input.expiresAt},crmOperationId,resultDigest:result.receipt.resultDigest}}:{})
   }));
 };
}
