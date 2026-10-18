import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authenticate} from '../src/service/http.mjs';
test('device proofs remain request-scoped and malformed headers fail closed',()=>{
 const token='test-device-transport-credential',actor={tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:Date.now()+60000};
 const proof={request:{requestId:'untrusted-until-verified'},signature:'proof'};
 const headers={authorization:'Bearer '+token,'x-bittrees-agent-proof':Buffer.from(JSON.stringify(proof)).toString('base64url')};
 const result=authenticate(headers,[actor]);assert.deepEqual(result.rolesProof,proof);assert.equal(actor.rolesProof,undefined);
 assert.equal(authenticate({authorization:headers.authorization},[actor]).rolesProof,undefined);
 for(const encoded of ['*','a'.repeat(8193),Buffer.from('invalid JSON').toString('base64url'),['abc']])assert.throws(()=>authenticate({...headers,'x-bittrees-agent-proof':encoded},[actor]));
});
