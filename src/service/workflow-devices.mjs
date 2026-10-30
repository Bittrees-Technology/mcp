import {authorize,fail} from './engine.mjs';
import {canonical} from './roles-proof.mjs';
import {WORKFLOW_DEVICE_TOOLS,workflowDeviceArguments,readWorkflowDeviceResponse} from './workflow-device-contract.mjs';
export {WORKFLOW_DEVICE_TOOLS} from './workflow-device-contract.mjs';
const ENDPOINT='https://workflow.bittrees.org/api/device/call';
export class WorkflowDevices {
 constructor({connections=[],rolesConsumer,request=fetch}={}){Object.assign(this,{connections,rolesConsumer,request});}
 connection(actor,projects){
  authorize(actor,'workflow:execute');
  const matches=this.connections.filter(c=>c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash),c=matches[0];
  if(matches.length!==1||!projects.includes('workflow')||!actor.projectIds.includes('workflow')||!actor.rolesAuthorityBinding||typeof this.rolesConsumer?.execute!=='function'||typeof c.token!=='string'||c.token.length<32||!Array.isArray(c.connections))throw fail('Workflow connection and Roles authority required',403);
  return c;
 }
 list(actor,projects){try{this.connection(actor,projects);return structuredClone(WORKFLOW_DEVICE_TOOLS)}catch{return []}}
 async call(actor,projects,name,raw){
  actor=structuredClone(actor);projects=structuredClone(projects);
  const c=this.connection(actor,projects),binding=canonical(c);
  let args;try{args=workflowDeviceArguments(name,raw)}catch{throw fail('Exact approved workflow arguments required',403)}
  const current=()=>{
   const live=this.connection(actor,projects);
   if(canonical(live)!==binding||!live.connections.some(x=>x.connectionId===args.connectionId&&x.workflowId===args.workflowId))throw fail('Exact approved workflow connection required',403);
  };
  current();
  const parameters={tool:name,arguments:args};
  return this.rolesConsumer.execute(actor,actor.rolesAuthorityBinding,{project:'workflow',resource:'workflow:'+args.workflowId,action:name.replace('_',':'),operationId:args.operationId,stage:'execute'},parameters,async(payload,decision)=>{
   current();
   if(canonical(payload)!==canonical(parameters))throw fail('Workflow parameters changed',403);
   const body=JSON.stringify({operation:name.slice('workflow_'.length),arguments:args,decision});
   if(Buffer.byteLength(body)>24000)throw fail('Workflow source request too large',413);
   const signal=AbortSignal.timeout(15000);
   const r=await this.request(ENDPOINT,{method:'POST',redirect:'error',signal,headers:{authorization:'Bearer '+c.token,'content-type':'application/json',accept:'application/json','accept-encoding':'identity'},body});
   let result;try{result=await readWorkflowDeviceResponse(r,name,signal)}catch{throw fail('Workflow outcome unavailable; reconcile the original operation',r.status===403?403:409)}
   current();return result;
  });
 }
}
