import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCrmAssignmentGateway} from '../src/service/crm-assignment-gateway.mjs';
function setup(){
 const assignment={assignmentId:randomUUID(),taskId:randomUUID(),taskRevision:1,projectId:randomUUID(),workflowId:'review',workflowRevision:1,principal:'agent:'+randomUUID()};
 const actor={audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,permissions:['workflow:execute'],projectIds:['crm','workflow'],tokenHash:'actor',rolesAuthorityBinding:'binding'};
 const calls=[];let session,allowed=true,afterAssignment=()=>{},afterTask=()=>{},afterWrite=()=>{},afterRequest=()=>{};
 const crm={
  async assignment(){calls.push('assignment');afterAssignment();return {assignment,envelope:{}};},
  async task(){calls.push('task');afterTask();return {assignment,instruction:'private'};},
  async result(input,options){calls.push(options?.write?'write':'receipt');if(options?.write)afterWrite();return {receipt:{operationId:input.crmOperationId,resultDigest:'a'.repeat(64)},envelope:{}};}
 };
 session={actorTokenHash:actor.tokenHash,binding:'binding',connectionId:randomUUID(),expiresAt:Date.now()+60000,workflowToken:'x'.repeat(64),principal:assignment.principal,workflowId:assignment.workflowId,projectId:assignment.projectId,crm};
 const gateway=createCrmAssignmentGateway({resolve:async()=>allowed?session:null,rolesConsumer:{execute:async(_a,_b,_s,_p,effect)=>effect({}, {})},request:async(_url,options)=>{calls.push(['workflow',options.headers['Idempotency-Key']]);afterRequest();return Response.json({ok:true});}});
 return {assignment,actor,calls,session,call:input=>gateway(actor,{assignmentId:assignment.assignmentId,...input}),
 revoke:()=>{allowed=false;},allow:()=>{allowed=true;},afterAssignment:f=>afterAssignment=f,afterTask:f=>afterTask=f,afterWrite:f=>afterWrite=f,afterRequest:f=>afterRequest=f};
}
test('revocation during assignment lookup prevents protected task read',async()=>{
 const s=setup();s.afterAssignment(s.revoke);await assert.rejects(s.call({kind:'task'}),{statusCode:403});assert.deepEqual(s.calls,['assignment']);
});
test('revocation during protected task read prevents private result release',async()=>{
 const s=setup();s.afterTask(s.revoke);await assert.rejects(s.call({kind:'task'}),{statusCode:403});assert.deepEqual(s.calls,['assignment','task']);
});
test('connection replacement during assignment lookup denies downstream dispatch',async()=>{
 for(const key of ['binding','actorTokenHash','principal','connectionId','workflowId','projectId','workflowToken','expiresAt']){
  const s=setup();s.afterAssignment(()=>{s.session[key]=key==='expiresAt'?s.session.expiresAt+1:'replacement';});
  await assert.rejects(s.call({kind:'task'}),{statusCode:403});assert.deepEqual(s.calls,['assignment']);
 }
});
test('revoked commit reply stays uncertain and authorized reconciliation preserves operation',async()=>{
 const s=setup(),operationId=randomUUID(),input={runId:randomUUID(),leaseId:randomUUID(),crmOperationId:operationId};
 s.afterWrite(s.revoke);
 await assert.rejects(s.call({kind:'write',...input,result:{summary:'candidate'}}),{statusCode:403});
 assert.deepEqual(s.calls,['assignment','write']);s.allow();
 assert.equal((await s.call({kind:'receipt',...input})).operationId,operationId);
 assert.deepEqual(s.calls,['assignment','write','assignment','receipt']);
});
test('revocation during Workflows reply denies release without retry or new operation',async()=>{
 const s=setup(),operationId=randomUUID();s.afterRequest(s.revoke);
 await assert.rejects(s.call({kind:'claim',operationId}),{statusCode:403});
 assert.deepEqual(s.calls,['assignment',['workflow',operationId]]);
});
test('stable current connection reads the reviewed assignment',async()=>{
 const s=setup();const r=await s.call({kind:'task'});assert.deepEqual(r.assignment,s.assignment);assert.equal(r.instruction,'private');
});
