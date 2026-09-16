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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to Bittrees</title><meta name="description" content="Choose the Bittrees projects your agent can discover through one gateway."><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="https://mcp.bittrees.org/connect"><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f7f0;color:#19392b;font:16px/1.6 system-ui,sans-serif}main,header,footer{max-width:1100px;margin:auto;padding:24px}header,nav{display:flex;flex-wrap:wrap;gap:24px;align-items:center}header{justify-content:space-between}a{color:#245e42;text-underline-offset:3px}.brand{font-weight:800;text-decoration:none}h1{font-size:clamp(2rem,5vw,3.8rem);line-height:1.08;max-width:850px}h2{line-height:1.25}section{margin:24px 0;padding:24px;background:white;border:1px solid #d6dfcf;border-radius:18px}.choices,.projects{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px}.choice{padding:18px;border:1px solid #b9cbb9;border-radius:12px}.choice strong{display:block}.choice p{margin-bottom:0}.project-choice{display:block;padding:8px;min-width:0}small{color:#526950}input[type=checkbox],input[type=radio]{width:18px;height:18px;accent-color:#245e42}textarea,input[type=text]{width:100%;max-width:100%;padding:14px;border:1px solid #aabcaa;border-radius:8px;font:inherit}textarea{font:13px/1.5 ui-monospace,monospace;height:190px;resize:vertical}button,.button{display:inline-block;padding:12px 20px;background:#245e42;color:white;border:0;border-radius:9px;font:inherit;text-decoration:none;cursor:pointer}button{margin-top:18px}:focus-visible{outline:3px solid #ad6f14;outline-offset:3px}.muted{color:#526950}.badge{background:#e9f1e3;padding:4px 10px;border-radius:8px}code{overflow-wrap:anywhere}footer{display:flex;flex-wrap:wrap;gap:20px}.skip{position:absolute;left:-10000px}.skip:focus{left:16px;top:8px;background:white;padding:12px}summary{cursor:pointer;font-weight:700}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
  </style></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="/">Bittrees MCP</a><nav aria-label="Primary"><a href="/connect" aria-current="page">Connect</a><a href="/connect#available">Projects</a><a href="/status">Status</a><a href="https://agent.bittrees.org">Agent onboarding</a></nav></header><main id="main"><p class="badge">Service preview · public project context</p><p>Production activation is pending. Keep existing clients on their current endpoint until the new service is verified.</p><h1>Choose your projects. Connect your agent.</h1><p>Discover project documentation, integration status, and reviewed handoff routes. Private accounts and product actions need separate project authorization.</p>
  <form method="get" action="/connect"><section aria-labelledby="choose-title"><h2 id="choose-title">1. Choose your connection</h2><div class="choices">${choices.map(([value, title, description]) => `<label class="choice"><input type="radio" name="mode" value="${value}" ${profile.mode === value ? "checked" : ""}><strong>${title}</strong><p>${description}</p></label>`).join("")}</div><details ${profile.mode === "selected" ? "open" : ""}><summary>Choose individual projects</summary><p>These checkboxes apply to Selected projects.</p><div class="projects">${options}</div></details>${profile.selectedIds
    .filter((id) => !catalog.projects.some((p) => eligible(p) && p.id === id))
    .map((id) => `<input type="hidden" name="project" value="${escape(id)}">`)
    .join(
      "",
    )}<label>Exclude project IDs from any mode (comma-separated)<input type="text" name="exclude" value="${escape(profile.excludedIds.join(","))}"></label><input type="hidden" name="profileVersion" value="1"><input type="hidden" name="profileRevision" value="${profile.revision + 1}"><button type="submit">Update connection</button></section></form>
  <section aria-labelledby="config-title"><h2 id="config-title">2. Save your client configuration</h2><p>${view.projects.length} projects available. The saved URL preserves your selection across sessions; changing this form does not overwrite an existing client configuration.</p><label for="client-config">Copy this JSON into a client that supports remote MCP servers</label><textarea id="client-config" readonly spellcheck="false">${escape(config)}</textarea><p><a class="button" href="/connection.json?${escape(new URL(connectionUrl(profile)).searchParams.toString())}">Download configuration</a> · <a href="/mcp-docs">Client setup instructions</a></p><p class="muted">Keep authentication tokens out of URLs and this public configuration. Selection never installs software, hosts a service, or grants permission to act.</p></section>
  <section id="available"><h2>3. Check what is available</h2><p>Catalog context is ready for approved projects. Private reads and product actions are not connected yet.</p><ul>${view.projects.map((p) => `<li><a href="/v1/projects/${p.id}">${escape(p.name)}</a> — ${projectState(p).freshness} context</li>`).join("")}</ul>${view.unavailable.length ? `<h3>Pinned projects currently unavailable</h3><ul>${view.unavailable.map((p) => `<li>${escape(p.id)} — ${escape(p.reason)}</li>`).join("")}</ul><p>These IDs stay pinned in your saved configuration. Edit the configuration explicitly to remove them.</p>` : ""}<p><a href="https://agent.bittrees.org/projects">Explore the full project directory</a></p><p class="muted">Catalog revision: <code>${view.revision.slice(0, 12)}</code>. Updates: ${escape(catalog.sync.state)}.</p></section>
  <details><summary>Legal and privacy notices</summary>${notices.map((notice) => `<p>${escape(notice)}</p>`).join("")}</details></main><footer><a href="https://agent.bittrees.org/contribute">Contribution workflow</a><a href="https://agent.bittrees.org/readiness">Production backlog</a><a href="https://agent.bittrees.org/privacy">Privacy</a><a href="https://agent.bittrees.org/terms-of-use">Terms</a><a href="https://agent.bittrees.org/llms.txt">Agent guide</a></footer></body></html>`;
}
export function renderCatalogStatus(catalog = CATALOG, report = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gateway status</title><style>body{font:17px/1.6 system-ui;max-width:960px;padding:28px;margin:auto;background:#f4f7f0;color:#19392b}a{color:#245e42}pre{white-space:pre-wrap}a:focus-visible{outline:3px solid #ad6f14}</style></head><body><main><h1>Gateway status</h1><p><a href="/connect">Connect</a> · <a href="/connect#available">Projects</a></p><p>Catalog synchronization: ${escape(report.state ?? catalog.sync.state)}. Last successful reconciliation: ${escape(report.lastSuccessAt ?? "Not established")}.</p><p>No automatic publishing or event delivery is claimed until its activation evidence is recorded.</p><p>This standalone service owns <code>https://mcp.bittrees.org/mcp</code>. Existing Agent contribution clients remain on their original service during migration.</p><p>Automation supports public catalog context only. New automations start paused. Private project adapters remain planned.</p><h2>Readiness</h2><ul>${catalog.projects.map((p) => `<li>${escape(p.name)}: ${escape(p.approval)} / ${escape(p.affiliation)}; reachability ${escape(p.health.status)}; actions not connected</li>`).join("")}</ul><h2>Automation and rules</h2><p>Save a connection profile and a versioned rule through the authenticated service API. New automations start paused. An authorized agent can inspect its history and trigger, pause, resume or cancel existing automations through MCP tools. Execution currently supports public project context only.</p><p><a href="https://github.com/Bittrees-Technology/mcp/blob/main/README.md">Configuration and execution guide</a></p><h2>Last synchronization errors</h2><pre>${escape(JSON.stringify(report.errors ?? [], null, 2))}</pre><p><a href="/health">Service health</a> · <a href="https://agent.bittrees.org/readiness">Launch backlog</a></p></main></body></html>`;
}

