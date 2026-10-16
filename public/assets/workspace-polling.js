(() => {
// Display refreshes only; workers and server authorization retain their cadence.
function workspacePollInterval(state, connections = []) {
 const terminal = new Set(['succeeded', 'denied', 'failed', 'cancelled']);
 const pending = state?.runs?.some(run => !terminal.has(run.status)) ||
   connections.some(connection => ['prepared', 'pending'].includes(connection.status));
 return pending ? 15000 : 60000;
}
function startWorkspacePolling({ refresh, interval, canPoll, doc = document, win = window, timers = globalThis }) {
 let timer, running = false, stopped = false;
 const clear = () => { if (timer !== undefined) timers.clearTimeout(timer); timer = undefined; };
 const reset = () => { clear(); if (!stopped && !doc.hidden) timer = timers.setTimeout(run, interval()); };
 async function run() {
  clear();
  if (stopped || doc.hidden || running) return;
  running = true;
  try { if (canPoll()) await refresh(); }
  finally { running = false; reset(); }
 }
 const visibility = () => { if (doc.hidden) clear(); else void run(); };
 const focus = () => { if (!doc.hidden) void run(); };
 doc.addEventListener('visibilitychange', visibility);
 win.addEventListener('focus', focus);
 reset();
 return { reset, stop() { stopped = true; clear(); doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('focus', focus); } };
}

 globalThis.BittreesWorkspacePolling = { workspacePollInterval, startWorkspacePolling };
})();
