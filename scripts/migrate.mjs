import {readFile} from 'node:fs/promises';
import pg from 'pg';
const connectionString=process.env.MCP_MIGRATION_DATABASE_URL;
if(!connectionString)throw new Error('Dedicated migration credential required');
const pool=new pg.Pool({connectionString,max:1});
try{await pool.query(await readFile(new URL('../migrations/001_state.sql',import.meta.url),'utf8'));await pool.query(await readFile(new URL('../migrations/002_ai_dispatch.sql',import.meta.url),'utf8'));console.log('MCP schema migration applied');}finally{await pool.end();}
