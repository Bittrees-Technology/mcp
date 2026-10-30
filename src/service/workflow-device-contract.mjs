import {createHash} from 'node:crypto';
import {canonical} from './roles-proof.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,required,optional=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const base={connectionId:{type:'string',format:'uuid'},workflowId:{type:'string',minLength:1,maxLength:128},operationId:{type:'string',format:'uuid'}};
const evidence={type:'object',properties:{model:{type:'string',minLength:1,maxLength:160},modelDigest:{type:'string',minLength:1,maxLength:160},inputHash:{type:'string',pattern:'^[a-f0-9]{64}$'},output:{type:'string',minLength:1,maxLength:16000}},required:['model','modelDigest','inputHash','output'],additionalProperties:false};
const freeze=v=>{Object.values(v).forEach(x=>{if(object(x)||Array.isArray(x))freeze(x)});return Object.freeze(v)};
export const WORKFLOW_DEVICE_TOOLS=freeze(['claim','renew','complete'].map(op=>({name:'workflow_'+op,description:({claim:'Claim the next authorized local-model step from Workflows.',renew:'Renew the current workflow step lease under current authority.',complete:'Submit signed device evidence; Workflows queues the next authorized step atomically.'})[op],inputSchema:{type:'object',properties:{...base,...(op==='claim'?{}:{jobId:{type:'string',format:'uuid'},leaseId:{type:'string',format:'uuid'}}),...(op==='complete'?{evidence}: {})},required:[...Object.keys(base),...(op==='claim'?[]:['jobId','leaseId']),...(op==='complete'?['evidence']:[])],additionalProperties:false}})));
export function workflowDeviceArguments(name,value){
 const tool=WORKFLOW_DEVICE_TOOLS.find(t=>t.name===name);
 if(!tool||!exact(value,tool.inputSchema.required)||!uuid.test(value.connectionId)||!uuid.test(value.operationId)||!text(value.workflowId,128))throw Error('Invalid scoped workflow arguments');
 if(name!=='workflow_claim'&&(!uuid.test(value.jobId)||!uuid.test(value.leaseId)))throw Error('Invalid workflow lease');
 if(name==='workflow_complete'){
  const e=value.evidence;
  if(!exact(e,evidence.required)||!text(e.model,160)||!text(e.modelDigest,160)||typeof e.inputHash!=='string'||!hash.test(e.inputHash)||!text(e.output,16000))throw Error('Invalid workflow model evidence');
 }
 if(Buffer.byteLength(JSON.stringify(value))>20000)throw Error('Workflow arguments exceed source byte limit');
 return structuredClone(value);
}
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
export function workflowDeviceResult(name,value){
 if(name==='workflow_claim'&&exact(value,['job'])){
  const j=value.job;
  if(j===null)return value;
  if(exact(j,['id','runId','stepIndex','leaseId','leaseUntil','input','inputHash'])&&uuid.test(j.id)&&uuid.test(j.runId)&&uuid.test(j.leaseId)&&Number.isInteger(j.stepIndex)&&j.stepIndex>=0&&j.stepIndex<30&&instant(j.leaseUntil)&&exact(j.input,['title','instruction'])&&typeof j.input.title==='string'&&j.input.title.length<=120&&typeof j.input.instruction==='string'&&j.input.instruction.length<=600&&typeof j.inputHash==='string'&&hash.test(j.inputHash)&&createHash('sha256').update(canonical(j.input)).digest('hex')===j.inputHash)return value;
 }
 if(name==='workflow_renew'&&exact(value,['leaseUntil'])&&instant(value.leaseUntil))return value;
 if(name==='workflow_complete'&&exact(value,['completed','runId','followUpQueued'],['replayed'])&&value.completed===true&&uuid.test(value.runId)&&typeof value.followUpQueued==='boolean'&&(!Object.hasOwn(value,'replayed')||value.replayed===true))return value;
 throw Error('Invalid workflow source result; reconcile the original operation');
}
export async function readWorkflowDeviceResponse(response,name,signal){
 const reader=response.body?.getReader();if(!reader)throw Error('Missing workflow source response');
 let onAbort;const aborted=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason??Error('Workflow response cancelled'));signal.addEventListener('abort',onAbort,{once:true})});void aborted.catch(()=>{});
 try{
  signal.throwIfAborted();
  if(!response.ok||response.redirected||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||response.headers.has('content-encoding'))throw Error('Workflow source response rejected; reconcile the original operation');
  const chunks=[];let size=0;
  for(;;){const part=await Promise.race([reader.read(),aborted]);if(part.done)break;size+=part.value.byteLength;if(size>64000)throw Error('Workflow response too large');chunks.push(part.value)}
  signal.throwIfAborted();
  return workflowDeviceResult(name,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
 }finally{signal.removeEventListener('abort',onAbort);void reader.cancel().catch(()=>{})}
}
