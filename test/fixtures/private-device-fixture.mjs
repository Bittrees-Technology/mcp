import {sign}from'node:crypto';
import{PrivateReadJournal}from'../../src/service/private-read-journal.mjs';import{requestMessage}from'../../src/service/roles-proof.mjs';import{emptyState}from'../../src/service/store.mjs';import{privateFixture}from'./private-read-fixture.mjs';
export function deviceFixture(source='insights'){
 const f=privateFixture(source),state=emptyState();let tail=Promise.resolve();
 const store={transaction(fn){const task=tail.then(()=>fn(state));tail=task.catch(()=>{});return task;}};
 f.binding.publicKey=f.principal.publicKey;delete f.binding.privateKey;f.connection.proofMode='device-held-delegated-v1';f.reads.deviceEnabled=true;f.reads.journal=new PrivateReadJournal(store,{clock:f.clock});
 return {...f,state,store,signChallenge:e=>({request:e.deviceChallenge.request,signature:sign(null,Buffer.from(requestMessage(e.deviceChallenge.request)),f.principal.privateKey).toString('base64')})};
}
