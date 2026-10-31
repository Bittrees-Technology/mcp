#!/usr/bin/env node
// macOS stdio transport for the owner's existing News grant. No grants are issued.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const ENDPOINT='https://news.bittrees.org/api/mcp';
const SERVICE='org.bittrees.codex.news';
const ACCOUNT='bittrees_news';
const METHODS=new Set(['initialize','ping','tools/list','tools/call','resources/list','resources/read','resources/templates/list','prompts/list','prompts/get']);
const loadKeychainToken=()=>execFileSync('/usr/bin/security',['find-generic-password','-s',SERVICE,'-a',ACCOUNT,'-w'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']}).trim();
export function createNewsBridge({loadToken=loadKeychainToken,request=fetch}={}){
 return async message=>{
  const id=message?.id??null;
  const error=(code,text)=>({jsonrpc:'2.0',id,error:{code,message:text}});
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return error(-32600,'Invalid MCP request');
  if(message.id===undefined)return null;
  if(!METHODS.has(message.method))return error(-32601,'Unsupported MCP method');
  try{
   const token=loadToken();
   if(!/^tbn_[a-f0-9]{64}$/.test(token))throw Error('credential');
   const r=await request(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(message)});
   if(!r.ok||!r.body)throw Error('source');
   const reader=r.body.getReader(),chunks=[];let length=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4_000_000)throw Error('large');chunks.push(value);}}finally{await reader.cancel();}
   const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(reply?.jsonrpc!=='2.0'||reply.id!==id||(!Object.hasOwn(reply,'result')&&!Object.hasOwn(reply,'error')))throw Error('reply');
   return reply;
  }catch{return error(-32001,'News connection unavailable. Check the existing Keychain credential and source grant; no permission was added.');}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2){process.stderr.write('This adapter accepts no command arguments.\n');process.exit(1);}
 const handle=createNewsBridge();let buffer='',pending=0,tail=Promise.resolve();
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{
  buffer+=chunk;
  if(Buffer.byteLength(buffer)>262144){process.stderr.write('MCP input limit exceeded.\n');process.exit(1);}
  let end;while((end=buffer.indexOf('\n'))!==-1){
   const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
   if(++pending>32){process.stderr.write('MCP request queue limit exceeded.\n');process.exit(1);}
   tail=tail.then(async()=>{let message;try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})+'\n');return;}
    const result=await handle(message);if(result)process.stdout.write(JSON.stringify(result)+'\n');
   }).catch(()=>process.stderr.write('News MCP request failed.\n')).finally(()=>pending--);
  }
 });
}
