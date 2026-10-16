import { atomicWriteJson } from './sync.mjs';
export { atomicWriteJson };
const canonical='https://mcp.bittrees.org/mcp';
const operations=new Set(['read','create','update','complete','research','sync','publish','prepare','delete']);
const bounded=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n;
export function validateToolManifest(value,source) {
 if(value?.schema!=='bittrees.app-tools.v1'||value.version!==1||value.projectId!==source.id||value.canonicalDiscovery!==canonical||!Array.isArray(value.connections)||value.connections.length>20)throw Error('Invalid app tool manifest');
 const names=new Set(),routes=new Set(),owners=new Map();
 for(const c of value.connections){
  const routeKey=JSON.stringify([c.transport,c.endpoint]);
  if(routes.has(routeKey))throw Error('Duplicate connection route');routes.add(routeKey);
  if(c.projectId!==source.id||!source.routes.some(r=>r.endpoint===c.endpoint&&r.transport===c.transport)||!bounded(c.boundary,3000)||!bounded(c.source,800)||!c.source.startsWith('https://github.com/Bittrees-Technology/')||!c.operations||typeof c.operations!=='object'||Array.isArray(c.operations)||JSON.stringify(c).length>32000)throw Error('Unreviewed route or invalid description');
  const allowed=new Set(['projectId','transport','endpoint','verification','source','operations','boundary','setup']);
  if(Object.keys(c).some(k=>!allowed.has(k)))throw Error('Unsupported connection field');
  const route=source.routes.find(r=>r.endpoint===c.endpoint&&r.transport===c.transport);
  if(JSON.stringify(c.setup??null)!==JSON.stringify(route.setup??null))throw Error('Connection setup requires review');
  for(const [op,tools] of Object.entries(c.operations)){
   if(!operations.has(op)||!Array.isArray(tools)||tools.length>200||tools.some(t=>typeof t!=='string'||!/^[A-Za-z0-9_.-]{1,120}$/.test(t)))throw Error('Invalid operation tools');
   for(const t of tools){if(owners.has(t)&&owners.get(t)!==routeKey)throw Error('Ambiguous tool route');owners.set(t,routeKey);names.add(t);}
  }
 }
 if(names.size>300)throw Error('Manifest tool limit exceeded');
 return value;
}
export function reconcileToolManifests(previous,sources,updates,now=new Date().toISOString()){
 const next=structuredClone(previous),apps=[],seen=new Set();
 for(const source of sources){
  if(seen.has(source.id))throw Error('Duplicate sync source');seen.add(source.id);
  try{
   const update=updates[source.id];if(!(update?.revisionType==='manifest-sha256'?/^[a-f0-9]{64}$/:/^[a-f0-9]{40}$/).test(update?.revision??''))throw Error('Missing immutable source');
   const manifest=validateToolManifest(update.manifest,source);
   next.connections=next.connections.filter(c=>c.projectId!==source.id).concat(manifest.connections);
   apps.push({projectId:source.id,state:'synced',sourceRevision:update.revision,revisionType:update.revisionType??'git-commit',checkedAt:now,toolCount:new Set(manifest.connections.flatMap(c=>Object.values(c.operations).flat())).size});
  }catch{apps.push({projectId:source.id,state:'unavailable-or-invalid',checkedAt:now,retainedPrevious:true});}
 }
 next.apps=apps;next.reviewedAt=now;
 return {coverage:next,report:{canonicalDiscovery:canonical,checkedAt:now,state:apps.some(a=>a.state!=='synced')?'partial':'synced',apps}};
}

export async function readPublicToolManifest(url,request=fetch){
 const u=new URL(url);
 if(u.protocol!=='https:'||!u.hostname.endsWith('.bittrees.org')||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/.well-known/bittrees-tools.json')throw Error('Unapproved public manifest URL');
 const response=await request(url,{headers:{Accept:'application/json','User-Agent':'bittrees-central-tool-sync'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||response.redirected||!response.body)throw Error('Public manifest unavailable');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>128000)throw Error('Manifest too large');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=Buffer.concat(chunks);
 const {createHash}=await import('node:crypto');
 return {manifest:JSON.parse(bytes.toString('utf8')),revision:createHash('sha256').update(bytes).digest('hex'),revisionType:'manifest-sha256'};
}
