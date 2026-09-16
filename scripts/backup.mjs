import pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const key=Buffer.from(process.env.MCP_BACKUP_KEY??'','hex');
if(key.length!==32)throw new Error('A dedicated 256-bit backup key is required');
if(process.argv.includes('--verify')){
 const blob=JSON.parse(await readFile(process.env.MCP_BACKUP_FILE,'utf8'));
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(blob.iv,'hex'));decipher.setAuthTag(Buffer.from(blob.tag,'hex'));
 const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.ciphertext,'base64')),decipher.final()]).toString());
 if(data.schema!==1||data.state?.version!==1)throw new Error('Unsupported backup');
 if(process.env.MCP_RESTORE_TEST_DATABASE_URL){
  const target=new URL(process.env.MCP_RESTORE_TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1'].includes(target.hostname))throw new Error('Restore drill is local-only');
  const p=new pg.Pool({connectionString:target.href});
  try{await p.query('CREATE TEMP TABLE mcp_restore_drill (body jsonb)');await p.query('INSERT INTO mcp_restore_drill VALUES ($1)',[data.state]);const result=await p.query('SELECT body FROM mcp_restore_drill');if(!isDeepStrictEqual(result.rows[0].body,data.state))throw new Error('Restore mismatch');}finally{await p.end();}
 }
 console.log('Encrypted backup authenticated and restore payload verified');
}else{
 const pool=new pg.Pool({connectionString:process.env.MCP_DATABASE_URL,max:1});
 try{const {rows}=await pool.query('SELECT body FROM mcp.bittrees_mcp_state WHERE id=1');if(!rows[0])throw new Error('Missing state');
 const plain=Buffer.from(JSON.stringify({schema:1,at:new Date().toISOString(),state:rows[0].body}));const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
 await mkdir('output/backups',{recursive:true});const path=`output/backups/mcp-${Date.now()}.json.enc`;await writeFile(path,JSON.stringify({version:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('base64')}),{mode:0o600});console.log(path);
 }finally{await pool.end();}
}
