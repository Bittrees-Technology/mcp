import {createHash,createPublicKey,createPrivateKey} from 'node:crypto';
import {PrivateReadJournal} from './private-read-journal.mjs';
import {canonical,verifyDecision,verifyEd25519,requestMessage} from './roles-proof.mjs';
import {HEX,UUID,INSIGHTS_AUDIENCE,MAIL_AUDIENCE,deny,insightsSchema,insightsSelection,insightsContext,insightsChallenge,mailSchema,mailArguments,mailChallenge} from './private-read-contract.mjs';
const families={private_insights_read_analytics:{source:'insights',operation:'insights.read_analytics',action:'analytics.read',resource:'analytics:permissioned',endpoint:INSIGHTS_AUDIENCE+'/read-analytics',schema:insightsSchema(false)},private_insights_export_analytics:{source:'insights',operation:'insights.export_analytics',action:'analytics.export',resource:'analytics:permissioned',endpoint:INSIGHTS_AUDIENCE+'/export-analytics',schema:insightsSchema(true)},private_mail_read_selected_message:{source:'mail',operation:'mail.read_selected_message',endpoint:MAIL_AUDIENCE,schema:mailSchema}};
const validToken=t=>typeof t==='string'&&t.length>=32&&t.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(t);
// Default-off, no connection provisioning, grants, retry, or general URL forwarding.
export class PrivateReads {
 constructor({enabled=false,deviceEnabled=false,store,connections=[],rolesConsumer,request=fetch,clock=Date.now}={}){Object.assign(this,{enabled,deviceEnabled,connections,rolesConsumer,request,clock});this.journal=new PrivateReadJournal(store,{clock});}
 connection(actor,projects,f){
  if(this.enabled!==true||(!Number.isSafeInteger(actor?.expiresAt)||actor.expiresAt<=this.clock())&&!(actor?.managed===true&&actor.expiresAt===null)||!actor?.permissions?.includes('sources:propose')||!actor.rolesAuthorityBinding||!projects.includes(f.source)||!actor.projectIds?.includes(f.source)||!this.rolesConsumer)return deny();
  const matches=this.connections.filter(c=>c.enabled===true&&c.source===f.source&&c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash&&c.rolesAuthorityBinding===actor.rolesAuthorityBinding);
  if(matches.length!==1)return deny();const c=matches[0];
  const binding=this.rolesConsumer.bindings?.find(b=>b.id===c.rolesAuthorityBinding);
  if(!binding?.permissions?.some(p=>p.project===f.source&&p.resource===(f.resource??'mail:selected-read')&&(f.action?p.action===f.action:['mail.read_selected_metadata','mail.read_selected_plain'].includes(p.action))))return deny();
  const native=c.proofMode==='device-held-delegated-v1';
  if(!binding||!UUID.test(binding.delegationId)||binding.leaseId!=null||binding.runtimeBindingDigest!=null)return deny();
  if(native){if(this.deviceEnabled!==true||!this.journal.store?.transaction||typeof binding.publicKey!=='string'||binding.privateKey!=null)return deny();}
  else if(c.proofMode!=='gateway-held-delegated-v1'||binding.publicKey!=null||typeof binding.privateKey!=='string')return deny();
  if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=this.clock()||!validToken(c.token)||!c.operations?.includes(f.operation)||!c.gatewayPublicKey||!c.actorPublicKey)return deny();
  try{if((native?createPublicKey(binding.publicKey):createPublicKey(createPrivateKey(binding.privateKey))).export({type:'spki',format:'pem'})!==createPublicKey(c.actorPublicKey).export({type:'spki',format:'pem'})||createPublicKey(createPrivateKey(this.rolesConsumer.gatewayKey)).export({type:'spki',format:'pem'})!==createPublicKey(c.gatewayPublicKey).export({type:'spki',format:'pem'}))return deny();}catch{return deny();}
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
 async call(actor,projects,name,args,options={}){
  const f=families[name];if(!Object.hasOwn(families,name))return deny();const c=structuredClone(this.connection(actor,projects,f));
  const parameters=f.source==='insights'?insightsSelection(args,f.action==='analytics.export'):mailArguments(args);
  const action=f.action??(parameters.content==='plain'?'mail.read_selected_plain':'mail.read_selected_metadata');
  if(!this.rolesConsumer.bindings.find(b=>b.id===c.rolesAuthorityBinding)?.permissions?.some(p=>p.project===f.source&&p.resource===(f.resource??'mail:selected-read')&&p.action===action))return deny();
  const native=c.proofMode==='device-held-delegated-v1';
  if(!options||Object.getPrototypeOf(options)!==Object.prototype||Object.keys(options).some(k=>!['operationId','fresh'].includes(k))||options.operationId!==undefined&&!UUID.test(options.operationId)||options.fresh!==undefined&&typeof options.fresh!=='boolean'||options.operationId&&options.fresh)return deny();
  if(!native&&Object.keys(options).length)return deny();
  let row,operationId,context;
  const key=createHash('sha256').update(canonical({tenant:actor.tenant,subject:actor.subject,tokenHash:actor.tokenHash,binding:actor.rolesAuthorityBinding,connection:c,name,parameters})).digest('hex');
  let prepare=true;
  if(native){
   if(actor.rolesProof&&!options.operationId)return deny();
   if(options.operationId){row=await this.journal.load(key,options.operationId);prepare=false;}
   else{const start=await this.journal.begin(key,{tool:name},{fresh:options.fresh===true});row=start.row;prepare=start.created;}
   if(!prepare){
    if(!['prepared','challenged'].includes(row.status)||row.expiresAt<=this.clock())return deny();
    operationId=row.operationId;context=row.parameters;
    const expected=f.source==='mail'?{version:1,sourceAudience:MAIL_AUDIENCE,connectionId:c.connectionId,mailboxBinding:c.mailboxBinding,selectionRevision:c.selectionRevision,...parameters,operationId}:insightsContext(c,f.operation,parameters);
    if(canonical(context)!==canonical(expected))return deny();
   }
  }
  if(prepare){
   try{
    const response=f.source==='mail'?await this.json(MAIL_AUDIENCE+'/operations',c,parameters):await this.json(INSIGHTS_AUDIENCE+'/operations',c,{operation:f.operation,arguments:parameters});
    context=f.source==='mail'?mailChallenge(c,parameters,response,this.clock()):insightsChallenge(c,f.operation,parameters,response,this.clock());operationId=response.operationId;
    if(native)row=await this.journal.prepared(row.id,operationId,context,response.expiresAt);
   }catch(e){if(native)await this.journal.hold(row.id);throw e;}
  }
  if(native&&row.challenge){
   if(!actor.rolesProof)throw Object.assign(Error('Local device signature required'),{statusCode:428,deviceChallenge:{...row.challenge,operationId}});
   const proofs=actor.rolesProof.proofs??[actor.rolesProof];
   const matches=proofs.filter(p=>canonical(p?.request??null)===canonical(row.challenge.request));
   if(matches.length!==1||!verifyEd25519(requestMessage(row.challenge.request),matches[0].signature,c.actorPublicKey))return deny();
   row=await this.journal.claim(row.id,row.challenge);
  }else if(native&&actor.rolesProof)return deny();
  const scope={project:f.source,operationId,resource:f.resource??'mail:selected-read',action,stage:'execute',...(native?{deviceChallenge:true,delegatedDeviceReadChallenge:true}:{})};
  try{return await this.rolesConsumer.execute(actor,c.rolesAuthorityBinding,scope,context,async(payload,envelope,proof)=>{
   const recheck=()=>{
    if(canonical(this.connection(actor,projects,f))!==canonical(c))return deny();
    if(!proof||canonical(proof.request)!==canonical(envelope?.decision?.request)||canonical(proof.decisionEnvelope)!==canonical(envelope)||!verifyEd25519(requestMessage(proof.request),proof.signature,c.gatewayPublicKey)||!verifyEd25519(requestMessage(proof.request),proof.principalSignature,c.actorPublicKey))return deny();
    const d=verifyDecision(envelope,proof.request,this.rolesConsumer.decisionKey,this.clock());if(d.allowed!==true||d.request.stage!=='execute'||d.request.operationId!==operationId||d.request.project!==scope.project||d.request.resource!==scope.resource||d.request.action!==scope.action||d.request.parametersDigest!==createHash('sha256').update(canonical(context)).digest('hex')||canonical(payload)!==canonical(context))return deny();return d;
   };
   const decision=recheck(),raw=JSON.stringify(proof);if(Buffer.byteLength(raw)>12288||Buffer.from(raw).toString('base64url').length>16384)return deny();
   const headers={'x-bittrees-mcp-decision':Buffer.from(raw).toString('base64url')};
   const body=f.source==='mail'?{jsonrpc:'2.0',id:operationId,method:'tools/call',params:{name:f.operation,arguments:parameters}}:parameters;
   if(f.source==='mail')headers['x-bittrees-mcp-operation-id']=operationId;
   const receipt={'X-Bittrees-Mcp-Request-Id':proof.request.requestId,'X-Bittrees-Mcp-Operation-Id':operationId,'X-Bittrees-Mcp-Decision-Digest':createHash('sha256').update(canonical(envelope)).digest('hex')};
   if(native)await this.journal.check(row.id);
   const result=await this.json(f.endpoint,c,body,headers,decision.expiresAt,receipt);recheck();
   if(native)await this.journal.check(row.id);
   if(result?.error||result?.result?.isError||result?.isError)return deny();
   if(native)await this.journal.complete(row.id);
   // Awaited journal locks can outlive the five-second decision. This check
   // must be synchronous, after the last await, immediately before delivery.
   recheck();
   return result;
  });}catch(error){
   if(native&&error.deviceChallenge){
    row=await this.journal.challenged(row.id,error.deviceChallenge);
    throw Object.assign(Error('Local device signature required'),{statusCode:428,deviceChallenge:{...row.challenge,operationId}});
   }
   if(native)await this.journal.hold(row.id);
   throw error;
  }
 }
}
