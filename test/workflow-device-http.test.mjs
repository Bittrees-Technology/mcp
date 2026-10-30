import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,generateKeyPairSync,createHash,sign,verify} from 'node:crypto';
import {WorkflowDevices} from '../src/service/workflow-devices.mjs';
import {RolesConsumer} from '../src/service/roles-consumer.mjs';
import {createMcpHandler} from '../src/service/http.mjs';
import {canonical,requestMessage,decisionMessage,verifyDecision} from '../src/service/roles-proof.mjs';
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
test('HTTP native device proof -> current Roles -> exact source receipt; anonymous, browser, scope and revocation deny',async()=>{
 const device=keys(),gateway=keys(),roles=keys(),token='fixture-local-device-token-123456789',sourceToken='fixture-source-token-1234567890123456789';
 const principal='agent:'+randomUUID(),credentialId=createHash('sha256').update(device.publicKey).digest('hex'),delegationId=randomUUID(),connectionId=randomUUID(),workflowId='local-review';
 const actor={tenant:'test',subject:'device',tokenHash:createHash('sha256').update(token).digest('hex'),audience:'https://mcp.bittrees.org',expiresAt:Date.now()+60000,permissions:['catalog:read','workflow:execute'],projectIds:['workflow'],rolesAuthorityBinding:'device'};
 const binding={id:'device',tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,workspace:'w',principal,credentialId,publicKey:device.publicKey,delegationId,permissions:['claim','renew','complete'].map(op=>({project:'workflow',resource:'workflow:'+workflowId,action:'workflow:'+op}))};
 let revoked=false,decisions=0,sourceCalls=0;
 const consumer=new RolesConsumer({gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,bindings:[binding],request:async(url,options)=>{
  assert.equal(url,'https://roles.bittrees.org/api/authority/mcp-decision');decisions++;
  const b=JSON.parse(options.body),bytes=Buffer.from(requestMessage(b.request));
  assert.ok(verify(null,bytes,gateway.publicKey,Buffer.from(b.signature,'base64')));
  assert.ok(verify(null,bytes,device.publicKey,Buffer.from(b.principalSignature,'base64')));
  const decision={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request:b.request,allowed:!revoked,requiresSourceAuthorization:true,checkedAt:Date.now(),expiresAt:Date.now()+4000};
  return Response.json({decision,signature:sign(null,Buffer.from(decisionMessage(decision)),roles.privateKey).toString('base64')});
 }});
 const adapter=new WorkflowDevices({rolesConsumer:consumer,connections:[{tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,token:sourceToken,connections:[{connectionId,workflowId}]}],request:async(url,options)=>{
  sourceCalls++;assert.equal(url,'https://workflow.bittrees.org/api/device/call');assert.equal(options.headers.authorization,'Bearer '+sourceToken);
  const b=JSON.parse(options.body),d=verifyDecision(b.decision,b.decision.decision.request,roles.publicKey);
  assert.equal(d.allowed,true);assert.equal(d.request.parametersDigest,createHash('sha256').update(canonical({tool:'workflow_'+b.operation,arguments:b.arguments})).digest('hex'));
  return Response.json({job:null});
 }});
 const server=createServer(createMcpHandler({engine:{store:{transaction:()=>{throw Error('Unexpected automation store access')}}},credentials:[actor],workflowDevices:adapter}));server.listen(0,'127.0.0.1');await once(server,'listening');
 const endpoint='http://127.0.0.1:'+server.address().port+'/mcp?mode=selected&projects=workflow';
 const call=async(name,args,{proof=true,auth=true,extra={}}={})=>{
  const body={jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}};
  const request={version:1,source:'mcp.bittrees.org',audience:'https://roles.bittrees.org/api/authority/mcp-decision',requestId:randomUUID(),operationId:args.operationId,parametersDigest:createHash('sha256').update(canonical({tool:name,arguments:args})).digest('hex'),issuedAt:Date.now(),principal,credentialId,delegationId,tenant:actor.tenant,workspace:'w',project:'workflow',resource:'workflow:'+workflowId,action:name.replace('_',':'),stage:'execute'};
  const signed={request,signature:sign(null,Buffer.from(requestMessage(request)),device.privateKey).toString('base64')};
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{}),...(proof?{'x-bittrees-agent-proof':Buffer.from(JSON.stringify(signed)).toString('base64url')}:{}),...extra},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 };
 try{
  const args={connectionId,workflowId,operationId:randomUUID()};
  assert.notEqual((await call('workflow_claim',args,{auth:false})).status,200);
  assert.notEqual((await call('workflow_claim',args,{proof:false})).status,200);
  for(const extra of [{origin:''},{origin:'https://mcp.bittrees.org'},{cookie:''},{'content-encoding':'identity'}])assert.notEqual((await call('workflow_claim',args,{extra})).status,200);
  assert.equal(sourceCalls,0);
  const ok=await call('workflow_claim',args);assert.equal(ok.status,200);assert.deepEqual(ok.body.result.structuredContent,{job:null});
  assert.notEqual((await call('workflow_claim',{...args,connectionId:randomUUID()})).status,200);
  revoked=true;assert.notEqual((await call('workflow_claim',args)).status,200);
  assert.equal(sourceCalls,1);assert.equal(decisions,2,'fresh Roles decision on each authorized attempt, no cached allow');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
