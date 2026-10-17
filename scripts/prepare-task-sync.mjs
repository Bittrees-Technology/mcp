import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {planTaskSync} from '../src/service/task-sync-plan.mjs';
const response=await fetch('https://agent.bittrees.org/tasks.json',{redirect:'error',signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error(`Approved task feed unavailable (${response.status})`);
const text=await response.text();if(Buffer.byteLength(text)>2_000_000)throw Error('Task feed exceeds limit');
const mappings=process.env.MCP_TASK_MAPPING_FILE?JSON.parse(await readFile(process.env.MCP_TASK_MAPPING_FILE,'utf8')):[];
const plan=planTaskSync(JSON.parse(text),{mappings});
await mkdir('output/task-sync',{recursive:true});await writeFile('output/task-sync/plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({writeEnabled:false,tasks:plan.tasks.length,states:plan.tasks.reduce((counts,t)=>(counts[t.state]=(counts[t.state]??0)+1,counts),{}),blocker:plan.blocker}));
