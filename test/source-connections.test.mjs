import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceConnections} from '../src/service/source-connections.mjs';
test('Source connections bind credential, actor, project and expiry; reject arbitrary destinations',async()=>{
 const actor={tenant:'t',subject:'s',tokenHash:'a'.repeat(64),permissions:['sources:propose'],projectIds:['crm','mercado'],rolesAuthorityBinding:'test-approved'};
 const connection={...actor,actorTokenHash:actor.tokenHash,source:'crm',token:'b'.repeat(64),expiresAt:Date.now()+100000};
 const calls=[];
 const gateway=new SourceConnections([connection],async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({state:'not_found'}));},{execute:async(a,b,s,p,effect)=>effect(p)});
 assert.equal(gateway.list(actor,['crm']).length,3);
 assert.equal(gateway.list({...actor,subject:'other'},['crm']).length,0);
 assert.equal(gateway.list({...actor,tokenHash:'c'.repeat(64)},['crm']).length,0);
 assert.equal(gateway.list(actor,['mercado']).length,0);
 await assert.rejects(gateway.call(actor,['crm'],'source_crm_preview',{url:'https://attacker.org'}));
 assert.deepEqual(await gateway.call(actor,['crm'],'source_crm_status',{operationId:'test'}),{state:'not_found'});
 assert.equal(calls[0].url,'https://crm.bittrees.org/api/integrations/leads/status');
 assert.equal(calls[0].options.redirect,'error');
 assert(!JSON.stringify(gateway.list(actor,['crm'])).includes(connection.token));
 connection.expiresAt=0;assert.equal(gateway.list(actor,['crm']).length,0);
});

test('explicit Roles source binding cannot fall back to legacy execution',async()=>{
 const actor={tenant:'t',subject:'s',tokenHash:'a'.repeat(64),permissions:['sources:propose'],projectIds:['crm'],rolesAuthorityBinding:'enrolled'};
 const connection={actorTokenHash:actor.tokenHash,tenant:'t',subject:'s',source:'crm',token:'b'.repeat(64),expiresAt:Date.now()+100000};
 let effects=0;const request=async()=>{effects++;return new Response('{}');};
 const gateway=new SourceConnections([connection],request,{execute:async()=>{throw Error('revoked');}});
 await assert.rejects(gateway.call(actor,['crm'],'source_crm_status',{operationId:'123'}));assert.equal(effects,0);
 gateway.rolesConsumer=undefined;await assert.rejects(gateway.call(actor,['crm'],'source_crm_status',{operationId:'123'}));assert.equal(effects,0);
 connection.rolesAuthorityBinding='enrolled';delete actor.rolesAuthorityBinding;
 await assert.rejects(gateway.call(actor,['crm'],'source_crm_status',{operationId:'123'}));assert.equal(effects,0);
});
test('bound source actions retain stable operation scope and original workflow checks',async()=>{
 const original=globalThis.fetch;let workflowAllowed=true,checks=0,effects=0,scopes=[];
 globalThis.fetch=async()=>{checks++;return new Response(JSON.stringify({active:workflowAllowed}));};
 try {
 const actor={tenant:'t',subject:'s',managed:true,tokenHash:'a'.repeat(64),permissions:['sources:propose','sources:execute'],projectIds:['crm'],rolesAuthorityBinding:'enrolled'};
 const connection={actorTokenHash:actor.tokenHash,tenant:'t',subject:'s',managed:true,source:'crm',token:'b'.repeat(64),expiresAt:null};
 const consumer={execute:async(a,b,scope,args,effect)=>{scopes.push(scope);return effect(structuredClone(args));}};
 const gateway=new SourceConnections([connection],async()=>{effects++;return new Response('{}');},consumer);
 const operationId='00000000-0000-4000-8000-000000000001';
 for(const action of ['brief','preview','status','execute'])await gateway.call(actor,['crm'],`source_crm_${action}`,action==='brief'?{}:{operationId,...(action==='preview'?{candidates:[]}: {})});
 assert.equal(effects,4);assert.equal(scopes[0].resource,'workspace:brief');
 for(const scope of scopes.slice(1)){assert.equal(scope.resource,`operation:${operationId}`);assert.equal(scope.operationId,operationId);}
 assert.equal(checks,5);workflowAllowed=false;
 await assert.rejects(gateway.call(actor,['crm'],'source_crm_execute',{operationId}));assert.equal(effects,4);assert.equal(scopes.length,4);
 } finally {globalThis.fetch=original;}
});

test('legacy source credentials without a Roles binding cannot discover or call protected tools',async()=>{
 const actor={tenant:'t',subject:'s',tokenHash:'a'.repeat(64),permissions:['sources:propose','sources:execute'],projectIds:['crm'],managed:true};
 const connection={...actor,actorTokenHash:actor.tokenHash,source:'crm',token:'b'.repeat(64),expiresAt:Date.now()+100000};
 let effects=0;const gateway=new SourceConnections([connection],async()=>{effects++;return new Response('{}');},{execute:async(a,b,s,p,effect)=>effect(p)});
 assert.deepEqual(gateway.list(actor,['crm']),[]);
 for(const action of ['brief','preview','status','execute'])await assert.rejects(gateway.call(actor,['crm'],`source_crm_${action}`,{}));
 assert.equal(effects,0);
});
