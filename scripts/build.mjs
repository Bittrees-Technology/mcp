import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('public',{recursive:true});await writeFile('public/robots.txt','User-agent: *\nDisallow: /\n');
await import('../src/service/runtime.mjs');console.log('Standalone MCP build validated');
