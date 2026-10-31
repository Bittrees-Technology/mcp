import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {functionCatalog} from '../ecosystem/tool-coverage.mjs';
import {eligible} from '../ecosystem/catalog.mjs';
const read=name=>JSON.parse(readFileSync(new URL(`../../data/${name}.json`,import.meta.url),'utf8'));
export function projectCapabilities(catalog,{directory=functionCatalog(catalog.projects.filter(eligible)),sync=read('tool-sync-status'),sources=read('catalog-sources').sources}={}){
 return catalog.projects.map(p=>{
  const tools=directory.functions.filter(f=>f.projectId===p.id),observed=sync.apps.find(a=>a.projectId===p.id);
  const disposition=p.approval!=='approved'?'pending-review':observed && observed.state!=='synced'?'blocked':tools.length?'adapter-available':observed?.state==='synced'?'resources-only':'not-enrolled';
  const nextStep=disposition==='adapter-available'?'Connect using source authorization and verify current tools/list.':disposition==='resources-only'?'Public context is available; no product actions are declared.':disposition==='blocked'?'Source owner must repair the manifest; retained metadata may be stale.':disposition==='pending-review'?'Complete catalog review before inclusion.':'Source owner must review whether a tool manifest is appropriate.';
  return {id:p.id,name:p.name,approval:p.approval,disposition,owner:`${p.name} source owner`,nextStep,indexedTools:tools.length,
   website:{state:p.health.status,checkedAt:p.health.checkedAt??null},toolSync:observed?.state??'not-enrolled',toolCheckedAt:observed?.checkedAt??null,
   metadataUpdates:sources.some(s=>s.id===p.id&&s.enabled)?'approved-manifest':'curated-snapshot',
   execution:p.id==='mcp'?'public-discovery-available':p.approval!=='approved'?'pending-review':tools.length?'source-connection-required':'public-context-only'};
 });
}
export function verificationEvidence({release,policyRevision,clock=Date.now}={}){
 const data=read('verification-evidence'),now=clock();
 const current=e=>Boolean(e?.passed&&Date.parse(e.checkedAt)<=now&&Date.parse(e.expiresAt)>now);
 const execution=data.execution;
 const validExecution=current(execution)&&execution.release===release&&execution.policyRevision===policyRevision;
 const migrations=new URL('../../migrations/',import.meta.url);
 const schemaDigest=createHash('sha256').update(Buffer.concat(readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort().map(n=>readFileSync(new URL(n,migrations))))).digest('hex');
 return {execution:{state:validExecution?'verified-for-recorded-scope':'not-verified',...(validExecution?{checkedAt:execution.checkedAt,expiresAt:execution.expiresAt,scope:execution.scope}:{}),nextStep:'Record an approved scoped acceptance test for the current release and policy; evidence never grants access.'},
  recovery:{state:current(data.recovery)&&data.recovery.schemaDigest===schemaDigest?'restore-verified-for-recorded-schema':'restore-verification-expired-or-schema-changed',checkedAt:data.recovery?.checkedAt,expiresAt:data.recovery?.expiresAt,scope:data.recovery?.scope,evidenceDigest:data.recovery?.evidenceDigest}};
}
