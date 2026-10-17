import test from 'node:test';import assert from 'node:assert/strict';import {planTaskSync} from '../src/service/task-sync-plan.mjs';
const task={sourceId:'agent-readiness:agent:task',projectId:'agent',title:'Fix gateway',description:'Source content',status:'open',priority:'high',area:'integration',acceptanceCriteria:['working'],progressNote:'',sourceUrl:'https://agent.bittrees.org/readiness#task',contentHash:'a'.repeat(64)};
const feed=()=>({data:{schema:'agent.bittrees.task-feed.v1',source:'https://agent.bittrees.org',revision:'a'.repeat(64),projects:[{projectId:'agent',siteUrl:'https://agent.bittrees.org',tasks:[{...task}]}],tombstones:[]}});
const mapping={sourceProjectId:'agent',sourceSiteUrl:'https://agent.bittrees.org',approved:true,expiresAt:Date.now()+60000,crmProjectId:'00000000-0000-4000-8000-000000000001',workspaceId:'00000000-0000-4000-8000-000000000002'};
test('task preparation is stable, never writes, and requires unambiguous approved mapping',()=>{
 const a=planTaskSync(feed());assert.equal(a.writeEnabled,false);assert.equal(a.tasks[0].state,'mapping-required');
 const b=planTaskSync(feed(),{mappings:[mapping]}),c=planTaskSync(feed(),{mappings:[mapping]});assert.equal(b.tasks[0].idempotencyKey,c.tasks[0].idempotencyKey);assert.equal(b.tasks[0].state,'source-contract-required');assert.equal(planTaskSync(feed(),{mappings:[mapping,mapping]}).tasks[0].state,'mapping-required');
 const changed=feed();changed.data.projects[0].tasks[0].title='Changed';assert.notEqual(planTaskSync(changed,{mappings:[mapping]}).tasks[0].idempotencyKey,b.tasks[0].idempotencyKey);
});
test('withdrawn projects, duplicates and source substitution cannot enter task planning',()=>{
 for(const mutate of [f=>f.data.projects[0].projectId='wallet',f=>f.data.projects[0].siteUrl='https://attacker.example',f=>f.data.projects[0].tasks.push(task),f=>f.data.projects[0].tasks[0].sourceUrl='https://attacker.example/readiness']){const f=feed();mutate(f);assert.throws(()=>planTaskSync(f));}
});
test('missing tasks remain retained and owner edits and remapping require review',()=>{
 const prior={sourceId:task.sourceId,fingerprint:'old',crmProjectId:mapping.crmProjectId,workspaceId:mapping.workspaceId,ownerEdited:true};
 assert.equal(planTaskSync(feed(),{mappings:[mapping],previous:[prior]}).tasks[0].state,'owner-review-required');
 assert.equal(planTaskSync(feed(),{mappings:[mapping],previous:[{...prior,crmProjectId:'other'}]}).tasks[0].state,'mapping-conflict');
 const f=feed();f.data.projects[0].tasks=[];assert.deepEqual(planTaskSync(f,{previous:[prior]}).retained,[{sourceId:task.sourceId,state:'retain-for-review'}]);
});
