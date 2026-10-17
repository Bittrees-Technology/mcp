import {createHash} from 'node:crypto';
import {CATALOG,eligible} from '../ecosystem/catalog.mjs';
import {canonical} from './roles-proof.mjs';
const fail=message=>{throw new Error(message)};
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Read-only preparation. This module cannot contact CRM, issue grants or write tasks. */
export function planTaskSync(envelope,{catalog=CATALOG,mappings=[],previous=[],now=Date.now()}={}){
 const feed=envelope?.data;
 if(feed?.schema!=='agent.bittrees.task-feed.v1'||feed.source!=='https://agent.bittrees.org'||!Array.isArray(feed.projects)||feed.projects.length>100||!Array.isArray(feed.tombstones)||!/^[a-f0-9]{64}$/.test(feed.revision??''))fail('Invalid task feed');
 const seenProjects=new Set(),seenTasks=new Set(),tasks=[];
 for(const group of feed.projects){
  const project=catalog.projects.find(p=>p.id===group.projectId&&eligible(p));
  if(!project||seenProjects.has(group.projectId)||(group.siteUrl===null ? project.publicUrl!==null : !project.publicUrl || new URL(group.siteUrl).origin!==new URL(project.publicUrl).origin)||!Array.isArray(group.tasks))fail('Unapproved, duplicate or mismatched source project');
  seenProjects.add(group.projectId);
  const candidates=mappings.filter(m=>m.sourceProjectId===project.id&&m.sourceSiteUrl===group.siteUrl&&m.approved===true&&m.expiresAt>now&&uuid.test(m.crmProjectId)&&uuid.test(m.workspaceId));
  const mapping=candidates.length===1?candidates[0]:null;
  for(const task of group.tasks){
   if(tasks.length>=1000||task.projectId!==group.projectId||typeof task.sourceId!=='string'||!task.sourceId.startsWith(`agent-readiness:${group.projectId}:`)||task.sourceId.length>200||seenTasks.has(task.sourceId)||typeof task.title!=='string'||task.title.length>200||typeof task.description!=='string'||task.description.length>10000||!/^[a-f0-9]{64}$/.test(task.contentHash??''))fail('Invalid or duplicate task identity');
   const url=new URL(task.sourceUrl);if(url.origin!==feed.source||url.pathname!=='/readiness'||url.username||url.password)fail('Invalid task source URL');
   seenTasks.add(task.sourceId);
   const content={sourceId:task.sourceId,projectId:task.projectId,title:task.title,description:task.description,status:task.status,priority:task.priority,area:task.area,acceptanceCriteria:task.acceptanceCriteria,progressNote:task.progressNote,sourceUrl:task.sourceUrl};
   // Compute our own fingerprint; a source-supplied digest is metadata, not authority.
   const fingerprint=digest(content),prior=previous.find(p=>p.sourceId===task.sourceId);
   const destination=mapping?{projectId:mapping.crmProjectId,workspaceId:mapping.workspaceId}:null;
   const remapped=prior&&mapping&&(prior.crmProjectId!==mapping.crmProjectId||prior.workspaceId!==mapping.workspaceId);
   const state=!mapping?'mapping-required':remapped?'mapping-conflict':prior?.fingerprint===fingerprint?'unchanged':prior?.ownerEdited?'owner-review-required':'source-contract-required';
   tasks.push({sourceId:task.sourceId,projectId:task.projectId,destination,state,fingerprint,idempotencyKey:digest([feed.source,task.sourceId,destination,fingerprint]),content});
  }
 }
 const retained=previous.filter(p=>!seenTasks.has(p.sourceId)).map(p=>({sourceId:p.sourceId,state:'retain-for-review'}));
 return {schema:'bittrees.mcp.task-sync-plan.v1',source:feed.source,revision:feed.revision,checkedAt:new Date(now).toISOString(),writeEnabled:false,
  blocker:'CRM currently creates/updates AI draft/review tasks only. Ordinary backlog import requires a reviewed source capability and an enrolled, authorized MCP actor.',tasks,retained,
  policy:{deleteOnMissing:false,completeOnMissing:false,preserveOwnerFields:true,automaticProjectCreation:false}};
}
