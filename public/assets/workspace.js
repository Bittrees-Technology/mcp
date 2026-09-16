let token = '', state = null, busy = false, generation = 0;
let pageKind = document.querySelector('[data-workspace-page]').dataset.workspacePage;
let setupKey = crypto.randomUUID();
const $ = id => document.getElementById(id);
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error-notice', error); };
const allowed = permission => state?.permissions.includes(permission);
const projectName = id => state?.projects.find(p => p.id === id)?.name ?? 'Project no longer available';
const nameOf = record => record.name ?? `${projectName(record.projectId)} update`;
const time = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
const timing = trigger => trigger.type === 'manual' ? 'Run when needed' : trigger.type === 'event' ? `When “${trigger.event}” arrives` : `Every ${trigger.intervalSeconds / 3600 === 24 ? 'day' : trigger.intervalSeconds / 3600 === 1 ? 'hour' : `${trigger.intervalSeconds / 3600} hours`}`;
function node(tag, text, className) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; }
function action(label, handler, enabled = true) { const button = node('button', label, 'secondary'); button.type = 'button'; button.disabled = !enabled || busy; button.onclick = () => perform(handler); return button; }
function friendly(error) {
 if (error.status === 401) return 'Your access key is invalid or expired. Disconnect and enter a current key from your operator.';
 if (error.status === 403) return 'Your key does not allow this action. Ask your operator for the required workspace access.';
 if (error.status === 409) return 'This item changed or cannot perform that action now. Refresh activity and try again.';
 if (error.status >= 500) return 'The service is temporarily unavailable. Try again shortly; your saved work is unchanged.';
 if (error instanceof TypeError) return 'Could not reach the service. Check your connection and retry.';
 return error.message;
}
async function request(path, body) {
 const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
 const data = await response.json();
 if (!response.ok) throw Object.assign(new Error(data.error ?? 'Request could not be completed'), { status: response.status });
 return data;
}
function renderPermissions() {
 const setup = ['automation:write', 'profile:write', 'rule:write'].every(allowed) && state.projects.length > 0;
 $('save-automation').disabled = busy || !setup;
 $('save-rule').disabled = busy || !allowed('rule:write') || !state.projects.length;
 $('setup-access').textContent = setup ? 'Save now, then enable when ready.' : 'Creating an automation needs profile, rule and automation access for at least one project. Your operator can update your key.';
 $('access-summary').textContent = `${state.projects.length} project${state.projects.length === 1 ? '' : 's'} available to this workspace`;
}
function preview() {
 const project = state?.projects.find(p => p.id === $('automation-project').value);
 const value = $('automation-timing').value;
 $('automation-preview').textContent = project ? `Save public information about ${project.name} ${value === 'manual' ? 'when you choose Run now' : value === '3600' ? 'every hour' : value === '21600' ? 'every six hours' : 'every day'}.` : 'No projects are available with this key. Ask your operator to add project access.';
}
function renderProjects() {
 const old = $('automation-project').value;
 $('automation-project').replaceChildren(...state.projects.map(project => { const option = node('option', project.name); option.value = project.id; return option; }));
 if (state.projects.some(p => p.id === old)) $('automation-project').value = old;
 const checked = new Set([...$('rule-projects').querySelectorAll('input:checked')].map(input => input.value));
 $('rule-projects').replaceChildren(...state.projects.map(project => { const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.name = 'project'; input.value = project.id; input.checked = checked.has(project.id); label.append(input, document.createTextNode(project.name)); return label; }));
 if (!state.projects.length) $('rule-projects').textContent = 'No projects available with this key.';
 preview();
}
function renderAutomations() {
 $('automations').replaceChildren();
 for (const record of state.automations.toSorted((a, b) => b.createdAt - a.createdAt)) {
  const row = node('article', undefined, 'work-row'); const title = node('div', undefined, 'row-heading');
  title.append(node('h3', nameOf(record)), node('span', record.status === 'active' ? 'Enabled' : record.status === 'paused' ? 'Paused' : 'Cancelled', `state-label state-${record.status}`)); row.append(title);
  row.append(node('p', `${projectName(record.projectId)} · ${timing(record.trigger)}`));
  const rule = state.rules.find(r => r.id === record.ruleId)?.versions.at(-1);
  if (record.status !== 'cancelled' && !rule?.enabled) row.append(node('p', 'Its rule is disabled. Enable the rule on the Rules page before running.', 'attention'));
  if (record.status === 'active' && record.nextAt) row.append(node('p', `Next scheduled: ${time(record.nextAt)}`, 'muted'));
  if (record.status === 'paused') row.append(node('p', 'Ready when you are. Enable this automation to allow runs.', 'muted'));
  const controls = node('div', undefined, 'work-actions');
  if (record.status !== 'cancelled') {
   controls.append(action(record.status === 'active' ? 'Pause' : 'Enable automation', async () => { await request(`/v1/automations/${record.status === 'active' ? 'pause' : 'resume'}`, { id: record.id }); await refresh(); notice(record.status === 'active' ? 'Automation paused. Queued work will wait.' : 'Automation enabled.'); }, allowed('automation:write')));
   controls.append(action('Run now', async () => { await request('/v1/automations/trigger', { id: record.id, idempotencyKey: crypto.randomUUID(), ...(record.trigger.type === 'event' ? { event: record.trigger.event } : {}) }); await refresh(); notice('Run queued. Results appear here after the worker processes it, usually within five minutes.'); }, allowed('automation:write') && allowed('automation:execute') && record.status === 'active' && rule?.enabled));
   controls.append(action('Cancel…', async () => {
    $('confirm-description').textContent = `Cancel “${nameOf(record)}”?`;
    const confirmed = await new Promise(resolve => { $('confirm-dialog').addEventListener('close', () => resolve($('confirm-dialog').returnValue === 'cancel'), { once: true }); $('confirm-dialog').returnValue = ''; $('confirm-dialog').showModal(); });
    if (confirmed) { await request('/v1/automations/cancel', { id: record.id }); await refresh(); notice('Automation cancelled. Its history remains available.'); }
   }, allowed('automation:write')));
  }
  row.append(controls); $('automations').append(row);
 }
 if (!state.automations.length) $('automations').append(node('div', 'No automations yet. Choose a project above and save your first update. It will stay paused until you enable it.', 'work-empty'));
}
function renderRules() {
 $('rules').replaceChildren();
 for (const record of state.rules) {
  const rule = record.versions.at(-1); const row = node('article', undefined, 'work-row'); const heading = node('div', undefined, 'row-heading');
  heading.append(node('h3', record.name ?? 'Project context permission'), node('span', rule.enabled ? 'Enabled' : 'Disabled', `state-label state-${rule.enabled ? 'active' : 'paused'}`)); row.append(heading);
  row.append(node('p', `Can read public information for: ${rule.projectIds.map(projectName).join(', ')}.`));
  const linked = state.automations.filter(a => a.ruleId === record.id && a.status !== 'cancelled');
  row.append(node('p', linked.length ? `Used by: ${linked.map(nameOf).join(', ')}.` : 'Not used by an active or paused automation.', 'muted'));
  row.append(action(rule.enabled ? 'Disable rule' : 'Enable rule', async () => { await request('/v1/rules/update', { id: record.id, expectedVersion: rule.version, projectIds: rule.projectIds, tools: rule.tools, enabled: !rule.enabled }); await refresh(); notice(rule.enabled ? 'Rule disabled. Future runs using this rule will be blocked.' : 'Rule enabled. Automations still need to be enabled separately.'); }, allowed('rule:write')));
  const details = node('details'); details.append(node('summary', `Version history (${record.versions.length})`));
  for (const version of [...record.versions].reverse()) details.append(node('p', `Version ${version.version}: ${version.enabled ? 'enabled' : 'disabled'}, ${time(version.createdAt)}`));
  row.append(details); $('rules').append(row);
 }
 if (!state.rules.length) $('rules').append(node('div', 'No rules yet. Create one here, or save an automation to create its matching rule automatically.', 'work-empty'));
}
function renderActivity() {
 $('activity').replaceChildren();
 const labels = { succeeded: 'Completed', denied: 'Blocked by permissions or rule', failed: 'Failed after retries', retrying: 'Retry scheduled', queued: 'Waiting for worker', cancelled: 'Cancelled' };
 for (const run of [...state.runs].reverse().slice(0, 20)) {
  const record = state.automations.find(a => a.id === run.automationId); const row = node('article', undefined, 'activity-row');
  row.append(node('strong', record ? nameOf(record) : 'Project update'), node('span', labels[run.status] ?? run.status), node('time', time(run.createdAt)));
  if (run.status === 'denied') row.append(node('p', 'Check the current rule and project access, then start a new run.', 'muted'));
  if (run.result) { const details = node('details'); details.append(node('summary', 'View saved project information')); for (const field of ['name', 'summary']) if (run.result[field]) details.append(node('p', run.result[field])); row.append(details); }
  $('activity').append(row);
 }
 if (!state.runs.length) $('activity').append(node('div', 'No runs yet. Enable an automation and choose Run now, or wait for its schedule.', 'work-empty'));
 $('history').textContent = JSON.stringify({ profiles: state.profiles, rules: state.rules, automations: state.automations, runs: state.runs, audit: state.audit }, null, 2);
}
async function refresh() {
 const current = generation; const data = await request('/v1/workspace'); if (current !== generation || !token) return;
 state = data; $('workspace').hidden = false; $('login').hidden = true; $('connected').hidden = false;
 renderProjects(); renderPermissions(); renderAutomations(); renderRules(); renderActivity();
}
async function perform(fn) {
 if (busy) return; busy = true;
 document.querySelectorAll('#workspace button,#login button').forEach(button => button.disabled = true);
 try { await fn(); } catch (error) { if (!state) token = ''; notice(friendly(error), true); } finally { busy = false; $('login').querySelector('button').disabled = false; if (state) { renderPermissions(); renderAutomations(); renderRules(); } $('refresh').disabled = false; }
}
function setPage(kind) {
 pageKind = kind; const rules = kind === 'rules'; $('rules-view').hidden = !rules; $('automation-view').hidden = rules;
 $('workspace-title').textContent = rules ? 'Rules' : 'Automations';
 $('workspace-description').textContent = rules ? 'Decide which projects an automation can read. Turn permissions on or off without editing code.' : 'Save a project update on a schedule, or run it when you need it.';
 $('switch-view').href = rules ? '/automations' : '/rules'; $('switch-view').textContent = rules ? 'View automations' : 'Manage rules';
 document.title = `${rules ? 'Rules' : 'Automations'} · Bittrees MCP`;
 document.querySelectorAll('header nav a').forEach(a => { if (a.getAttribute('href') === '/'+kind) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
function disconnect() {
 generation++; token = ''; state = null; $('token').value = ''; $('workspace').hidden = true; $('connected').hidden = true; $('login').hidden = false;
 for (const id of ['automations', 'rules', 'activity', 'history', 'rule-projects', 'automation-project']) $(id).replaceChildren();
 $('automation-form').reset(); $('rule-form').reset(); setupKey = crypto.randomUUID(); notice('Disconnected. Your access key and workspace data have been cleared from this page.');
}
$('login').onsubmit = e => { e.preventDefault(); perform(async () => { generation++; state = null; token = $('token').value.trim(); $('token').value = ''; await refresh(); notice('Workspace connected. Choose a project to get started.'); }); };
$('disconnect').onclick = disconnect;
$('refresh').onclick = () => perform(async () => { await refresh(); notice('Activity updated.'); });
$('automation-project').onchange = preview; $('automation-timing').onchange = preview;
$('automation-form').addEventListener('input', () => { setupKey = crypto.randomUUID(); });
$('automation-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); perform(async () => { const created = await request('/v1/automations/setup', { name: data.get('name'), projectId: data.get('projectId'), idempotencyKey: setupKey, ...(data.get('timing') !== 'manual' ? { intervalSeconds: Number(data.get('timing')) } : {}) }); setupKey = crypto.randomUUID(); await refresh(); notice(`“${created.name}” is saved and paused. Enable it when you’re ready.`); }); };
$('rule-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); perform(async () => { const projectIds = data.getAll('project'); if (!projectIds.length) throw new Error('Choose at least one project for this rule.'); await request('/v1/rules', { name: data.get('name'), projectIds, tools: ['get_bittrees_project'], enabled: true }); await refresh(); notice('Rule created. It does not start any automation.'); }); };
document.addEventListener('click', e => { const link = e.target.closest('a'); const href = link?.getAttribute('href'); if (['/rules', '/automations'].includes(href) && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); history.pushState({}, '', href); setPage(href.slice(1)); } });
window.addEventListener('popstate', () => { if (['/rules', '/automations'].includes(location.pathname)) setPage(location.pathname.slice(1)); });
window.addEventListener('pagehide', disconnect);
setInterval(() => { if (token && state && !busy && !document.hidden && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) perform(refresh); }, 15000);
setPage(pageKind);
