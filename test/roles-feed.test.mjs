import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';import {credentialRoleFeed} from '../src/service/roles-feed.mjs';
test('Credential inventory hides secrets and does not report expired identities as active',()=>{
 const pair=generateKeyPairSync('ed25519'),now=Date.now();const credential={tokenHash:'a'.repeat(64),tenant:'private-tenant',subject:'private-subject',audience:'https://mcp.bittrees.org',expiresAt:now-1000,projectIds:['roles'],permissions:['catalog:read']};
 const feed=credentialRoleFeed({ROLES_FEED_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'}),ROLES_FEED_SUBJECT_SECRET:'s'.repeat(64),MCP_CREDENTIALS_JSON:JSON.stringify([credential])},now);
 assert.equal(Object.keys(feed.data.roles).length,0);assert.equal(Object.values(feed.data.permissions)[0][0].effect,'deny');assert(!JSON.stringify(feed).includes(credential.tokenHash));assert(!JSON.stringify(feed).includes(credential.subject));
});

test('Inventory includes all runtime sources and preserves managed credential expiry semantics',()=>{
 const pair=generateKeyPairSync('ed25519'),now=Date.now();
 const actor={tokenHash:'a'.repeat(64),tenant:'tenant',subject:'base',audience:'https://mcp.bittrees.org',expiresAt:now+60000,projectIds:['crm'],permissions:['catalog:read']};
 const env={ROLES_FEED_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'}),ROLES_FEED_SUBJECT_SECRET:'s'.repeat(64),
 MCP_CREDENTIALS_JSON:JSON.stringify([actor]),MCP_SOURCE_ACTORS_JSON:JSON.stringify([{...actor,subject:'source',tokenHash:'b'.repeat(64),managed:true,expiresAt:null}]),
 MCP_QUALIFIED_ACTORS_JSON:JSON.stringify([{...actor,subject:'qualified',tokenHash:'c'.repeat(64),expiresAt:now-1}])};
 const feed=credentialRoleFeed(env,now).data,permissions=Object.values(feed.permissions).flat();
 assert.equal(Object.keys(feed.subjects).length,3);assert.equal(Object.keys(feed.roles).length,2);
 assert.equal(permissions.filter(p=>p.effect==='allow').length,2);assert.equal(permissions.filter(p=>p.effect==='deny').length,1);
 assert(permissions.some(p=>p.effect==='allow'&&p.expiresAt===null));
 assert(!JSON.stringify(feed).includes(actor.tokenHash));assert(!JSON.stringify(feed).includes('qualified'));
 assert.throws(()=>credentialRoleFeed({...env,MCP_SOURCE_ACTORS_JSON:JSON.stringify([actor])},now),/Invalid MCP/);
 assert.throws(()=>credentialRoleFeed({...env,MCP_QUALIFIED_ACTORS_JSON:'{}'},now),/Invalid MCP/);
});
