import {authorize,fail} from './engine.mjs';
const ENDPOINT='https://workflow.bittrees.org/api/device/call';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const base={connectionId:{type:'string',format:'uuid'},workflowId:{type:'string',minLength:1,maxLength:128},operationId:{type:'string',format:'uuid'}};
export const WORKFLOW_DEVICE_TOOLS=['claim','renew','complete'].map(op=>({name:'workflow_'+op,description:({claim:'Claim the next authorized local-model step from Workflows.',renew:'Renew the current workflow step lease under current authority.',complete:'Submit signed device evidence; Workflows queues the next authorized step atomically.'})[op],inputSchema:{type:'object',properties:{...base,...(op==='claim'?{}:{jobId:{type:'string',format:'uuid'},leaseId:{type:'string',format:'uuid'}}),...(op==='complete'?{evidence:{type:'object',properties:{model:{type:'string'},modelDigest:{type:'string'},inputHash:{type:'string'},output:{type:'string',maxLength:16000}},required:['model','modelDigest','inputHash','output'],additionalProperties:false}}:{})},required:[...Object.keys(base),...(op==='claim'?[]:['jobId','leaseId']),...(op==='complete'?['evidence']:[])],additionalProperties:false}}));
export class WorkflowDevices {
 constructor({connections=[],rolesConsumer,request=fetch}={}){Object.assign(this,{connections,rolesConsumer,request});}
 connection(actor,projects){authorize(actor,'workflow:execute');const c=this.connections.find(c=>c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash);if(!c||!projects.includes('workflow')||!actor.projectIds.includes('workflow')||!actor.rolesAuthorityBinding||!this.rolesConsumer||typeof c.token!=='string'||c.token.length<32)throw fail('Workflow connection and Roles authority required',403);return c;}
 list(actor,projects){try{this.connection(actor,projects);return WORKFLOW_DEVICE_TOOLS}catch{return []}}
 async call(actor,projects,name,args){
 const c=this.connection(actor,projects),tool=WORKFLOW_DEVICE_TOOLS.find(t=>t.name===name);
 if(!tool||!args||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))||tool.inputSchema.required.some(k=>!Object.hasOwn(args,k))||!uuid.test(args.operationId)||!uuid.test(args.connectionId)||typeof args.workflowId!=='string'||!c.connections?.some(x=>x.connectionId===args.connectionId&&x.workflowId===args.workflowId))throw fail('Exact approved workflow connection required',403);
 return this.rolesConsumer.execute(actor,actor.rolesAuthorityBinding,{project:'workflow',resource:'workflow:'+args.workflowId,action:name.replace('_',':'),operationId:args.operationId,stage:'execute'},{tool:name,arguments:args},async(payload,decision)=>{
 const r=await this.request(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},body:JSON.stringify({operation:name.slice('workflow_'.length),arguments:payload.arguments,decision})});
 const raw=await r.text();if(raw.length>64000)throw fail('Workflow response too large',502);
 if(!r.ok)throw fail('Workflow rejected this operation; preserve its retry identity',r.status===403?403:409);
 try{return JSON.parse(raw)}catch{throw fail('Invalid workflow response',502)}
 });
 }
}
