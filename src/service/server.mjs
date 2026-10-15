import {projectAdministrationNode} from '../../shared/project-administration/portal.mjs';
import { createServer } from "node:http";
import { runtime } from "./runtime.mjs";
const handler = await runtime();
const administration=projectAdministrationNode('mcp');
const server = createServer((req,res)=>/^\/(administration\/?|api\/(project-admin(?:\/.*)?|shared-roles-health))$/.test(new URL(req.url,'https://mcp.bittrees.org').pathname)?administration(req,res):handler(req,res));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT ?? 8788), "127.0.0.1");
