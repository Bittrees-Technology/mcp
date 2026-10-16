import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/assets/workspace-polling.js';
const {workspacePollInterval, startWorkspacePolling} = globalThis.BittreesWorkspacePolling;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
 const doc = new EventTarget(), win = new EventTarget(), pending = new Map(); doc.hidden = false; let id = 0;
 const timers = {setTimeout(fn, delay) { pending.set(++id, {fn,delay}); return id; }, clearTimeout(id) { pending.delete(id); }};
 return {doc,win,timers,pending, hide(value) {doc.hidden=value;doc.dispatchEvent(new Event('visibilitychange'));}, async tick() {const [id,t]=pending.entries().next().value;pending.delete(id);await t.fn();}, delay() {return [...pending.values()][0]?.delay;}};
}
test('idle is 60s; every nonterminal job and pending consent keeps 15s updates', () => {
 assert.equal(workspacePollInterval({runs: []}),60000);
 for(const status of ['queued','retrying','running','future_state']) assert.equal(workspacePollInterval({runs:[{status}]}),15000);
 for(const status of ['succeeded','denied','failed','cancelled']) assert.equal(workspacePollInterval({runs:[{status}]}),60000);
 for(const status of ['prepared','pending']) assert.equal(workspacePollInterval({runs:[]},[{status}]),15000);
});
test('action reset switches to live cadence; completion returns to idle, guards preserve editing and disconnect', async () => {
 const f=fixture(); let state={runs:[]}, calls=0, allowed=true;
 const p=startWorkspacePolling({...f,refresh:async()=>{calls++;},interval:()=>workspacePollInterval(state),canPoll:()=>allowed});
 assert.equal(f.delay(),60000); await f.tick(); assert.equal(calls,1);
 state={runs:[{status:'queued'}]};p.reset();assert.equal(f.delay(),15000);await f.tick();assert.equal(calls,2);
 state.runs[0].status='succeeded';await f.tick();assert.equal(f.delay(),60000);
 allowed=false;await f.tick();assert.equal(calls,3);p.stop();assert.equal(f.pending.size,0);
});
test('hidden tabs do no work, focus resumes immediately, and requests never overlap',async()=>{
 const f=fixture();let calls=0,done;
 const p=startWorkspacePolling({...f,refresh:()=>{calls++;return new Promise(r=>done=r);},interval:()=>15000,canPoll:()=>true});
 f.hide(true);assert.equal(f.pending.size,0);f.win.dispatchEvent(new Event('focus'));assert.equal(calls,0);
 f.hide(false);assert.equal(calls,1);f.win.dispatchEvent(new Event('focus'));assert.equal(calls,1);
 done();await settle();assert.equal(f.delay(),15000);p.stop();f.win.dispatchEvent(new Event('focus'));assert.equal(calls,1);
});
