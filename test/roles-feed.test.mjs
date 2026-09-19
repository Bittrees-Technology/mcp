import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';import {credentialRoleFeed} from '../src/service/roles-feed.mjs';
test('Credential inventory hides secrets and does not report expired identities as active',()=>{
 const pair=generateKeyPairSync('ed25519'),now=Date.now();const credential={tokenHash:'a'.repeat(64),tenant:'private-tenant',subject:'private-subject',audience:'https://mcp.bittrees.org',expiresAt:now-1000,projectIds:['roles'],permissions:['catalog:read']};
 const feed=credentialRoleFeed({ROLES_FEED_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'}),ROLES_FEED_SUBJECT_SECRET:'s'.repeat(64),MCP_CREDENTIALS_JSON:JSON.stringify([credential])},now);
 assert.equal(Object.keys(feed.data.roles).length,0);assert.equal(Object.values(feed.data.permissions)[0][0].effect,'deny');assert(!JSON.stringify(feed).includes(credential.tokenHash));assert(!JSON.stringify(feed).includes(credential.subject));
});
