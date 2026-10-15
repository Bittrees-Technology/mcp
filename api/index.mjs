import {projectAdministrationNode} from '../shared/project-administration/portal.mjs';
const administration=projectAdministrationNode('mcp');
import {handleRoleFeed} from '../src/service/roles-feed.mjs';
import {runtime} from '../src/service/runtime.mjs';
let handler;export default async function(req,res){if(/^\/(administration\/?|api\/(project-admin(?:\/.*)?|shared-roles-health))$/.test(new URL(req.url,'https://mcp.bittrees.org').pathname))return administration(req,res);if(new URL(req.url,"https://mcp.bittrees.org").pathname==="/api/roles-feed")return handleRoleFeed(req,res);try{handler??=await runtime();return await handler(req,res);}catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'MCP service configuration or storage unavailable'}));}}
