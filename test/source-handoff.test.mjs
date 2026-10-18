import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {sealSourceHandoff,openSourceHandoff,recipientKeyId} from '../src/service/source-handoff.mjs';
const rsa=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const signer=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const now=Date.now(),sourceWorkspace=randomUUID();
const metadata={version:1,issuer:'https://crm.bittrees.org',audience:'https://mcp.bittrees.org',handoffId:randomUUID(),connectionId:randomUUID(),leaseId:randomUUID(),policyDigest:'a'.repeat(64),tenant:'roles:'+randomUUID(),workspace:'crm:'+sourceWorkspace,principal:'agent:'+randomUUID(),credentialId:'b'.repeat(64),runtimeBindingDigest:'c'.repeat(64),sourceWorkspace,mappingDigest:'d'.repeat(64),activatedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),recipientKeyId:recipientKeyId(rsa.publicKey)};
const token='synthetic-test-source-token-only';
const envelope=sealSourceHandoff({metadata,token,recipientPublicKey:rsa.publicKey,signingPrivateKey:signer.privateKey,now});
const open=(changes={})=>openSourceHandoff({envelope,expectedMetadata:metadata,recipientPrivateKey:rsa.privateKey,signingPublicKey:signer.publicKey,now,...changes});
test('sealed handoff carries no plaintext credential and recovers exact bounded source configuration',()=>{
 assert.equal(JSON.stringify(envelope).includes(token),false);
 assert.deepEqual(open(),{token,sourceWorkspace,expiresAt:now+3600000});
 assert.deepEqual(open(),open()); // Retrying cannot renew expiry.
});
test('rejects every changed binding even when envelope itself was validly signed',()=>{
 for(const field of ['leaseId','principal','credentialId','runtimeBindingDigest','mappingDigest','recipientKeyId','sourceWorkspace','policyDigest','tenant','workspace','connectionId','handoffId'])assert.throws(()=>open({expectedMetadata:{...metadata,[field]:'changed'}}),/Invalid/);
});
test('rejects a validly shaped different approved context',()=>{
 assert.throws(()=>open({expectedMetadata:{...metadata,leaseId:randomUUID()}}),/Invalid/);
 assert.throws(()=>open({expectedMetadata:{...metadata,mappingDigest:'e'.repeat(64)}}),/Invalid/);
});
test('rejects tampering, wrong signer, unsigned extensions, premature or expired use',()=>{
 for(const f of ['encryptedKey','iv','ciphertext','tag','signature'])assert.throws(()=>open({envelope:{...envelope,[f]:'AAAA'}}),/Invalid/);
 assert.throws(()=>open({envelope:{...envelope,extra:true}}),/Invalid/);
 const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
 assert.throws(()=>open({signingPublicKey:wrong}),/Invalid/);
 assert.throws(()=>open({now:now-1}),/Invalid/);
 assert.throws(()=>open({now:now+3600000}),/Invalid/);
});
test('refuses expiry extension and recipient substitution at sealing',()=>{
 const args={metadata,token,recipientPublicKey:rsa.publicKey,signingPrivateKey:signer.privateKey,now};
 assert.throws(()=>sealSourceHandoff({...args,metadata:{...metadata,expiresAt:new Date(now+3600001).toISOString()}}),/Invalid/);
 assert.throws(()=>sealSourceHandoff({...args,metadata:{...metadata,recipientKeyId:'e'.repeat(64)}}),/Invalid/);
});
test('operator CLI writes private file once and never prints credential',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'source-handoff-test-'));
 try{
  const values=[JSON.stringify(envelope),JSON.stringify(metadata),rsa.privateKey,signer.publicKey];
  const paths=values.map((v,i)=>{const path=join(dir,String(i));writeFileSync(path,v,{mode:0o600});return path;});
  const output=join(dir,'output');const args=['scripts/open-source-handoff.mjs',...paths,output];
  const result=spawnSync(process.execPath,args,{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal((result.stdout+result.stderr).includes(token),false);
  assert.equal(statSync(output).mode&0o777,0o600);assert.equal(JSON.parse(readFileSync(output)).token,token);
  const retry=spawnSync(process.execPath,args,{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(retry.status,1);assert.equal((retry.stdout+retry.stderr).includes(token),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
