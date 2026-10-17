import {page} from "./site.mjs";
import {
  CATALOG,
  catalogView,
  selectionFromParams,
  clientConfiguration,
  connectionUrl,
  eligible,
  projectState,
} from "./catalog.mjs";
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function uiSelection(params) {
  const normalized = new URLSearchParams(params);
  if (normalized.has("project")) {
    if (normalized.get("mode") === "selected")
      normalized.set("projects", normalized.getAll("project").join(","));
    else normalized.delete("projects");
    normalized.delete("project");
  }
  if (normalized.has("excludedProject")) { normalized.set("exclude",normalized.getAll("excludedProject").join(",")); normalized.delete("excludedProject"); }
  return selectionFromParams(normalized);
}
export function renderConnectionPage(
  params = new URLSearchParams(),
  catalog = CATALOG,
  { notices = [] } = {},
) {
  const profile = uiSelection(params);
  const view = catalogView(catalog, profile);
  const config = JSON.stringify(clientConfiguration(profile), null, 2);
  const choices = [
    [
      "selected",
      "Selected projects",
      "Keep an exact list. New projects are added only when you edit it.",
    ],
    [
      "bittrees",
      "All Bittrees projects",
      "Include approved Bittrees projects as the catalog changes.",
    ],
    [
      "ecosystem",
      "Bittrees + related projects",
      "Include every approved ecosystem project.",
    ],
  ];
  const options = catalog.projects
    .filter(eligible)
    .map(
      (p) =>
        `<label class="project-choice"><input type="checkbox" name="project" value="${escape(p.id)}" ${profile.selectedIds.includes(p.id) ? "checked" : ""}> ${escape(p.name)} <small>${escape(p.affiliation)}</small></label>`,
    )
    .join("");
  const endpoint=connectionUrl(profile), query=new URL(endpoint).searchParams.toString();
  const excluded=catalog.projects.filter(eligible).map(p=>`<label class="project-choice"><input type="checkbox" name="excludedProject" value="${escape(p.id)}" ${profile.excludedIds.includes(p.id)?'checked':''}>${escape(p.name)}</label>`).join('');
  return page('Connect your agent',`<section class="intro"><h1>Choose projects.<br>Connect your agent.</h1><p class="lead">One gateway for public discovery and explicitly authorized actions.</p></section>
  <form method="get" action="/connect" class="connect-form"><section><h2>1. Choose your scope</h2><div class="connection-choices">${choices.map(([value,title,description])=>`<label class="choice"><input type="radio" name="mode" value="${value}" ${profile.mode===value?'checked':''}><strong>${title}</strong><span>${description}</span></label>`).join('')}</div>
  <label for="project-filter">Find a project</label><input type="search" id="project-filter" placeholder="Filter project choices">
  <details ${profile.mode==='selected'?'open':''}><summary>Selected projects</summary><p>These choices apply to the Selected projects option.</p><div class="project-checks">${options}</div></details>
  <details ${profile.excludedIds.length?'open':''}><summary>Exclude projects from your scope</summary><div class="project-checks">${excluded}</div></details>
  ${profile.selectedIds.filter(id=>!catalog.projects.some(p=>eligible(p)&&p.id===id)).map(id=>`<input type="hidden" name="project" value="${escape(id)}">`).join('')}
  ${profile.excludedIds.filter(id=>!catalog.projects.some(p=>eligible(p)&&p.id===id)).map(id=>`<input type="hidden" name="excludedProject" value="${escape(id)}">`).join('')}
  <input type="hidden" name="profileVersion" value="1"><input type="hidden" name="profileRevision" value="${profile.revision+1}"><button>Update connection</button></section></form>
  <section class="section"><h2>2. Add the connection</h2><p>${view.projects.length} approved projects in this scope. Existing saved configurations change only when you replace them.</p><label for="connection-url">Remote MCP server URL</label><input id="connection-url" value="${escape(endpoint)}" readonly><div class="actions"><button id="copy-endpoint" type="button">Copy URL</button><a href="/connection.json?${escape(query)}">Download configuration</a></div>
  <details><summary>Advanced JSON configuration</summary><label for="client-config">MCP configuration</label><textarea id="client-config" readonly spellcheck="false">${escape(config)}</textarea></details>
  <details id="client-help"><summary>Where to add this in your client</summary><p>In a client with remote MCP support, add a server using the URL above and Streamable HTTP. If your client accepts an MCP configuration file, use the download. Client settings vary; consult its current remote-server guide.</p><p>Keep credentials in your client’s secure authorization settings, never in a URL. Public discovery needs no key. Protected actions require an enrolled actor, current Roles permission and the source app’s approval.</p></details></section>
  <section class="section"><h2>3. Test discovery</h2><p>This test lists public tools for the saved selection above. It does not run an action or grant access.</p><button id="test-connection" data-endpoint="${escape(endpoint)}" type="button">Test connection</button><p id="connection-result" role="status" aria-live="polite"></p><p><a href="/tools?${escape(query)}">Explore functions in this scope</a> · <a href="/automations">Set up an automation</a></p>
  ${view.unavailable.length?`<details><summary>Pinned projects currently unavailable</summary><ul>${view.unavailable.map(p=>`<li>${escape(p.id)} — ${escape(p.reason)}</li>`).join('')}</ul><p>The saved selection stays pinned until you edit it.</p></details>`:''}
  <p>Managed integrations depend on configuration and permission. <a href="/status">See current readiness and blockers</a>.</p><p class="muted">Catalog revision ${escape(view.revision.slice(0,12))}. Discovery selection never grants execution permission.</p></section>
  ${notices.length?`<details><summary>Notices</summary>${notices.map(n=>`<p>${escape(n)}</p>`).join('')}</details>`:''}<script src="/assets/connect.js" defer></script>`, '/connect');
}
export function renderCatalogStatus(catalog = CATALOG, report = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gateway status</title><style>body{font:17px/1.6 system-ui;max-width:960px;padding:28px;margin:auto;background:#f4f7f0;color:#19392b}a{color:#245e42}pre{white-space:pre-wrap}a:focus-visible{outline:3px solid #ad6f14}</style></head><body><main><h1>Gateway status</h1><p><a href="/reference">Functions & endpoints</a></p><p><a href="/connect">Connect</a> · <a href="/projects">Projects</a></p><p>Catalog synchronization: ${escape(report.state ?? catalog.sync.state)}. Last successful reconciliation: ${escape(report.lastSuccessAt ?? catalog.sync.lastSuccessAt ?? "Not established")}.</p><p>${catalog.sync.state === "reconciled" ? "Approved manifest reconciliation is active. Sources outside the approved list remain pending integration." : "Catalog reconciliation is awaiting successful activation evidence."}</p><p>This standalone service owns <code>https://mcp.bittrees.org/mcp</code>. Existing Agent contribution clients remain on their original service during migration.</p><p>Automation supports public catalog context only. New automations start paused. Private project adapters remain planned.</p><h2>Readiness</h2><ul>${catalog.projects.map((p) => `<li>${escape(p.name)}: ${escape(p.approval)} / ${escape(p.affiliation)}; reachability ${escape(p.health.status)}; actions not connected</li>`).join("")}</ul><h2>Automation and rules</h2><p>Save a connection profile and a versioned rule through the authenticated service API. New automations start paused. An authorized agent can inspect its history and trigger, pause, resume or cancel existing automations through MCP tools. Execution currently supports public project context only.</p><p><a href="https://github.com/Bittrees-Technology/mcp/blob/main/README.md">Configuration and execution guide</a></p><h2>Last synchronization errors</h2><pre>${escape(JSON.stringify(report.errors ?? [], null, 2))}</pre><p><a href="/health">Service health</a> · <a href="https://agent.bittrees.org/readiness">Launch backlog</a></p></main></body></html>`;
}

