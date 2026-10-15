import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceConnections} from '../src/service/source-connections.mjs';
test('Source connections bind credential, actor, project and expiry; reject arbitrary destinations',async()=>{
 const actor={tenant:'t',subject:'s',tokenHash:'a'.repeat(64),permissions:['sources:propose'],projectIds:['crm','mercado']};
 const connection={...actor,actorTokenHash:actor.tokenHash,source:'crm',token:'b'.repeat(64),expiresAt:Date.now()+100000};
 const calls=[];
 const gateway=new SourceConnections([connection],async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({state:'not_found'}));});
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
