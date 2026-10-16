import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../integrations/app-api-mcp.mjs';
const token='a'.repeat(64), id='11111111-1111-4111-8111-111111111111';
async function client(app,request){const h=handler({app,token,request});await h({jsonrpc:'2.0',id:1,method:'initialize'});return (name,args={})=>h({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});}
test('AutoNote MCP preserves exact meeting binding and source authority',async()=>{
 let seen;
 const call=await client('autonote',async(url,options)=>{seen={url,options};return Response.json({meeting:{id}});});
 const result=await call('autonote.read_transcript',{meetingId:id});
 assert.equal(result.result.isError,undefined);
 assert.equal(seen.url,'https://autonote.bittrees.org/api/integrations/ai/read');
 assert.deepEqual(JSON.parse(seen.options.body),{meetingId:id});
 assert.equal(seen.options.redirect,'error');
 assert.equal(seen.options.headers.Authorization,'Bearer '+token);
 assert.equal(JSON.stringify(result).includes(token),false);
});
test('cross-app tools, credentials, URLs, invalid IDs and approval calls are rejected before network',async()=>{
 const call=await client('autonote',()=>{throw Error('must not fetch');});
 for(const [name,args] of [['roles.read_access',{}],['autonote.approve',{}],['autonote.read_transcript',{meetingId:'bad'}],['autonote.review_status',{url:'http://localhost'}],['autonote.review_status',{token}]])assert.equal((await call(name,args)).error.code,-32602);
});
test('source revocation and policy denial remain errors without fallback or credential disclosure',async()=>{
 for(const status of [401,403,429,500]){let calls=0;const call=await client('roles',async()=>{calls++;return new Response(token,{status});});const result=await call('roles.read_policy');assert.equal(result.result.isError,true);assert.equal(JSON.stringify(result).includes(token),false);assert.equal(calls,1);}
});
test('source redirects and oversized responses fail closed',async()=>{
 const call=await client('roles',async()=>new Response('x'.repeat(4_000_001)));
 assert.equal((await call('roles.read_access')).result.isError,true);
 const redirected=await client('roles',async()=>({ok:true,redirected:true}));
 assert.equal((await redirected('roles.read_access')).result.isError,true);
});
