import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {openSourceHandoff} from '../src/service/source-handoff.mjs';
// Paths only; never put keys or tokens in arguments. Output must not already exist.
const [envelopePath,reviewPath,privateKeyPath,crmPublicKeyPath,outputPath]=process.argv.slice(2);
try{
 if(process.argv.length!==7)throw Error();
 for(const path of [envelopePath,reviewPath,privateKeyPath,crmPublicKeyPath])if(statSync(path).size>32768)throw Error();
 if((statSync(privateKeyPath).mode&0o077)!==0)throw Error();
 const result=openSourceHandoff({envelope:JSON.parse(readFileSync(envelopePath,'utf8')),expectedMetadata:JSON.parse(readFileSync(reviewPath,'utf8')),recipientPrivateKey:readFileSync(privateKeyPath,'utf8'),signingPublicKey:readFileSync(crmPublicKeyPath,'utf8')});
 writeFileSync(outputPath,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
 console.log('Verified source handoff written to private output file.');
}catch{
 console.error('Source handoff rejected or private output unavailable. No credential printed.');process.exitCode=1;
}
