import test from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{once}from'node:events';import{createHash}from'node:crypto';
import{createMcpHandler}from'../src/service/http.mjs';import{Engine}from'../src/service/engine.mjs';import{deviceFixture}from'./fixtures/private-device-fixture.mjs';
test('native HTTP handshake returns one durable428 and resumes exact externally signed operation',async()=>{
 const f=deviceFixture(),token='synthetic-native-private-token',hash=createHash('sha256').update(token).digest('hex');f.setNow(Date.now());f.actor.permissions.push('catalog:read');Object.assign(f.actor,{audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,tokenHash:hash});f.binding.actorTokenHash=hash;f.connection.actorTokenHash=hash;f.connection.expiresAt=Date.now()+60000;
 const server=createServer(createMcpHandler({engine:new Engine(f.store),credentials:[f.actor],privateReads:f.reads}));server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/mcp?mode=selected&projects=insights`;
 const rpc=async(headers={})=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'private_insights_read_analytics',arguments:{siteIds:['site']}}})});return {status:r.status,body:await r.json()};};
 try{
  const first=await rpc();assert.equal(first.status,428);const data=first.body.error.data;assert.equal(data.request.operationId,data.operationId);assert.equal(f.calls.length,1);
  const repeat=await rpc();assert.deepEqual(repeat.body.error.data,data);assert.equal(f.calls.length,1);
  const signed=f.signChallenge({deviceChallenge:data}),headers={'x-bittrees-private-operation':data.operationId,'x-bittrees-agent-proof':Buffer.from(JSON.stringify(signed)).toString('base64url')};
  assert.equal((await rpc(headers)).status,200);assert.equal(f.effects(),1);assert.notEqual((await rpc(headers)).status,200);assert.equal(f.effects(),1);
 }finally{server.close();await once(server,'close');}
});
