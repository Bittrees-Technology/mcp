import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WorkflowDevices} from '../src/service/workflow-devices.mjs';
test('workflow adapter binds device, exact source connection and signed decision without arbitrary URLs',async()=>{
 const actor={tenant:'t',subject:'device',tokenHash:'h',audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,permissions:['workflow:execute'],projectIds:['workflow'],rolesAuthorityBinding:'binding'};
 const args={connectionId:randomUUID(),workflowId:'review',operationId:randomUUID()};let forwards=0,checks=0;
 const decision={decision:{allowed:true},signature:'verified-envelope'};
 const rolesConsumer={execute:async(a,b,scope,payload,effect)=>{checks++;assert.equal(a,actor);assert.equal(b,'binding');assert.equal(scope.resource,'workflow:review');assert.equal(scope.action,'workflow:claim');assert.equal(scope.operationId,args.operationId);return effect(payload,decision)}};
 const adapter=new WorkflowDevices({connections:[{tenant:'t',subject:'device',actorTokenHash:'h',token:'s'.repeat(32),connections:[{connectionId:args.connectionId,workflowId:'review'}]}],rolesConsumer,request:async(url,options)=>{forwards++;assert.equal(url,'https://workflow.bittrees.org/api/device/call');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.deepEqual(body.decision,decision);assert.deepEqual(body.arguments,args);return new Response(JSON.stringify({job:null}));}});
 assert.equal(adapter.list(actor,['workflow']).length,3);
 assert.deepEqual(await adapter.call(actor,['workflow'],'workflow_claim',args),{job:null});
 for(const bad of [{...args,workflowId:'other'},{...args,connectionId:randomUUID()},{...args,url:'https://other.invalid'}])await assert.rejects(adapter.call(actor,['workflow'],'workflow_claim',bad));
 await assert.rejects(adapter.call({...actor,tokenHash:'other'},['workflow'],'workflow_claim',args));
 await assert.rejects(adapter.call(actor,[],'workflow_claim',args));
 rolesConsumer.execute=async()=>{throw Error('Revoked')};await assert.rejects(adapter.call(actor,['workflow'],'workflow_claim',args),/Revoked/);
 assert.equal(forwards,1);assert.equal(checks,1);
});
