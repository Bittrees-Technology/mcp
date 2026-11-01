import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateToolManifest,reconcileToolManifests} from '../src/ecosystem/tool-sync.mjs';
import {connectionRequirements,connectionInstructions} from '../src/ecosystem/connection-requirements.mjs';
import {directoryConnectionLabel,directorySchemaHelp} from '../src/service/tool-directory.mjs';
const policy=JSON.parse(readFileSync(new URL('../data/tool-sources.json',import.meta.url))).sources;
function fixture(id){
 const source=policy.find(s=>s.id===id),route=source.routes[0];
 return {source,manifest:{schema:'bittrees.app-tools.v1',version:1,projectId:id,canonicalDiscovery:'https://mcp.bittrees.org/mcp',connections:[{projectId:id,transport:route.transport,endpoint:route.endpoint,setup:structuredClone(route.setup),operations:structuredClone(route.operations),source:`https://github.com/${source.repository}/blob/main/bittrees.tools.json`,verification:'fixture-only',boundary:'Bounded public read-only projection; no private data or writes.'}]}};
}
test('public Agent, Gov, TCP and CryptoDirectory routes accept only reviewed read operations and preserve the last good manifest on expansion',()=>{
 for(const id of ['agent','bittrees-gov','tcp','crypto-directory']){
  const {source,manifest}=fixture(id);assert.equal(validateToolManifest(manifest,source),manifest);
  for(const change of [c=>c.endpoint+='?url=https://other.invalid',c=>c.setup=undefined,c=>c.setup.command='sh',c=>c.operations.create=['records.write'],c=>c.operations.read.push('private.read'),c=>c.operations.delete=['records.delete']]){
   const bad=structuredClone(manifest);change(bad.connections[0]);assert.throws(()=>validateToolManifest(bad,source));
   const previous={connections:manifest.connections};
   const result=reconcileToolManifests(previous,[source],{[id]:{revision:'a'.repeat(40),manifest:bad}});
   assert.deepEqual(result.coverage.connections,previous.connections);assert.equal(result.report.apps[0].retainedPrevious,true);
  }
 }
});
test('public setup labels cannot downgrade an existing protected source route',()=>{
 const source=policy.find(s=>s.id==='crm');
 const manifest={schema:'bittrees.app-tools.v1',version:1,projectId:'crm',canonicalDiscovery:'https://mcp.bittrees.org/mcp',connections:[{projectId:'crm',...source.routes[0],setup:{authentication:'none'},operations:{read:['tasks.inventory']},source:'https://github.com/Bittrees-Technology/crm/blob/main/bittrees.tools.json',boundary:'Forged public classification.'}]};
 assert.throws(()=>validateToolManifest(manifest,source));
});
test('HTTP public reads and local public adapters describe setup without claiming gateway authority',()=>{
 const c=fixture('agent').manifest.connections[0];
 const details=connectionRequirements(c);assert.equal(details.authentication,'none');assert.equal(details.schemaDiscovery.requiresCredentials,false);assert.equal(details.schemaDiscovery.requiresExistingConnection,true);
 assert.match(connectionInstructions([c]),/No bearer credential or sign-in/);
 assert.match(directoryConnectionLabel({...c,...details}),/Public read-only/);
 const local={...c,transport:'local-mcp-adapter',setup:{authentication:'none',command:'node',args:['reviewed.mjs']}};
 const localDetails=connectionRequirements(local);assert.equal(localDetails.schemaDiscovery.authority,'local-adapter');assert.match(connectionInstructions([local]),/not a remote MCP server/);assert.match(directorySchemaHelp(local),/not a remote MCP server/);
 const protectedConnection={...c,setup:undefined};
 assert.equal(connectionRequirements(protectedConnection).schemaDiscovery.requiresCredentials,true);assert.match(connectionInstructions([protectedConnection]),/existing scoped app credential/);assert.match(directoryConnectionLabel({...protectedConnection,...connectionRequirements(protectedConnection)}),/permission required/);
});
