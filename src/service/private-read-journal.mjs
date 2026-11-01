import{randomUUID}from'node:crypto';
import{canonical}from'./roles-proof.mjs';
const deny=()=>{throw Object.assign(Error('Private operation held; reconcile the original operation'),{statusCode:409});};
// Existing durable store only. No result bodies, bearer tokens, keys or cleanup.
export class PrivateReadJournal{
 constructor(store,{clock=Date.now,maxEntries=1024}={}){this.store=store;this.clock=clock;this.maxEntries=maxEntries;}
 async transaction(fn){if(!this.store?.transaction)throw Object.assign(Error('Durable private operation journal unavailable'),{statusCode:503});return this.store.transaction(state=>{const rows=state.privateReadOperations??={};return fn(rows);});}
 async begin(key,metadata,{fresh=false}={}){return this.transaction(rows=>{
  const existing=Object.values(rows).filter(r=>r.key===key).sort((a,b)=>b.sequence-a.sequence)[0];
  const safeFresh=existing&&(existing.status==='completed'||(['prepared','challenged'].includes(existing.status)&&existing.expiresAt<=this.clock()));
  if(existing&&(!fresh||!safeFresh))return {row:structuredClone(existing),created:false};
  if(Object.keys(rows).length>=this.maxEntries)deny();
  const id=randomUUID(),row={id,key,sequence:Object.keys(rows).length+1,...metadata,status:'preparing',createdAt:this.clock(),expiresAt:this.clock()+60000};rows[id]=row;return {row:structuredClone(row),created:true};
 });}
 async load(key,operationId){return this.transaction(rows=>{const found=Object.values(rows).filter(r=>r.key===key&&r.operationId===operationId);if(found.length!==1)deny();return structuredClone(found[0]);});}
 async prepared(id,operationId,parameters,expiresAt){return this.transaction(rows=>{const r=rows[id];if(!r||r.status!=='preparing'||r.expiresAt<=this.clock()||expiresAt<=this.clock())deny();Object.assign(r,{status:'prepared',operationId,parameters:structuredClone(parameters),expiresAt:Math.min(r.expiresAt,expiresAt)});return structuredClone(r);});}
 async challenged(id,challenge){return this.transaction(rows=>{const r=rows[id];if(!r||!['prepared','challenged'].includes(r.status)||r.expiresAt<=this.clock()||challenge.request.operationId!==r.operationId||canonical(challenge.parameters)!==canonical(r.parameters))deny();if(r.challenge&&canonical(r.challenge)!==canonical(challenge))deny();r.challenge=structuredClone(challenge);r.status='challenged';r.expiresAt=Math.min(r.expiresAt,challenge.request.issuedAt+15000);if(r.expiresAt<=this.clock())deny();return structuredClone(r);});}
 async claim(id,challenge){return this.transaction(rows=>{const r=rows[id];if(!r||r.status!=='challenged'||r.expiresAt<=this.clock()||canonical(r.challenge)!==canonical(challenge))deny();r.status='dispatching';return structuredClone(r);});}
 async check(id){return this.transaction(rows=>{const r=rows[id];if(!r||r.status!=='dispatching'||r.expiresAt<=this.clock())deny();return true;});}
 async complete(id){return this.transaction(rows=>{const r=rows[id];if(!r||r.status!=='dispatching'||r.expiresAt<=this.clock())deny();r.status='completed';r.completedAt=this.clock();return true;});}
 async hold(id){return this.transaction(rows=>{const r=rows[id];if(r&&r.status!=='completed'){r.status='held';r.heldAt=this.clock();}});}
}
