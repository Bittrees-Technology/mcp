import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedMcpResult } from '../src/ecosystem/mcp.mjs';
const call = (name, args={}, selection='mode=bittrees') => scopedMcpResult({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}, {url:'/mcp?'+selection}).result.structuredContent;
test('coverage prefers MCP but never claims permission or live execution', () => {
 const c=call('list_bittrees_tool_coverage',{projectId:'crm'});
 assert.equal(c.policy.browserFallbackAutomatic,false);
 assert.equal(c.projects[0].liveAvailability,'not-checked');
 const p=call('plan_bittrees_tool_use',{projectId:'crm',operation:'complete'});
 assert.deepEqual(p.routes[0].tools,['tasks.claim','tasks.finish']);
 assert.equal(p.executionAllowed,false);
 assert.match(p.routes[0].boundary,/only/);
});
test('coverage respects selected, excluded and pending projects', () => {
 const c=call('list_bittrees_tool_coverage',{},'mode=selected&projects=crm');
 assert.deepEqual(c.projects.map(p=>p.projectId),['crm']);
 for(const projectId of ['calendar','mail','wallet']) assert.throws(()=>call('list_bittrees_tool_coverage',{projectId},'mode=selected&projects=crm'));
 assert.throws(()=>call('plan_bittrees_tool_use',{projectId:'crm',operation:'read'},'mode=bittrees&exclude=crm'));
});
test('unknown coverage and operations cannot become an execution route', () => {
 assert.equal(call('plan_bittrees_tool_use',{projectId:'autonote',operation:'publish'}).status,'coverage-gap');
 assert.equal(call('plan_bittrees_tool_use',{projectId:'tld',operation:'publish'}).routes.length,0);
 assert.throws(()=>call('plan_bittrees_tool_use',{projectId:'crm',operation:'grant'}));
 assert.throws(()=>call('plan_bittrees_tool_use',{projectId:'crm',operation:'read',token:'secret'}));
 assert.throws(()=>call('list_bittrees_tool_coverage',{url:'http://localhost'}));
});
test('reviewed Calendar and News routes retain operation-specific limits', () => {
 const c=call('plan_bittrees_tool_use',{projectId:'calendar',operation:'create'});
 assert.deepEqual(c.routes[0].tools,['calendar.save']);
 assert.match(c.routes[0].boundary,/operationId/);
 const n=call('plan_bittrees_tool_use',{projectId:'news',operation:'publish'});
 assert.ok(n.routes[0].tools.includes('publish_reviewed_preview'));
 assert.ok(n.routes[0].tools.includes('get_publication_receipt'));
 assert.match(n.routes[0].boundary,/approval/);
});
test('central search is paginated, exact and restricted to selected apps', () => {
 const first=call('search_bittrees_tools',{query:'tasks',limit:1},'mode=selected&projects=crm');
 assert.equal(first.functions.length,1);assert.equal(first.nextOffset,1);
 assert.equal(call('get_bittrees_tool',{id:first.functions[0].id},'mode=selected&projects=crm').projectId,'crm');
 assert.throws(()=>call('get_bittrees_tool',{id:'calendar:calendar.save'},'mode=selected&projects=crm'));
 assert.equal(call('search_bittrees_tools',{query:'calendar'},'mode=selected&projects=crm').total,0);
 assert.throws(()=>call('search_bittrees_tools',{limit:101}));
});
test('gateway-owned workflow route survives an empty source manifest without granting execution',()=>{
 const plan=call('plan_bittrees_tool_use',{projectId:'workflow',operation:'sync'},'mode=selected&projects=workflow');
 assert.equal(plan.executionAllowed,false);assert.equal(plan.routes.length,1);
 assert.deepEqual(plan.routes[0].tools,['workflow_claim','workflow_renew']);
 assert.equal(plan.routes[0].transport,'managed-mcp');
 const tool=call('get_bittrees_tool',{id:'workflow:workflow_complete'},'mode=selected&projects=workflow');
 assert.equal(tool.schemaDiscovery.authority,'gateway');assert.equal(tool.execution,'source-authorized-connection-required');
 assert.match(tool.description,/current Roles action authority/);assert.match(tool.description,/No registration, grant/);
 assert.equal(call('search_bittrees_tools',{query:'workflow_'},'mode=selected&projects=workflow').total,3);
 assert.equal(call('search_bittrees_tools',{query:'workflow_'},'mode=selected&projects=crm').total,0);
 assert.equal(call('plan_bittrees_tool_use',{projectId:'workflow',operation:'publish'}).routes.length,0);
});
