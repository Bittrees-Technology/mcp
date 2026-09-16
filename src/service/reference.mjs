import { ECOSYSTEM_TOOLS } from '../ecosystem/mcp.mjs';
import { page } from '../ecosystem/site.mjs';
export const MANAGEMENT_ROUTES = {
 '/v1/automations/setup': 'automation.setup',
 '/v1/profiles': 'profile.create', '/v1/profiles/update': 'profile.update',
 '/v1/rules': 'rule.create', '/v1/rules/update': 'rule.update',
 '/v1/automations': 'automation.create', '/v1/automations/pause': 'pause',
 '/v1/automations/resume': 'resume', '/v1/automations/cancel': 'cancel',
 '/v1/automations/trigger': 'enqueue',
};
const details = {
 'automation.setup': ['automation:write + profile:write + rule:write', 'Save a paused automation together with its project profile and read-only rule, atomically.', 'name, projectId, idempotencyKey, intervalSeconds (optional: 3600, 21600 or 86400)'],
 'profile.create': ['profile:write', 'Save a project selection.', 'selection'],
 'profile.update': ['profile:write', 'Update a saved selection with revision conflict protection.', 'id, selection, expectedRevision'],
 'rule.create': ['rule:write', 'Create a versioned rule for allowed projects and tools.', 'projectIds, tools, enabled, name (optional)'],
 'rule.update': ['rule:write', 'Append a new rule version; current rules apply at execution.', 'id, projectIds, tools, enabled, expectedVersion, name (optional)'],
 'automation.create': ['automation:write', 'Create a paused automation with a manual, schedule or event trigger.', 'profileId, ruleId, projectId, tool, trigger'],
 pause: ['automation:write', 'Pause an automation; queued work remains held.', 'id'],
 resume: ['automation:write', 'Enable an automation; a schedule starts a new interval.', 'id'],
 cancel: ['automation:write', 'Cancel an automation and its queued/retrying runs. Cancellation is terminal.', 'id'],
 enqueue: ['automation:write', 'Queue a run of an active automation; duplicate keys return the same run.', 'id, idempotencyKey, event (for event triggers)'],
};
export function serviceReference(managementTools) {
 const endpoints = [
  ['POST','/mcp','Public; scoped credential for management tools','MCP JSON-RPC transport. Project selection applies to tools and resources.'],
  ['POST','/profiles/{profileId}/mcp','profile:read + catalog:read; tool-specific permissions','Use a saved profile. Selection query overrides are rejected.'],
  ['GET','/catalog.json','Public','Selected project catalog with revision and ETag.'],
  ['GET','/v1/projects/{projectId}','Public','Read one approved project within the current selection.'],
  ['GET','/connection.json','Public','Download client configuration for the chosen selection.'],
  ['GET','/catalog-sync.json','Public','Last catalog reconciliation result and errors.'],
  ['GET','/health','Public','Check service revision and durable storage readiness; failure returns 503.'],
  ['GET','/schemas/project-manifest.schema.json','Public','Project manifest schema.'],
  ['GET','/schemas/selection.schema.json','Public','Connection selection schema.'],
  ['GET','/reference.json','Public','Machine-readable version of this functions and endpoints reference.'],
  ['GET','/v1/workspace','catalog:read + automation:read','Read your allowed projects, permissions and workspace records.'],
  ['GET','/v1/history','automation:read','Your profiles, rule versions, automations, runs and audit history.'],
  ...Object.entries(MANAGEMENT_ROUTES).map(([path,op])=>['POST',path,details[op][0],details[op][1],details[op][2]]),
  ['POST','/internal/tick','Dedicated worker credential only','Process bounded batches of already-enabled work. Not a client integration endpoint.'],
 ].map(([method,path,access,description,bodyFields])=>({method,path,access,description,...(bodyFields?{bodyFields}: {})}));
 return {
  schema:'bittrees.mcp.reference.v1',baseUrl:'https://mcp.bittrees.org',
  tools:[...ECOSYSTEM_TOOLS.map(t=>({...t,access:'Public'})),...managementTools.map(({operation,permission,...t})=>({...t,access:permission}))],
  endpoints,
  protocol:{transport:'Streamable HTTP with JSON responses',method:'POST',methods:['initialize','notifications/initialized','ping','tools/list','tools/call','resources/list','resources/read'],extensions:['server/discover (implementation-specific)'],negotiatedVersion:'2025-06-18',acceptedVersionHeaders:['2025-06-18','2025-03-26'],sse:false,batchRequests:false},
  selection:{modes:['selected','bittrees','ecosystem'],parameters:['mode','projects','exclude','profileVersion','profileRevision'],defaultMode:'ecosystem'},
  limits:['Only public project context is connected; private product APIs, messages, transactions and permission grants are not implemented.','Automation execution supports get_bittrees_project only. New automations start paused.','Management tools require catalog:read plus their listed permission. Execution additionally requires automation:execute, current project authority, profile selection and an enabled rule.','Scope is enforced on the server. A credential may restrict public discovery but cannot expand project eligibility.','GET /mcp is not supported. There is no SSE stream, resource subscription or arbitrary URL proxy.'],
 };
}
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function referencePage(managementTools) {
 const ref=serviceReference(managementTools);
 const example=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_bittrees_project',arguments:{projectId:'agent'}}},null,2);
 return page('Functions & endpoints',`<section class="intro reference-intro"><h1>Functions & endpoints</h1><p class="lead">What your agent can call today, which permissions it needs, and where each request goes.</p><p><a href="#tools">MCP functions</a> · <a href="#endpoints">HTTP endpoints</a> · <a href="#examples">Examples</a> · <a href="/reference.json">JSON reference</a></p><p><strong>Base URL</strong> <code>https://mcp.bittrees.org</code></p></section>
 <section class="reference-section" id="tools"><h2>MCP functions</h2><p>Call these through <code>POST /mcp</code> using <code>tools/call</code>. The server returns only the tools available to your connection in <code>tools/list</code>.</p><div class="reference-table" tabindex="0" role="region" aria-label="MCP functions"><table><thead><tr><th>Function</th><th>What it does</th><th>Access</th></tr></thead><tbody>${ref.tools.map(t=>`<tr><th scope="row"><code>${escape(t.name)}</code></th><td>${escape(t.description)}<details><summary>Arguments</summary><pre>${escape(JSON.stringify(t.inputSchema,null,2))}</pre></details></td><td>${escape(t.access)}</td></tr>`).join('')}</tbody></table></div><p>For management tools, also grant <code>catalog:read</code>. Execution checks <code>automation:execute</code>, the project selection and the latest rule. An authenticated connection cannot exceed its credential’s project list.</p></section>
 <section class="reference-section" id="endpoints"><h2>HTTP endpoints</h2><p>Send JSON bodies with <code>Content-Type: application/json</code>. Protected endpoints accept <code>Authorization: Bearer &lt;your MCP credential&gt;</code>. Keep credentials out of URLs.</p><div class="reference-table" tabindex="0" role="region" aria-label="HTTP endpoints"><table><thead><tr><th>Method & path</th><th>Purpose & body fields</th><th>Access</th></tr></thead><tbody>${ref.endpoints.map(e=>`<tr><th scope="row"><span class="method">${e.method}</span><code>${escape(e.path)}</code></th><td>${escape(e.description)}${e.bodyFields?`<p class="muted">Body: <code>${escape(e.bodyFields)}</code></p>`:''}</td><td>${escape(e.access)}</td></tr>`).join('')}</tbody></table></div><p>Public read endpoints support HEAD as well as GET, except <code>/v1/history</code>. The worker route is reserved for service operations.</p></section>
 <section class="reference-section" id="examples"><h2>Connect and call</h2><p>Use <code>/mcp?mode=selected&amp;projects=agent,crm</code> for specific projects, <code>/mcp?mode=bittrees</code> for approved Bittrees projects, or <code>/mcp?mode=ecosystem</code> for Bittrees and related projects. Optional <code>exclude</code> is a comma-separated list of project IDs. <code>profileVersion=1</code> and <code>profileRevision</code> carry selection-version metadata. Saved profile URLs reject overrides.</p><h3>Discover available functions</h3><pre class="reference-example">${escape('curl https://mcp.bittrees.org/mcp \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json" \\\n  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'')}</pre><h3>Read project context</h3><p>POST this body to <code>/mcp?mode=selected&amp;projects=agent</code>:</p><pre class="reference-example">${escape(example)}</pre><h3>Configure an automation</h3><ol><li>Save a selection through <code>/v1/profiles</code>.</li><li>Create a rule through <code>/v1/rules</code> allowing <code>get_bittrees_project</code>.</li><li>Create a paused automation through <code>/v1/automations</code>.</li><li>Explicitly resume it, then trigger a run or wait for its configured event/schedule.</li><li>Inspect <code>/v1/history</code> for runs and decisions.</li></ol><p>Triggers: <code>{"type":"manual"}</code>, <code>{"type":"schedule","intervalSeconds":3600}</code>, or <code>{"type":"event","event":"reviewed-update"}</code>. Scheduled work uses a best-effort five-minute worker cadence.</p><p><a href="/automations">Open the automation workspace</a> · <a href="https://github.com/Bittrees-Technology/mcp/blob/main/README.md">Full configuration examples</a></p></section>
 <section class="reference-section"><h2>Protocol and current limits</h2><p>JSON-RPC 2.0 over POST, with JSON responses. Supported methods: ${ref.protocol.methods.map(x=>`<code>${escape(x)}</code>`).join(', ')}. The service also offers the implementation-specific <code>server/discover</code> method.</p><p>Initialization returns protocol version <code>2025-06-18</code>. Request version headers accept <code>2025-06-18</code> or <code>2025-03-26</code>. No SSE streams or batch requests are supported.</p><ul>${ref.limits.map(x=>`<li>${escape(x)}</li>`).join('')}</ul><p><a href="/status">Check service and project readiness</a></p></section>`, '/reference');
}
