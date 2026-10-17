import {createHash,randomUUID} from 'node:crypto';
import {authorize,fail} from './engine.mjs';
import {planTaskSync} from './task-sync-plan.mjs';
import {canonical} from './roles-proof.mjs';
const SOURCE='https://agent.bittrees.org',CRM='https://crm.bittrees.org/api/integrations/datasets/mcp';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const uuidFrom=key=>`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
const object=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export const TASK_SYNC_TOOLS=[
 {name:'task_sync_preview',description:'Read the Agent backlog and exact owner-approved CRM project mappings. Does not write tasks.',permission:'task-sync:read',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'task_sync_execute',description:'Import one reviewed source task through the approved CRM mapping. Preserves CRM ownership, schedule and completion. Requires fresh Roles and source permission.',permission:'task-sync:write',inputSchema:{type:'object',properties:{sourceId:{type:'string'},expectedFingerprint:{type:'string'},confirmed:{const:true}},required:['sourceId','expectedFingerprint','confirmed'],additionalProperties:false}},
];
export class TaskSync {
 constructor(store,{connections=[],rolesConsumer,request=fetch,clock=Date.now}={}){Object.assign(this,{store,connections,rolesConsumer,request,clock});}
 connection(actor,projects,permission){
  authorize(actor,permission);
  const c=this.connections.find(c=>c.tenant===actor.tenant&&c.subject===actor.subject&&c.actorTokenHash===actor.tokenHash);
  if(!c||!actor.rolesAuthorityBinding||!this.rolesConsumer||!projects.includes('crm')||!actor.projectIds.includes('crm')||c.expiresAt<=this.clock()||!Number.isFinite(c.expiresAt)||typeof c.token!=='string'||c.token.length<16||c.token.length>4096||/\s/.test(c.token))throw fail('Task sync connection and current Roles binding required',403);
  return c;
 }
 list(actor,projects){return TASK_SYNC_TOOLS.filter(t=>{try{this.connection(actor,projects,t.permission);this.connection(actor,projects,'task-sync:read');return true}catch{return false}}).map(({permission,...tool})=>tool);}
 async rpc(actor,c,name,args,resource,action,operationId=randomUUID()){
  if(this.connection(actor,actor.projectIds,action==='task:import'?'task-sync:write':'task-sync:read')!==c)throw fail("Task sync connection changed",403);
  return this.rolesConsumer.execute(actor,actor.rolesAuthorityBinding,{project:'crm',resource,action,operationId,stage:'execute'}, {tool:name,arguments:args},async payload=>{
   const r=await this.request(CRM,{method:'POST',headers:{authorization:`Bearer ${c.token}`,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({jsonrpc:'2.0',id:operationId,method:'tools/call',params:{name:payload.tool,arguments:payload.arguments}})});
   const text=await r.text();if(!r.ok||text.length>250000)throw fail('CRM task request unavailable; retain the original retry identity',503);
   let data;try{data=JSON.parse(text)}catch{throw fail('Invalid CRM response',502)}
   if(data.error||data.result?.isError)throw fail('CRM rejected the request; review permission, mapping or task conflict',409);
   if(data.id!==operationId)throw fail('Mismatched CRM response',502);
   try{return data.result.structuredContent??JSON.parse(data.result.content.find(c=>c.type==='text').text)}catch{throw fail('Invalid CRM task response',502)}
  });
 }
 async preview(actor,projects){
  const c=this.connection(actor,projects,'task-sync:read');
  const response=await this.request(SOURCE+'/tasks.json',{redirect:'error',signal:AbortSignal.timeout(10000)});
  const raw=await response.text();if(!response.ok||raw.length>2000000)throw fail('Agent task feed unavailable',503);
  let envelope;try{envelope=JSON.parse(raw)}catch{throw fail('Invalid Agent task feed',502)}
  // Validate the entire approved feed before restricting this connection's selection.
  planTaskSync(envelope);
  envelope.data.projects=envelope.data.projects.filter(p=>projects.includes(p.projectId)&&actor.projectIds.includes(p.projectId));
  const remote=await this.rpc(actor,c,'projects.list',{},'workspace:projects','task:read');
  if(!Array.isArray(remote.projects)||remote.projects.length>300)throw fail('Invalid CRM projects response',502);
  const mappings=remote.projects.filter(p=>p.tasks===true&&p.backlogSourceProjectId&&p.expiresAt&&Date.parse(p.expiresAt)>this.clock()).map(p=>({sourceProjectId:p.backlogSourceProjectId,sourceSiteUrl:p.backlogSourceSiteUrl??null,crmProjectId:p.id,workspaceId:p.workspaceId,approved:true,expiresAt:Math.min(Date.parse(p.expiresAt),c.expiresAt)}));
  const plan=planTaskSync(envelope,{mappings,now:this.clock()});
  return {...plan,writeEnabled:false,canRequestImport:actor.permissions.includes('task-sync:write'),blocker:'Each import requires current Roles permission, exact CRM source mapping and conflict checks.',tasks:plan.tasks.map(t=>({...t,state:t.state==='source-contract-required'?'ready-for-permission-check':t.state}))};
 }
 async call(actor,projects,name,args={}){
  if(!this.list(actor,projects).some(t=>t.name===name))throw fail('Task sync not available',403);
  if(name==='task_sync_preview'){if(!object(args,[]))throw fail('Invalid preview arguments');return this.preview(actor,projects)}
  if(name!=='task_sync_execute'||!object(args,['sourceId','expectedFingerprint','confirmed'])||args.confirmed!==true||typeof args.sourceId!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedFingerprint??''))throw fail('Confirm an exact reviewed task');
  const c=this.connection(actor,projects,'task-sync:write'),plan=await this.preview(actor,projects),task=plan.tasks.find(t=>t.sourceId===args.sourceId);
  if(!task||!task.destination||task.fingerprint!==args.expectedFingerprint)throw fail('Source task or mapping changed; preview again',409);
  const resource=`project:${task.destination.projectId}`,identity=hash([actor.tenant,actor.subject,task.sourceId,task.destination,task.fingerprint]);
  const current=await this.rpc(actor,c,'tasks.import_source_status',{projectId:task.destination.projectId,source:SOURCE,sourceId:task.sourceId},resource,'task:read');
  if(typeof current.found!=='boolean'||current.conflict===true)throw fail('CRM task requires owner review',409);
  if(current.found&&(!Number.isInteger(current.version)||current.version<1||typeof current.taskId!=='string'))throw fail('Invalid CRM task status',502);
  if(current.found&&current.contentHash===task.fingerprint)return {state:'unchanged',taskId:current.taskId,version:current.version};
  const content=task.content;
  if(content.description.length>3500||!['todo','in-progress','blocked','done'].includes(content.status)||!['P0','P1','P2'].includes(content.priority))throw fail('Task does not fit the reviewed CRM source schema',409);
  const prepared=await this.store.transaction(state=>{
   const rows=state.taskImports??={};const prior=rows[identity];
   if(prior){if(prior.actorTokenHash!==actor.tokenHash||prior.binding!==actor.rolesAuthorityBinding)throw fail('Task import authority changed',403);return structuredClone(prior)}
   if(Object.keys(rows).length>=1000)throw fail('Task import capacity requires operator review',503);
   const payload={projectId:task.destination.projectId,operationId:uuidFrom(identity),source:SOURCE,sourceId:task.sourceId,contentHash:task.fingerprint,title:content.title,description:content.description,sourceUrl:content.sourceUrl,sourceStatus:content.status,sourcePriority:content.priority,...(current.found?{expectedVersion:current.version}:{})};
   rows[identity]={tenant:actor.tenant,subject:actor.subject,actorTokenHash:actor.tokenHash,binding:actor.rolesAuthorityBinding,status:'prepared',createdAt:this.clock(),payload};return structuredClone(rows[identity]);
  });
  let result;
  try{result=await this.rpc(actor,c,'tasks.import_source',prepared.payload,resource,'task:import',prepared.payload.operationId);}
  catch(error){await this.store.transaction(state=>{state.taskImports[identity].status=error.statusCode===403?'denied':'requires-reconciliation'});throw error}
  if(typeof result.taskId!=='string'||!Number.isInteger(result.version)||result.version<1||typeof result.created!=='boolean'||typeof result.unchanged!=='boolean'||result.contentHash!==task.fingerprint){
   await this.store.transaction(state=>{state.taskImports[identity].status='requires-reconciliation'});
   throw fail('CRM acceptance requires reconciliation',502);
  }
  await this.store.transaction(state=>{state.taskImports[identity].status='accepted';state.taskImports[identity].result={taskId:result.taskId,version:result.version};state.taskImports[identity].checkedAt=this.clock()});
  return {state:'accepted',taskId:result.taskId,version:result.version,created:result.created,unchanged:result.unchanged,replayed:result.replayed===true};
 }
}
