import { createServer } from "node:http";
import { runtime } from "./runtime.mjs";
const handler = await runtime();
const server = createServer(handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT ?? 8788), "127.0.0.1");
