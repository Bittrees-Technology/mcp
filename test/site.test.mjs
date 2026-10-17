import test from 'node:test';
import assert from 'node:assert/strict';
import{createServer}from'node:http';
import{once}from'node:events';
import{Engine}from'../src/service/engine.mjs';
import{emptyState}from'../src/service/store.mjs';
import{createMcpHandler}from'../src/service/http.mjs';
test('standalone pages, workspace assets and service boundaries',async()=>{
 const server=createServer(createMcpHandler({engine:new Engine({transaction:async fn=>fn(emptyState())})}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const path of ['/','/connect','/projects','/automations','/rules','/status','/reference','/tools','/assets/site.css','/assets/workspace.js','/assets/workspace-polling.js']){
   const r=await fetch(base+path);assert.equal(r.status,200,path);const text=await r.text();assert.ok(text.length>100);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
   if(path==='/')assert.match(text,/The central MCP/);
   if(path==='/automations')assert.match(text,/id="workspace" hidden/);
  }
  const ref=await (await fetch(base+'/reference.json')).json();
  const rpc=await (await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).json();
  assert.deepEqual(ref.tools.filter(t=>t.access==='Public').map(t=>t.name),rpc.result.tools.map(t=>t.name));
  assert.equal(ref.tools.length,12);
  assert.ok(ref.tools.some(t=>t.name==='plan_bittrees_tool_use'));
  assert.equal(ref.endpoints.filter(e=>e.method==='POST'&&e.path.startsWith('/v1/')&&!e.path.startsWith('/v1/ai/')).length,10);
  for(const endpoint of ref.endpoints.filter(e=>e.method==='GET'&&!e.path.includes('{')&&e.access==='Public'))assert.equal((await fetch(base+endpoint.path)).status,200,endpoint.path);
  const page=await (await fetch(base+'/reference')).text();
  for(const tool of ref.tools)assert.ok(page.includes(tool.name));
  assert.ok(page.includes('source permissions'));
  const directory=await(await fetch(base+'/tools?app=crm&q=tasks')).text();assert.ok(directory.includes('tasks.list'));assert.ok(!directory.includes('<code>roles.read_access</code>'));
  const excluded=await(await fetch(base+'/tools?app=wallet')).text();assert.ok(excluded.includes('0 matching functions'));
  const r=await fetch(base+'/v1/history');assert.equal(r.status,403);
  const traversal=await fetch(base+'/assets/unknown.js');assert.equal(traversal.status,404);
 }finally{server.close();await once(server,'close');}
});
