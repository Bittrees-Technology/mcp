import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {createHash} from 'node:crypto';
import {Engine} from '../src/service/engine.mjs';import {emptyState} from '../src/service/store.mjs';import {createMcpHandler} from '../src/service/http.mjs';
import {projectCapabilities,verificationEvidence} from '../src/service/capabilities.mjs';import {CATALOG} from '../src/ecosystem/catalog.mjs';
import {searchFunctions} from '../src/ecosystem/tool-coverage.mjs';
test('atomic MCP setup shares REST checks and connection scope; history pagination is owner isolated',async()=>{
 const token='synthetic-plan-test-token',actor={tenant:'test',subject:'owner',audience:'https://mcp.bittrees.org',expiresAt:Date.now()+3600000,projectIds:['agent','crm'],permissions:['catalog:read','profile:write','rule:write','automation:write','automation:read'],tokenHash:createHash('sha256').update(token).digest('hex')};
 const state=emptyState(),engine=new Engine({transaction:async fn=>fn(state)});
 const server=createServer(createMcpHandler({engine,credentials:[actor]}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(projectId,key)=>fetch(base+'/mcp?mode=selected&projects=agent',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'automation_setup',arguments:{projectId,idempotencyKey:key}}})});
 try{
 assert.equal((await call('crm','outside')).status,403);
 assert.equal((await call('agent','inside')).status,200);assert.equal((await call('agent','inside')).status,200);assert.equal(Object.keys(state.automations).length,1);assert.equal(Object.values(state.automations)[0].status,'paused');
 actor.permissions=actor.permissions.filter(p=>p!=='rule:write');assert.equal((await call('agent','denied')).status,403);
 for(let i=0;i<7;i++)state.runs['run'+i]={id:'run'+i,tenant:'test',subject:i===6?'other':'owner',createdAt:i,status:'succeeded'};
 const first=await engine.act(actor,'history',{limit:2});assert.deepEqual(first.runs.map(r=>r.id),['run4','run5']);
 state.runs.new={id:'new',tenant:'test',subject:'owner',createdAt:10,status:'queued'};
 const next=await engine.act(actor,'history',{limit:2,cursor:first.page.nextCursor});assert.deepEqual(next.runs.map(r=>r.id),['run2','run3']);
 await assert.rejects(engine.act(actor,'history',{limit:2,cursor:'run6'}));
 }finally{server.close();await once(server,'close');}
});
test('readiness distinguishes source failure, resources and public gateway; evidence expires',()=>{
 const projects=projectCapabilities(CATALOG);assert.equal(projects.find(p=>p.id==='mcp').execution,'public-discovery-available');assert.equal(projects.find(p=>p.id==='the-verse').toolSync,'unavailable-or-invalid');
 assert.equal(verificationEvidence({clock:()=>Date.parse('2026-10-17')}).recovery.state,'restore-verified-for-recorded-schema');
 assert.equal(verificationEvidence({clock:()=>Date.parse('2027-01-01')}).recovery.state,'restore-verification-expired-or-schema-changed');
 assert.equal(verificationEvidence({release:'new'}).execution.state,'not-verified');
 const results=searchFunctions(CATALOG.projects.filter(p=>p.id==='crm'),{query:'tasks'});assert.ok(results.functions[0].name.includes('tasks'));
});
