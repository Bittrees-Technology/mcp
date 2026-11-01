import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{workflowAuthorityFixture}from'./fixtures/workflow-authority-fixture.mjs';
test('workflow adapter binds device, exact source connection and signed decision without arbitrary URLs',async()=>{
 const f=workflowAuthorityFixture(),{actor,args,adapter}=f;assert.equal(adapter.list(actor,['workflow']).length,3);
 assert.deepEqual(await adapter.call(actor,['workflow'],'workflow_claim',args),{job:null});
 for(const bad of [{...args,workflowId:'other'},{...args,connectionId:randomUUID()},{...args,url:'https://other.invalid'}])await assert.rejects(adapter.call(actor,['workflow'],'workflow_claim',bad));
 await assert.rejects(adapter.call({...actor,tokenHash:'other'},['workflow'],'workflow_claim',args));await assert.rejects(adapter.call(actor,[],'workflow_claim',args));
 f.deny();await assert.rejects(adapter.call(actor,['workflow'],'workflow_claim',args));assert.equal(f.forwards(),1);assert.equal(f.checks(),2);
});
