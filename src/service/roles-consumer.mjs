import {createHash,createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
import {canonical,requestMessage,verifyDecision,DECISION_ENDPOINT} from './roles-proof.mjs';
import {CATALOG,eligible} from '../ecosystem/catalog.mjs';
const denied=()=>Object.assign(new Error('Current Roles execution authority required'),{statusCode:403});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const exact=/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,127}$/;
// Only explicitly enrolled worker identities belong here. No person keys or
// automatic promotion of existing transport/source grants is supported.
export class RolesConsumer {
  constructor({gatewayKey,decisionKey,bindings=[],request=fetch,clock=Date.now}={}) {
    Object.assign(this,{gatewayKey,decisionKey,bindings,request,clock});
  }
  readiness() {
    let keysConfigured=false;try {keysConfigured=createPrivateKey(this.gatewayKey).asymmetricKeyType==='ed25519'&&createPublicKey(this.decisionKey).asymmetricKeyType==='ed25519';}catch{}
    return {consumerEnforcement:'opt-in-source-and-ai',keysConfigured,configuredBindings:this.bindings.length,enrollment:'not-attested',liveExecution:'not-verified'};
  }
  async execute(actor,bindingId,scope,parameters,effect) {
    actor=structuredClone(actor);scope=structuredClone(scope);parameters=structuredClone(parameters);
    try {
      const b=this.bindings.find(b=>b.id===bindingId);
      if(!b||b.tenant!==actor.tenant||b.subject!==actor.subject||b.actorTokenHash!==actor.tokenHash||
        !actor.projectIds.includes(scope.project)||!CATALOG.projects.some(p=>p.id===scope.project&&eligible(p))||
        !/^(agent|service):/.test(b.principal)||!uuid.test(b.principal.split(':')[1])||
        !['enqueue','execute'].includes(scope.stage??'execute')||!uuid.test(scope.operationId)||!exact.test(b.tenant)||!exact.test(b.workspace)||!exact.test(scope.project)||
        !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(scope.action)||scope.action.startsWith('delegate:')||
        typeof scope.resource!=='string'||!scope.resource.length||scope.resource.length>512||/[\x00-\x1f*]/.test(scope.resource)||
        (b.delegationId!=null&&!uuid.test(b.delegationId))||
        !b.permissions?.some(p=>p.project===scope.project&&p.resource===scope.resource&&p.action===scope.action))throw denied();
      const key=createPrivateKey(b.privateKey),gateway=createPrivateKey(this.gatewayKey);
      if(key.asymmetricKeyType!=='ed25519'||gateway.asymmetricKeyType!=='ed25519')throw denied();
      const credentialId=createHash('sha256').update(createPublicKey(key).export({type:'spki',format:'pem'})).digest('hex');
      if(credentialId!==b.credentialId)throw denied();
      const request={version:1,source:'mcp.bittrees.org',audience:DECISION_ENDPOINT,requestId:randomUUID(),operationId:scope.operationId,
        parametersDigest:createHash('sha256').update(canonical(parameters)).digest('hex'),issuedAt:this.clock(),principal:b.principal,
        credentialId,delegationId:b.delegationId??null,tenant:b.tenant,workspace:b.workspace,project:scope.project,resource:scope.resource,action:scope.action,stage:scope.stage??'execute'};
      const message=Buffer.from(requestMessage(request));
      const response=await this.request(DECISION_ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json'},
        body:JSON.stringify({request,signature:sign(null,message,gateway).toString('base64'),principalSignature:sign(null,message,key).toString('base64')})});
      if(!response.ok)throw denied();
      const raw=await response.text();if(Buffer.byteLength(raw)>32768)throw denied();
      const decision=verifyDecision(JSON.parse(raw),request,this.decisionKey,this.clock());
      if(decision.allowed!==true)throw denied();
      // No reusable allow token escapes this function; invoke once immediately.
    } catch {throw denied();}
    return effect(parameters);
  }
}
