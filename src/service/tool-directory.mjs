import {eligible,selectionFromParams,resolveSelection} from '../ecosystem/catalog.mjs';
import {searchFunctions,OPERATIONS} from '../ecosystem/tool-coverage.mjs';
import {page} from '../ecosystem/site.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function directoryConnectionLabel(tool){
 if(tool.transport==='managed-mcp')return 'Gateway connection · permission required';
 if(['local-mcp','local-mcp-adapter'].includes(tool.transport))return tool.authentication==='none'?'Local adapter · public reads':'Local adapter · source permission required';
 return tool.authentication==='none'?'Public read-only source · no sign-in required':'Source app connection · permission required';
}
export function directorySchemaHelp(tool){
 if(['local-mcp','local-mcp-adapter'].includes(tool.transport))return 'Run the reviewed local adapter and request tools/list there. The HTTPS endpoint is its data source, not a remote MCP server. Source limits and any required permissions still apply.';
 return tool.authentication==='none'?'Connect to this public read-only source and request tools/list for the current schema. No bearer credential or sign-in is required. Private access and writes are not provided.':'Request tools/list from this connection for the current schema. Indexed metadata does not establish execution permission.';
}
export function toolDirectory(catalog,params){
 const scope=new URLSearchParams();for(const key of ['mode','projects','exclude','profileVersion','profileRevision'])if(params.has(key))scope.set(key,params.get(key));
 const projects=resolveSelection(catalog,selectionFromParams(scope)).projects.filter(eligible),app=params.get('app')??'',query=params.get('q')??'',operation=params.get('operation')??'';
 const selected=app?projects.filter(p=>p.id===app):projects;
 const result=searchFunctions(selected,{query,...(operation?{operation}:{}),limit:25,offset:Number(params.get('offset')??0)});
 const next=new URLSearchParams(params);next.set('offset',String(result.nextOffset));
 const groups=[...new Set(result.functions.map(f=>f.projectId))].map(id=>({project:projects.find(p=>p.id===id),functions:result.functions.filter(f=>f.projectId===id)}));
 return page('Explore functions',`<section class="intro"><h1>Find the right function.</h1><p class="lead">Explore indexed functions, then connect with the permissions the source requires.</p><p><a href="/connect?${esc(scope)}">Connect this scope</a> · <a href="/reference">Developer reference</a></p></section><nav class="subnav" aria-label="Explore"><a href="/explore">Projects</a><a href="/tools" aria-current="page">Functions</a></nav>
 <form method="get" class="work-form">${[...scope].map(([k,v])=>`<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<label for="q">Search functions</label><input id="q" name="q" value="${esc(query)}" maxlength="200" placeholder="Search by function name or action"><label for="app">Project</label><select id="app" name="app"><option value="">All projects in your scope</option>${projects.map(p=>`<option value="${esc(p.id)}" ${p.id===app?'selected':''}>${esc(p.name)}</option>`).join('')}</select><label for="operation">Action</label><select id="operation" name="operation"><option value="">All actions</option>${OPERATIONS.map(o=>`<option ${o===operation?'selected':''}>${o}</option>`).join('')}</select><button>Search</button></form>
 <section class="section"><h2>${result.total} matching functions</h2>${groups.map(g=>`<section class="section"><h2>${esc(g.project.name)}</h2>${[...new Map(g.functions.map(f=>[f.endpoint,f])).values()].map(f=>`<p class="connection-note"><strong>${esc(directoryConnectionLabel(f))}</strong><br><code>${esc(f.endpoint)}</code><br>${esc(f.description)}</p>`).join('')}<ul class="function-list">${g.functions.map(f=>`<li><h3><code>${esc(f.name)}</code></h3><span class="pill">${esc(f.operations.join(', '))}</span><details><summary>Schema and setup</summary><p>${esc(directorySchemaHelp(f))}</p><p>${esc(f.source)} · ${esc(f.verification)}</p>${f.setup?`<pre>${esc(JSON.stringify(f.setup,null,2))}</pre>`:''}</details></li>`).join('')}</ul></section>`).join('')}${!groups.length?'<p>No indexed functions match. Try another name or project. Some projects provide public information only.</p>':''}${result.nextOffset!==null?`<a class="button" href="/tools?${esc(next)}">Next functions</a>`:''}</section>`,'/tools');
}
