import {createHash,createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
import {canonical,requestMessage,verifyDecision,verifyEd25519,DECISION_ENDPOINT} from './roles-proof.mjs';
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
    return {consumerEnforcement:'required-source-and-ai',keysConfigured,configuredBindings:this.bindings.length,enrollment:'not-attested',liveExecution:'not-verified'};
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
      if((b.leaseId!=null||b.runtimeBindingDigest!=null)&&(!uuid.test(b.leaseId??'')||!(/^[a-f0-9]{64}$/).test(b.runtimeBindingDigest??'')||b.delegationId!=null))throw denied();
      const deviceHeld=b.publicKey!=null;
      if(deviceHeld&&b.privateKey!=null)throw denied();
      if(deviceHeld&&scope.deviceChallenge===true&&!b.leaseId)throw denied();
      const key=deviceHeld?createPublicKey(b.publicKey):createPrivateKey(b.privateKey),gateway=createPrivateKey(this.gatewayKey);
      if(key.asymmetricKeyType!=='ed25519'||gateway.asymmetricKeyType!=='ed25519')throw denied();
      const publicKey=deviceHeld?key:createPublicKey(key);
      const credentialId=createHash('sha256').update(publicKey.export({type:'spki',format:'pem'})).digest('hex');
      if(credentialId!==b.credentialId)throw denied();
      const request={version:1,source:'mcp.bittrees.org',audience:DECISION_ENDPOINT,requestId:randomUUID(),operationId:scope.operationId,
        parametersDigest:createHash('sha256').update(canonical(parameters)).digest('hex'),issuedAt:this.clock(),principal:b.principal,
        credentialId,delegationId:b.delegationId??null,...(b.leaseId?{leaseId:b.leaseId,runtimeBindingDigest:b.runtimeBindingDigest}:{}),tenant:b.tenant,workspace:b.workspace,project:scope.project,resource:scope.resource,action:scope.action,stage:scope.stage??'execute'};
      let principalSignature;
      if(deviceHeld) {
        const proofs=actor.rolesProof?.proofs??(actor.rolesProof?[actor.rolesProof]:[]);
        if(!Array.isArray(proofs)||proofs.length>3)throw denied();
        const matches=proofs.filter(p=>p?.request?.project===request.project&&p.request.resource===request.resource&&p.request.action===request.action&&p.request.parametersDigest===request.parametersDigest);
        if(matches.length>1)throw denied();
        const proof=matches[0], supplied=proof?.request;
        if(!supplied&&scope.deviceChallenge===true)throw Object.assign(new Error('Local device signature required'),{statusCode:428,deviceChallenge:{type:'roles-proof-required',request,parameters}});
        if(!supplied||!uuid.test(supplied.requestId)||!Number.isSafeInteger(supplied.issuedAt)||Math.abs(this.clock()-supplied.issuedAt)>15000)throw denied();
        request.requestId=supplied.requestId;request.issuedAt=supplied.issuedAt;
        if(canonical(request)!==canonical(supplied)||!verifyEd25519(requestMessage(request),proof.signature,b.publicKey))throw denied();
        principalSignature=proof.signature;
      }
      const message=Buffer.from(requestMessage(request));
      if(!deviceHeld)principalSignature=sign(null,message,key).toString('base64');
      let response;try { response=await this.request(DECISION_ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json'},
        body:JSON.stringify({request,signature:sign(null,message,gateway).toString('base64'),principalSignature})}); } catch {throw Object.assign(new Error('Roles temporarily unavailable'),{statusCode:503,transient:true});}
      if([502,503,504].includes(response.status))throw Object.assign(new Error('Roles temporarily unavailable'),{statusCode:503,transient:true});
      if(!response.ok)throw denied();
      const raw=await response.text();if(Buffer.byteLength(raw)>32768)throw denied();
      const decision=verifyDecision(JSON.parse(raw),request,this.decisionKey,this.clock());
      if(decision.allowed!==true)throw denied();
      // No reusable allow token escapes this function; invoke once immediately.
    } catch (error) {if(error.transient===true||error.deviceChallenge)throw error;throw denied();}
    return effect(parameters);
  }
}
