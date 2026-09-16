import {runtime} from '../src/service/runtime.mjs';
let handler;export default async function(req,res){try{handler??=await runtime();return await handler(req,res);}catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'MCP service configuration or storage unavailable'}));}}
