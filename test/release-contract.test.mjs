import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedMcpResult} from '../src/ecosystem/mcp.mjs';
import {verifySelectedAgentResources} from '../scripts/release-contract.mjs';
test('release accepts the actual selected directory and Agent resources but rejects scope leaks',()=>{
 const reply=scopedMcpResult({jsonrpc:'2.0',id:1,method:'resources/list'},{url:'/mcp?mode=selected&projects=agent'});
 assert.doesNotThrow(()=>verifySelectedAgentResources(reply));
 for(const change of [r=>r.pop(),r=>r.push({...r[2],name:'crm',uri:'https://mcp.bittrees.org/v1/projects/crm'}),r=>r[2].uri='https://other.invalid/v1/projects/agent',r=>r[2]={...r[0]},r=>r[0].mimeType='text/html']){
  const bad=structuredClone(reply);change(bad.result.resources);assert.throws(()=>verifySelectedAgentResources(bad));
 }
});
