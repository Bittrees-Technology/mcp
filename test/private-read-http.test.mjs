import test from 'node:test';import assert from 'node:assert/strict';
import{createServer}from'node:http';import{once}from'node:events';import{createHash}from'node:crypto';
import{createMcpHandler}from'../src/service/http.mjs';import{Engine}from'../src/service/engine.mjs';import{emptyState}from'../src/service/store.mjs';import{privateFixture}from'./fixtures/private-read-fixture.mjs';
test('HTTP advertises private reads only to configured actors and rejects anonymous/browser/profile bypasses',async()=>{
 const f=privateFixture();const token='test-only-private-read-token';const digest=createHash('sha256').update(token).digest('hex');
 f.setNow(Date.now());f.actor.permissions.push('catalog:read');Object.assign(f.actor,{audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,tokenHash:digest});f.binding.actorTokenHash=digest;f.connection.actorTokenHash=digest;f.connection.expiresAt=Date.now()+60000;
 const server=createServer(createMcpHandler({engine:new Engine({transaction:async fn=>fn(emptyState())}),credentials:[f.actor],privateReads:f.reads}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const rpc=async(method,params={},headers={},profile='insights')=>{const r=await fetch(base+'/mcp?mode=selected&projects='+profile,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,body:await r.json()};};
 const auth={authorization:'Bearer '+token};const call={name:'private_insights_read_analytics',arguments:{siteIds:['site']}};
 try{
  const anon=await rpc('tools/list');assert.ok(!anon.body.result.tools.some(t=>t.name.startsWith('private_')));
  assert.equal((await rpc('tools/call',call)).status,403);
  f.reads.enabled=false;assert.ok(!(await rpc('tools/list',{},auth)).body.result.tools.some(t=>t.name.startsWith('private_')));assert.equal((await rpc('tools/call',call,auth)).status,403);f.reads.enabled=true;
  assert.equal((await rpc('tools/list',{},auth)).body.result.tools.filter(t=>t.name.startsWith('private_')).length,2);
  assert.equal((await rpc('tools/call',call,auth,'agent')).status,403);
  assert.equal((await rpc('tools/call',call,{...auth,cookie:'irrelevant=1'})).status,403);
  assert.equal((await rpc('tools/call',call,{...auth,origin:'https://mcp.bittrees.org'})).status,403);
  assert.equal(f.effects(),0);assert.equal((await rpc('tools/call',call,auth)).status,200);assert.equal(f.effects(),1);
  const publicDirectory=await(await fetch(base+'/tool-catalog.json?mode=ecosystem')).json();assert.ok(!publicDirectory.functions.some(x=>x.name.startsWith('private_')));
  assert.ok(!JSON.stringify((await rpc('tools/list',{},auth)).body).includes(f.connection.token));
 }finally{server.close();await once(server,'close');}
});
