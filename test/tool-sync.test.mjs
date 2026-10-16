import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateToolManifest,reconcileToolManifests} from '../src/ecosystem/tool-sync.mjs';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const policy=read('../data/tool-sources.json'),previous=read('../data/tool-coverage.json');
const source=policy.sources.find(s=>s.id==='crm');
const manifest={schema:'bittrees.app-tools.v1',version:1,projectId:'crm',canonicalDiscovery:'https://mcp.bittrees.org/mcp',connections:previous.connections.filter(c=>c.projectId==='crm')};
test('sync validates source identity and never accepts new endpoints or setup commands',()=>{
 assert.equal(validateToolManifest(manifest,source),manifest);
 for(const mutate of [m=>m.projectId='calendar',m=>m.connections[0].endpoint='https://attacker.example/mcp',m=>m.connections[0].setup={command:'sh'},m=>m.connections[0].operations.read=['invalid tool']]){const m=structuredClone(manifest);mutate(m);assert.throws(()=>validateToolManifest(m,source));}
});
test('one app failure preserves its last known tools without blocking valid app updates',()=>{
 const good=structuredClone(manifest);good.connections[0].operations.read.push('tasks.new_metadata');
 const next=reconcileToolManifests(previous,[source,policy.sources.find(s=>s.id==='news')],{crm:{manifest:good,revision:'a'.repeat(40)}});
 assert.equal(next.report.state,'partial');
 assert.ok(next.coverage.connections.find(c=>c.projectId==='crm').operations.read.includes('tasks.new_metadata'));
 assert.deepEqual(next.coverage.connections.filter(c=>c.projectId==='news'),previous.connections.filter(c=>c.projectId==='news'));
 assert.equal(next.report.apps[1].retainedPrevious,true);
});
test('a valid empty manifest removes obsolete tools while keeping project coverage explicit',()=>{
 const next=reconcileToolManifests(previous,[source],{crm:{manifest:{...manifest,connections:[]},revision:'b'.repeat(40)}});
 assert.equal(next.coverage.connections.some(c=>c.projectId==='crm'),false);
 assert.equal(next.report.apps[0].toolCount,0);
 assert.equal(next.report.state,'synced');
});

test('duplicate or ambiguous routes cannot change an exact tool lookup',()=>{
 const m=structuredClone(manifest);m.connections.push(structuredClone(m.connections[0]));assert.throws(()=>validateToolManifest(m,source));
 const n=structuredClone(manifest);n.connections[1].operations.read=['tasks.list'];assert.throws(()=>validateToolManifest(n,source));
});
test('public metadata sync sends no GitHub or app credential and records content digest',async()=>{
 const {readPublicToolManifest}=await import('../src/ecosystem/tool-sync.mjs');let seen;
 const result=await readPublicToolManifest('https://roles.bittrees.org/.well-known/bittrees-tools.json',async(url,options)=>{seen=options;return Response.json(manifest);});
 assert.equal(seen.headers.Authorization,undefined);assert.equal(seen.headers.authorization,undefined);assert.equal(seen.redirect,'error');assert.equal(result.revisionType,'manifest-sha256');assert.equal(result.revision.length,64);
 assert.equal(reconcileToolManifests(previous,[source],{crm:result}).report.state,'synced');
 await assert.rejects(()=>readPublicToolManifest('http://127.0.0.1/private'));
 await assert.rejects(()=>readPublicToolManifest('https://roles.bittrees.org/.well-known/bittrees-tools.json',async()=>({ok:true,redirected:true})));
});
