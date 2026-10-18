import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authenticate} from '../src/service/http.mjs';
test('device proofs remain request-scoped and malformed headers fail closed',()=>{
 const token='test-device-transport-credential',actor={tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:Date.now()+60000};
 const proof={request:{requestId:'untrusted-until-verified'},signature:'proof'};
 const headers={authorization:'Bearer '+token,'x-bittrees-agent-proof':Buffer.from(JSON.stringify(proof)).toString('base64url')};
 const result=authenticate(headers,[actor]);assert.deepEqual(result.rolesProof,proof);assert.equal(actor.rolesProof,undefined);
 assert.equal(authenticate({authorization:headers.authorization},[actor]).rolesProof,undefined);
 for(const encoded of ['*','a'.repeat(16385),Buffer.from('invalid JSON').toString('base64url'),['abc']])assert.throws(()=>authenticate({...headers,'x-bittrees-agent-proof':encoded},[actor]));
});

test('native challenge survives HTTP and proof bundles stay bounded and private',async()=>{
 const {createServer}=await import('node:http'),{once}=await import('node:events');
 const {createMcpHandler}=await import('../src/service/http.mjs');
 const {Engine}=await import('../src/service/engine.mjs'),{emptyState}=await import('../src/service/store.mjs');
 const token='native-task-test-transport',actor={tenant:'test',subject:'owner',audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,projectIds:['crm','agent'],permissions:['catalog:read','task-sync:read'],tokenHash:createHash('sha256').update(token).digest('hex')};
 const challenge={type:'roles-proof-required',request:{operationId:'fixture'},parameters:{tool:'projects.list',arguments:{}}};
 const handler=createMcpHandler({engine:new Engine({transaction:async fn=>fn(emptyState())}),credentials:[actor],taskSync:{call:async a=>{assert.deepEqual(a.rolesProof,{proofs:[]});throw Object.assign(Error('Local device signature required'),{statusCode:428,deviceChallenge:challenge});}}});
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/mcp?mode=selected&projects=crm,agent`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-bittrees-agent-proof':Buffer.from(JSON.stringify({proofs:[]})).toString('base64url')},body:JSON.stringify({jsonrpc:'2.0',id:42,method:'tools/call',params:{name:'task_sync_preview',arguments:{}}})});
 assert.equal(response.status,428);const result=await response.json();assert.equal(result.id,42);assert.deepEqual(result.error.data,challenge);assert.equal(actor.rolesProof,undefined);
 const header=Buffer.from(JSON.stringify({proofs:[{},{},{},{}]})).toString('base64url');assert.throws(()=>authenticate({authorization:'Bearer '+token,'x-bittrees-agent-proof':header},[actor]));
 }finally{server.close();await once(server,'close');}
});
