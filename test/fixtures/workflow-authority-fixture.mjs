import assert from'node:assert/strict';
import{createHash,generateKeyPairSync,randomUUID,sign}from'node:crypto';
import{RolesConsumer}from'../../src/service/roles-consumer.mjs';
import{WorkflowDevices}from'../../src/service/workflow-devices.mjs';
import{canonical,requestMessage,decisionMessage,verifyEd25519,verifyDecision}from'../../src/service/roles-proof.mjs';
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
export function workflowAuthorityFixture({args={connectionId:randomUUID(),workflowId:'review',operationId:randomUUID()}}={}){
 const gateway=keys(),principal=keys(),roles=keys();let now=Date.now(),checks=0,forwards=0,before=()=>{},reply=()=>Response.json({job:null}),lastDecision,denied=false;
 const actor={tenant:'t',subject:'device',tokenHash:'h',audience:'https://mcp.bittrees.org',expiresAt:now+60000,permissions:['workflow:execute'],projectIds:['workflow'],rolesAuthorityBinding:'binding'};
 const c={tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,token:'s'.repeat(32),connections:[{connectionId:args.connectionId,workflowId:args.workflowId}]};
 const binding={id:'binding',tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,workspace:'w',principal:'agent:'+randomUUID(),credentialId:createHash('sha256').update(principal.publicKey).digest('hex'),privateKey:principal.privateKey,delegationId:randomUUID(),permissions:['claim','renew','complete'].map(op=>({project:'workflow',resource:'workflow:'+args.workflowId,action:'workflow:'+op}))};
 const consumer=new RolesConsumer({gatewayKey:gateway.privateKey,decisionKey:roles.publicKey,bindings:[binding],clock:()=>now,request:async(url,options)=>{
  assert.equal(url,'https://roles.bittrees.org/api/authority/mcp-decision');checks++;
  const b=JSON.parse(options.body);assert.ok(verifyEd25519(requestMessage(b.request),b.signature,gateway.publicKey));assert.ok(verifyEd25519(requestMessage(b.request),b.principalSignature,principal.publicKey));
  const d={version:1,issuer:'https://roles.bittrees.org',audience:'https://mcp.bittrees.org',request:b.request,checkedAt:now,expiresAt:now+5000,allowed:!denied,requiresSourceAuthorization:true};
  lastDecision={decision:d,signature:sign(null,Buffer.from(decisionMessage(d)),roles.privateKey).toString('base64')};return Response.json(lastDecision);
 }});
 const execute=consumer.execute.bind(consumer);consumer.execute=async(...xs)=>{await before();return execute(...xs);};
 const adapter=new WorkflowDevices({connections:[c],rolesConsumer:consumer,clock:()=>now,request:async(url,options)=>{
  forwards++;assert.equal(url,'https://workflow.bittrees.org/api/device/call');assert.equal(options.redirect,'error');const b=JSON.parse(options.body),d=verifyDecision(b.decision,b.decision.decision.request,roles.publicKey,now);assert.equal(d.allowed,true);assert.equal(d.request.parametersDigest,createHash('sha256').update(canonical({tool:'workflow_'+b.operation,arguments:b.arguments})).digest('hex'));return reply(b);
 }});
 return {actor,args,c,adapter,consumer,binding,clock:()=>now,advance:ms=>now+=ms,checks:()=>checks,forwards:()=>forwards,lastDecision:()=>lastDecision,before:fn=>before=fn,reply:fn=>reply=fn,deny:()=>denied=true};
}
