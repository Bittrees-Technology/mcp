import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {reconcileToolManifests,atomicWriteJson,readPublicToolManifest} from '../src/ecosystem/tool-sync.mjs';
const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const previous=await read('data/tool-coverage.json'),policy=await read('data/tool-sources.json'),updates={};
const headers={Accept:'application/vnd.github+json','User-Agent':'bittrees-central-tool-sync'};
if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
async function github(path){const r=await fetch('https://api.github.com/'+path,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Source unavailable');const text=await r.text();if(text.length>300000)throw Error('Source too large');return JSON.parse(text);}
for(const source of policy.sources){
 if(!/^Bittrees-Technology\/[A-Za-z0-9_.-]+$/.test(source.repository)||!/^[-\w./]+$/.test(source.branch)||source.manifestPath!=='bittrees.tools.json')throw Error('Unapproved sync source');
 try{
  if(source.publicManifestUrl){updates[source.id]=await readPublicToolManifest(source.publicManifestUrl);continue;}
  const commit=await github(`repos/${source.repository}/commits/${encodeURIComponent(source.branch)}`);
  if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('Missing revision');
  const file=await github(`repos/${source.repository}/contents/bittrees.tools.json?ref=${commit.sha}`);
  if(file.encoding!=='base64'||file.size>128000)throw Error('Manifest too large');
  updates[source.id]={revision:commit.sha,manifest:JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))};
 }catch{updates[source.id]={error:'Source unavailable or invalid'};}
}
const result=reconcileToolManifests(previous,policy.sources,updates);
await mkdir(new URL('output/tool-sync/',root),{recursive:true});
await writeFile(new URL('output/tool-sync/report.json',root),JSON.stringify(result.report,null,2)+'\n');
if(!process.argv.includes('--check')){
 await atomicWriteJson(fileURLToPath(new URL('data/tool-coverage.json',root)),result.coverage);
 await atomicWriteJson(fileURLToPath(new URL('data/tool-sync-status.json',root)),result.report);
}
console.log(JSON.stringify(result.report));
