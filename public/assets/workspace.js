let token = '', state = null, busy = false, generation = 0;
let pageKind = document.querySelector('[data-workspace-page]').dataset.workspacePage;
let setupKey = crypto.randomUUID(), aiConnections = [], consentId = '', consentTimer, consentTurn = 0;
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
 const requestGeneration = generation;
 const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
 const data = await response.json();
 if (requestGeneration !== generation || !token) throw new Error("Workspace changed; refresh before continuing.");
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
 const connection = aiConnections.find(row => row.id === $('automation-connection').value);
 if (connection) {
  $('automation-preview').textContent = `Request the approved local template for ${project?.name ?? 'this project'}. Nothing runs until you enable the automation.`;
  $('automation-outcomes').replaceChildren(...['Uses only the device and template approved in AI.', 'Records whether AI accepted the request; this does not mean the model finished.', 'Your existing rule and project permissions must remain active.'].map(text => node('li', text)));
  return;
 }
 $('automation-outcomes').replaceChildren(...['Reads public project information.', 'Saves the result in activity history.', 'Creates a matching project selection and rule.'].map(text => node('li', text)));
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
    $('confirm-dialog').querySelector('h2').textContent = 'Cancel this automation?';
    $('confirm-effects').textContent = 'Unsent requests will be cancelled. Already accepted or uncertain AI requests retain their status. This automation cannot restart.';
    $('confirm-dialog').querySelector('[value=cancel]').textContent = 'Cancel automation';
    $('confirm-dialog').querySelector('[value=back]').textContent = 'Keep automation';
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
  row.append(node('p', `${rule.tools.includes("run_ai_template") ? "Can request the separately approved AI template for" : "Can read public information for"}: ${rule.projectIds.map(projectName).join(', ')}.`));
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
 const labels = { accepted: 'Accepted by AI', dispatch_pending: 'Waiting to send to AI', uncertain: 'Checking whether AI accepted this request', dispatching: 'Contacting AI', awaiting_retry: 'Not received by AI — retry available', expired: 'Request expired', succeeded: 'Completed', denied: 'Blocked by permissions or rule', failed: 'Failed after retries', retrying: 'Retry scheduled', queued: 'Waiting for worker', cancelled: 'Cancelled' };
 for (const run of [...state.runs].reverse().slice(0, 20)) {
  const record = state.automations.find(a => a.id === run.automationId); const row = node('article', undefined, 'activity-row');
  row.append(node('strong', record ? nameOf(record) : 'Project update'), node('span', labels[run.status] ?? run.status), node('time', time(run.createdAt)));
  if (run.status === 'denied') row.append(node('p', 'Check the current rule and project access, then start a new run.', 'muted'));
  if (run.status === 'accepted') row.append(node('p', 'AI accepted the request. Check the companion for model progress and results.', 'muted'));
  if (run.status === 'awaiting_retry') row.append(action('Retry original request', async () => { await request('/v1/ai/runs/retry', { runId: run.id, confirmed: true }); await refresh(); notice('Original request queued for retry.'); }, allowed('automation:write')));
  if (run.result && record?.tool !== 'run_ai_template') { const details = node('details'); details.append(node('summary', 'View saved project information')); for (const field of ['name', 'summary']) if (run.result[field]) details.append(node('p', run.result[field])); row.append(details); }
  $('activity').append(row);
 }
 if (!state.runs.length) $('activity').append(node('div', 'No runs yet. Enable an automation and choose Run now, or wait for its schedule.', 'work-empty'));
 $('history').textContent = JSON.stringify({ profiles: state.profiles, rules: state.rules, automations: state.automations, runs: state.runs, audit: state.audit }, null, 2);
}
function clearConsent() {
 clearTimeout(consentTimer); consentId = '';
 $('ai-consent').hidden = true;
 for (const id of ['ai-request-id', 'ai-approval-code', 'ai-owner']) $(id).value = '';
 $('ai-confirmed').checked = false;
}
function renderConnections() {
 $('ai-connections-panel').hidden = !state.aiConnectionsEnabled;
 $('ai-connect').disabled = busy || !allowed('automation:write');
 $('ai-confirm-form').querySelector('button').disabled = busy || !allowed('automation:write');
 const selected = $('automation-connection').value;
 const fallback = node('option', 'Save public project information'); fallback.value = '';
 $('automation-connection').replaceChildren(fallback);
 $('ai-connections').replaceChildren();
 for (const connection of aiConnections) {
  const row = node('article', undefined, 'work-row');
  const label = connection.status.replaceAll('_', ' ');
  row.append(node('h3', `AI template · ${label}`), node('p', `Connection ${connection.id}`), node('p', `Expires ${time(connection.expiresAt)}`));
  if (connection.status === 'connected' && connection.expiresAt > Date.now()) {
   const option = node('option', `Approved AI template · ${connection.grant.templateId.slice(0, 8)}`); option.value = connection.id; $('automation-connection').append(option);
   row.append(node('p', `Template revision ${connection.grant.templateRevision} · up to ${connection.grant.maxRuns} requests`));
  }
  if (['prepared','pending'].includes(connection.status) && connection.expiresAt > Date.now()) row.append(action('Continue approval', () => showConsent(connection.id), allowed('automation:write')));
  if (connection.status === 'pending' && connection.expiresAt > Date.now()) row.append(action('Finish approved connection', async () => { clearConsent(); consentId = connection.id; $('ai-request-id').value = connection.id; $('ai-consent').hidden = false; consentTimer = setTimeout(clearConsent, Math.max(0, connection.expiresAt - Date.now())); }, allowed('automation:write')));
  if (['connected','disconnecting'].includes(connection.status)) row.append(action('Disconnect AI template…', async () => {
   $('confirm-dialog').querySelector('h2').textContent = 'Disconnect this AI template?';
   $('confirm-effects').textContent = 'The connection is revoked at AI. Reconnecting requires new approval.';
   $('confirm-dialog').querySelector('[value=cancel]').textContent = 'Disconnect template';
   $('confirm-dialog').querySelector('[value=back]').textContent = 'Keep connection';
   $('confirm-description').textContent = 'Disconnect this AI template? Future dispatches stop; requests already accepted by AI may still finish.';
   const confirmed = await new Promise(resolve => { $('confirm-dialog').addEventListener('close', () => resolve($('confirm-dialog').returnValue === 'cancel'), { once: true }); $('confirm-dialog').returnValue = ''; $('confirm-dialog').showModal(); });
   if (confirmed) { await request('/v1/ai/connections/disconnect', { id: connection.id, confirmed: true }); await refresh(); notice('AI connection revoked.'); }
  }, allowed('automation:write')));
  if (['redeeming','review_required'].includes(connection.status)) row.append(node('p', 'Approval could not be confirmed. Review and revoke this request in AI before connecting again.', 'attention'));
  $('ai-connections').append(row);
 }
 if (aiConnections.some(row => row.id === selected && row.status === 'connected' && row.expiresAt > Date.now())) $('automation-connection').value = selected;
}
async function showConsent(id) {
 const current = generation, turn = consentTurn;
 const result = await request('/v1/ai/connections/register', { id });
 if (current !== generation || turn !== consentTurn || !token || document.hidden) return;
 clearConsent(); consentId = id;
 $('ai-request-id').value = id; $('ai-approval-code').value = result.approvalCode;
 $('ai-consent').hidden = false;
 consentTimer = setTimeout(clearConsent, Math.max(0, result.expiresAt - Date.now()));
}
$('ai-connect').onclick = () => perform(async () => {
 const result = await request('/v1/ai/connections/prepare', {});
 await refresh(); await showConsent(result.id);
});
$('ai-confirm-form').onsubmit = event => {
 event.preventDefault();
 const id = consentId, expectedOwnerId = $('ai-owner').value.trim(), confirmed = $('ai-confirmed').checked;
 if (!id || !confirmed) return;
 perform(async () => { clearConsent(); await request('/v1/ai/connections/redeem', { id, expectedOwnerId, confirmed }); await refresh(); notice('AI template connected. Choose it below and save a paused automation.'); });
};
function concealConsent() { consentTurn++; $('ai-approval-code').value = ''; $('ai-owner').value = ''; $('ai-confirmed').checked = false; }
window.addEventListener('blur', concealConsent);
document.addEventListener('visibilitychange', () => { if (document.hidden) concealConsent(); });
async function refresh() {
 const current = generation; const data = await request('/v1/workspace'); if (current !== generation || !token) return;
 let connections = [];
 if (data.aiConnectionsEnabled) connections = (await request('/v1/ai/connections')).connections;
 if (current !== generation || !token) return;
 aiConnections = connections;
 state = data; $('workspace').hidden = false; $('login').hidden = true; $('connected').hidden = false;
 renderConnections(); renderProjects(); renderPermissions(); renderAutomations(); renderRules(); renderActivity();
}
async function perform(fn) {
 if (busy) return; busy = true;
 document.querySelectorAll('#workspace button,#login button').forEach(button => button.disabled = true);
 try { await fn(); } catch (error) { if (!state) token = ''; notice(friendly(error), true); } finally { busy = false; $('login').querySelector('button').disabled = false; if (state) { renderPermissions(); renderConnections(); renderAutomations(); renderRules(); renderActivity(); } $('refresh').disabled = false; }
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
 clearConsent(); aiConnections = []; $('ai-connections').replaceChildren();
 generation++; token = ''; state = null; $('token').value = ''; $('workspace').hidden = true; $('connected').hidden = true; $('login').hidden = false;
 for (const id of ['automations', 'rules', 'activity', 'history', 'rule-projects', 'automation-project']) $(id).replaceChildren();
 $('automation-form').reset(); $('rule-form').reset(); setupKey = crypto.randomUUID(); notice('Disconnected. Your access key and workspace data have been cleared from this page.');
}
$('login').onsubmit = e => { e.preventDefault(); perform(async () => { generation++; state = null; token = $('token').value.trim(); $('token').value = ''; await refresh(); notice('Workspace connected. Choose a project to get started.'); }); };
$('disconnect').onclick = disconnect;
$('refresh').onclick = () => perform(async () => { await refresh(); notice('Activity updated.'); });
$('automation-connection').onchange = preview;
$('automation-project').onchange = preview; $('automation-timing').onchange = preview;
$('automation-form').addEventListener('input', () => { setupKey = crypto.randomUUID(); });
$('automation-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); perform(async () => { const created = await request('/v1/automations/setup', { name: data.get('name'), projectId: data.get('projectId'), idempotencyKey: setupKey, ...(data.get('connectionId') ? { connectionId: data.get('connectionId') } : {}), ...(data.get('timing') !== 'manual' ? { intervalSeconds: Number(data.get('timing')) } : {}) }); setupKey = crypto.randomUUID(); await refresh(); notice(`“${created.name}” is saved and paused. Enable it when you’re ready.`); }); };
$('rule-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); perform(async () => { const projectIds = data.getAll('project'); if (!projectIds.length) throw new Error('Choose at least one project for this rule.'); await request('/v1/rules', { name: data.get('name'), projectIds, tools: ['get_bittrees_project'], enabled: true }); await refresh(); notice('Rule created. It does not start any automation.'); }); };
document.addEventListener('click', e => { const link = e.target.closest('a'); const href = link?.getAttribute('href'); if (['/rules', '/automations'].includes(href) && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); history.pushState({}, '', href); setPage(href.slice(1)); } });
window.addEventListener('popstate', () => { if (['/rules', '/automations'].includes(location.pathname)) setPage(location.pathname.slice(1)); });
window.addEventListener('pagehide', disconnect);
setInterval(() => { if (token && state && !busy && !document.hidden && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) perform(refresh); }, 15000);
setPage(pageKind);
