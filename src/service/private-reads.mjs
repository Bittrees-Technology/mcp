import {createHash,createPublicKey,createPrivateKey} from 'node:crypto';
import {canonical,verifyDecision,verifyEd25519,requestMessage} from './roles-proof.mjs';
import {HEX,UUID,INSIGHTS_AUDIENCE,MAIL_AUDIENCE,deny,insightsSchema,insightsSelection,insightsContext,insightsChallenge,mailSchema,mailArguments,mailChallenge} from './private-read-contract.mjs';
const families={private_insights_read_analytics:{source:'insights',operation:'insights.read_analytics',action:'analytics.read',resource:'analytics:permissioned',endpoint:INSIGHTS_AUDIENCE+'/read-analytics',schema:insightsSchema(false)},private_insights_export_analytics:{source:'insights',operation:'insights.export_analytics',action:'analytics.export',resource:'analytics:permissioned',endpoint:INSIGHTS_AUDIENCE+'/export-analytics',schema:insightsSchema(true)},private_mail_read_selected_message:{source:'mail',operation:'mail.read_selected_message',endpoint:MAIL_AUDIENCE,schema:mailSchema}};
const validToken=t=>typeof t==='string'&&t.length>=32&&t.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(t);
// Default-off, no connection provisioning, grants, retry, or general URL forwarding.
export class PrivateReads {
 constructor({enabled=false,connections=[],rolesConsumer,request=fetch,clock=Date.now}={}){Object.assign(this,{enabled,connections,rolesConsumer,request,clock});}
 connection(actor,projects,f){
  if(this.enabled!==true||(!Number.isSafeInteger(actor?.expiresAt)||actor.expiresAt<=this.clock())&&!(actor?.managed===true&&actor.expiresAt===null)||!actor?.permissions?.includes('sources:propose')||!actor.rolesAuthorityBinding||!projects.includes(f.source)||!actor.projectIds?.includes(f.source)||!this.rolesConsumer)return deny();
  const matches=this.connections.filter(c=>c.enabled===true&&c.source===f.source&&c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash&&c.rolesAuthorityBinding===actor.rolesAuthorityBinding);
  if(matches.length!==1)return deny();const c=matches[0];
  // This v1 transport has no durable device challenge/resume protocol. Never
  // obtain a device private key or regenerate an operation to bypass that hold.
  const binding=this.rolesConsumer.bindings?.find(b=>b.id===c.rolesAuthorityBinding);
  if(!binding?.permissions?.some(p=>p.project===f.source&&p.resource===(f.resource??'mail:selected-read')&&(f.action?p.action===f.action:['mail.read_selected_metadata','mail.read_selected_plain'].includes(p.action))))return deny();
  if(c.proofMode!=='gateway-held-delegated-v1'||!binding||!UUID.test(binding.delegationId)||binding.publicKey!=null||binding.leaseId!=null||binding.runtimeBindingDigest!=null||typeof binding.privateKey!=='string')return deny();
  if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=this.clock()||!validToken(c.token)||!c.operations?.includes(f.operation)||!c.gatewayPublicKey||!c.actorPublicKey)return deny();
  try{if(createPublicKey(createPrivateKey(binding.privateKey)).export({type:'spki',format:'pem'})!==createPublicKey(c.actorPublicKey).export({type:'spki',format:'pem'})||createPublicKey(createPrivateKey(this.rolesConsumer.gatewayKey)).export({type:'spki',format:'pem'})!==createPublicKey(c.gatewayPublicKey).export({type:'spki',format:'pem'}))return deny();}catch{return deny();}
  if(f.source==='insights'?(!UUID.test(c.connectionId)||!HEX.test(c.connectionBindingDigest)):(![c.connectionId,c.mailboxBinding,c.selectionRevision].every(v=>typeof v==='string'&&HEX.test(v))))return deny();
  return c;
 }
 list(actor,projects){return Object.entries(families).flatMap(([name,f])=>{try{this.connection(actor,projects,f);return [{name,description:'Bounded private read under current Roles and native source permissions. No writes or automatic retries.',inputSchema:f.schema,annotations:{readOnlyHint:true,openWorldHint:false}}];}catch{return [];}});}
 async json(url,c,body,headers={},deadline=this.clock()+4000,receipt){
  const remaining=Math.min(4000,deadline-this.clock());if(remaining<=0)return deny();
  let r;try{r=await this.request(url,{method:'POST',headers:{authorization:`Bearer ${c.token}`,'content-type':'application/json',...headers},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(remaining)});}catch{throw Object.assign(Error('Private source unavailable; reconcile before another attempt'),{statusCode:503});}
  if(!r.ok||r.redirected||!r.body)return deny();
  if(receipt&&Object.entries(receipt).some(([key,value])=>r.headers.get(key)!==value))return deny();const reader=r.body.getReader();let length=0;const chunks=[];
  try{while(true){const x=await reader.read();if(x.done)break;length+=x.value.length;if(length>512000)return deny();chunks.push(x.value);}}finally{await reader.cancel();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return deny();}
 }
 async call(actor,projects,name,args){
  const f=families[name];if(!Object.hasOwn(families,name))return deny();const c=structuredClone(this.connection(actor,projects,f));
  const parameters=f.source==='insights'?insightsSelection(args,f.action==='analytics.export'):mailArguments(args);
  const action=f.action??(parameters.content==='plain'?'mail.read_selected_plain':'mail.read_selected_metadata');
  if(!this.rolesConsumer.bindings.find(b=>b.id===c.rolesAuthorityBinding)?.permissions?.some(p=>p.project===f.source&&p.resource===(f.resource??'mail:selected-read')&&p.action===action))return deny();
  let operationId,context;
  if(f.source==='mail'){
   // Challenge is consent/binding preparation, never message retrieval or authority.
   const response=await this.json(MAIL_AUDIENCE+'/operations',c,parameters);context=mailChallenge(c,parameters,response,this.clock());operationId=context.operationId;
  }else{const response=await this.json(INSIGHTS_AUDIENCE+'/operations',c,{operation:f.operation,arguments:parameters});context=insightsChallenge(c,f.operation,parameters,response,this.clock());operationId=response.operationId;}
  const scope={project:f.source,operationId,resource:f.resource??'mail:selected-read',action,stage:'execute'};
  return this.rolesConsumer.execute(actor,c.rolesAuthorityBinding,scope,context,async(payload,envelope,proof)=>{
   const recheck=()=>{
    if(canonical(this.connection(actor,projects,f))!==canonical(c))return deny();
    if(!proof||canonical(proof.request)!==canonical(envelope?.decision?.request)||canonical(proof.decisionEnvelope)!==canonical(envelope)||!verifyEd25519(requestMessage(proof.request),proof.signature,c.gatewayPublicKey)||!verifyEd25519(requestMessage(proof.request),proof.principalSignature,c.actorPublicKey))return deny();
    const d=verifyDecision(envelope,proof.request,this.rolesConsumer.decisionKey,this.clock());if(d.allowed!==true||d.request.stage!=='execute'||d.request.operationId!==operationId||d.request.project!==scope.project||d.request.resource!==scope.resource||d.request.action!==scope.action||d.request.parametersDigest!==createHash('sha256').update(canonical(context)).digest('hex')||canonical(payload)!==canonical(context))return deny();return d;
   };
   const decision=recheck(),raw=JSON.stringify(proof);if(Buffer.byteLength(raw)>12288||Buffer.from(raw).toString('base64url').length>16384)return deny();
   const headers={'x-bittrees-mcp-decision':Buffer.from(raw).toString('base64url')};
   const body=f.source==='mail'?{jsonrpc:'2.0',id:operationId,method:'tools/call',params:{name:f.operation,arguments:parameters}}:parameters;
   if(f.source==='mail')headers['x-bittrees-mcp-operation-id']=operationId;
   const receipt={'Request-Id':proof.request.requestId,'Operation-Id':operationId,'Decision-Digest':createHash('sha256').update(canonical(envelope)).digest('hex')};
   const result=await this.json(f.endpoint,c,body,headers,decision.expiresAt,receipt);recheck();
   if(result?.error||result?.result?.isError||result?.isError)return deny();
   return result;
  });
 }
}
