import test from 'node:test';import assert from 'node:assert/strict';
import {createNewsBridge} from '../integrations/news-keychain-mcp.mjs';
const token='tbn_'+'a'.repeat(64);
test('News bridge binds existing credential to fixed source and preserves read-only MCP replies',async()=>{
 let calls=0;const handle=createNewsBridge({loadToken:()=>token,request:async(url,options)=>{
  calls++;assert.equal(url,'https://news.bittrees.org/api/mcp');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);
  const m=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[]}}));
 }});
 assert.deepEqual(await handle({jsonrpc:'2.0',id:1,method:'tools/list'}),{jsonrpc:'2.0',id:1,result:{tools:[]}});
 assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
 assert.equal((await handle({jsonrpc:'2.0',id:2,method:'arbitrary/fetch'})).error.code,-32601);assert.equal(calls,1);
});
test('missing credentials, authentication denials, oversized and mismatched replies fail without disclosing secrets',async()=>{
 for(const variant of ['missing','invalid','denied','oversized','wrong-id']){
  let calls=0;const handle=createNewsBridge({loadToken:()=>{if(variant==='missing')throw Error(token);return variant==='invalid'?'Bearer '+token:token;},request:async()=>{
   calls++;if(variant==='denied')return new Response(token,{status:401});if(variant==='oversized')return new Response('x'.repeat(4_000_001));return new Response(JSON.stringify({jsonrpc:'2.0',id:9,result:token}));
  }});
  const r=await handle({jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(r.error.code,-32001);assert.ok(!JSON.stringify(r).includes(token));
  if(['missing','invalid'].includes(variant))assert.equal(calls,0);
 }
});
