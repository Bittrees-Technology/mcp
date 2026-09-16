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
  for(const path of ['/','/connect','/projects','/automations','/rules','/status','/assets/site.css','/assets/workspace.js']){
   const r=await fetch(base+path);assert.equal(r.status,200,path);const text=await r.text();assert.ok(text.length>100);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
   if(path==='/')assert.match(text,/The connection layer/);
   if(path==='/automations')assert.match(text,/id="workspace" hidden/);
  }
  const r=await fetch(base+'/v1/history');assert.equal(r.status,403);
  const traversal=await fetch(base+'/assets/unknown.js');assert.equal(traversal.status,404);
 }finally{server.close();await once(server,'close');}
});
