import {MANAGEMENT_TOOLS} from "./operation-registry.mjs";
import {toolDirectory} from "./tool-directory.mjs";
import { Operations } from "./operations.mjs";
import {serviceStatus,statusPage} from "./status.mjs";
import { functionCatalog } from "../ecosystem/tool-coverage.mjs";
import { checkWorkflowAuthority, activeExpiry } from "./workflow-authority.mjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CATALOG,
  catalogView,
  selectionFromParams,
  clientConfiguration,
  catalogRevision,
  resolveSelection,
} from "../ecosystem/catalog.mjs";
import { scopedMcpResult } from "../ecosystem/mcp.mjs";
import {
  renderConnectionPage,
} from "../ecosystem/ui.mjs";
import { home, projects, workspace } from "../ecosystem/site.mjs";
import { fail, authorize } from "./engine.mjs";
import { MANAGEMENT_ROUTES, serviceReference, referencePage } from "./reference.mjs";
const ORIGIN = "https://mcp.bittrees.org";
const hash = (s) => createHash("sha256").update(s).digest("hex");
export function validateCredentials(credentials) {
  const identities = new Set();
  for (const actor of credentials) {
    const identity = JSON.stringify([actor.tenant, actor.subject]);
    if (
      !/^[a-f0-9]{64}$/.test(actor.tokenHash) ||
      typeof actor.tenant !== "string" ||
      !actor.tenant ||
      typeof actor.subject !== "string" ||
      !actor.subject ||
      identities.has(identity) ||
      actor.audience !== ORIGIN ||
      !(Number.isFinite(actor.expiresAt) || (actor.deviceManaged===true && actor.expiresAt===null && typeof actor.rolesAuthorityBinding==='string' && actor.permissions?.every(p=>["catalog:read","workflow:execute"].includes(p))) || (actor.managed === true && actor.expiresAt === null && actor.permissions?.every(p => ["catalog:read", "sources:propose", "sources:execute"].includes(p)))) ||
      !Array.isArray(actor.projectIds) ||
      !Array.isArray(actor.permissions)
    )
      throw new Error("Invalid MCP service credential configuration");
    identities.add(identity);
  }
  return credentials;
}
export function authenticate(headers, credentials) {
  if (!headers.authorization) return null;
  const match = headers.authorization.match(/^Bearer ([^\s]{16,4096})$/);
  if (!match) throw fail("Invalid service credential", 401);
  const digest = Buffer.from(hash(match[1]), "hex");
  const actor = credentials.find((a) =>
    timingSafeEqual(digest, Buffer.from(a.tokenHash, "hex")),
  );
  if (!actor || !activeExpiry(actor))
    throw fail("Invalid or expired service credential", 401);
  const encoded=headers['x-bittrees-agent-proof'];
  if(encoded===undefined)return actor;
  if(typeof encoded!=='string'||encoded.length>16384||!/^[A-Za-z0-9_-]+$/.test(encoded))throw fail("Invalid device proof",401);
  let rolesProof;try{rolesProof=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw fail("Invalid device proof",401);}
  if(rolesProof?.proofs!==undefined&&(!Array.isArray(rolesProof.proofs)||rolesProof.proofs.length>3))throw fail("Invalid device proof bundle",401);
  // Request-scoped only: never mutate or persist the configured actor.
  return {...actor,rolesProof};
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? ""))
    throw fail("JSON content type required", 415);
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw fail("Request too large", 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw fail("Invalid JSON");
  }
}
export function createMcpHandler({
  engine,
  credentials = [],
  workerToken = "",
  cronToken = "",
  rolesReadiness,
  observeRoles = async () => ({state:"not-checked",consumerEnforcement:"not-integrated"}),
  aiConnections,
  sourceConnections,
  taskSync,
  workflowDevices,
  catalog = CATALOG,
  release = "development",
} = {}) {
  validateCredentials(credentials);
  const operations = new Operations(engine);
  const status = () => serviceStatus({catalog,operations,release,aiConfigured:Boolean(aiConnections),sourceConfigured:Boolean(sourceConnections?.connections.length),taskSyncConfigured:Boolean(taskSync?.connections.length),cronConfigured:Boolean(cronToken),rolesReadiness,observeRoles});
  const resolveActor = (tenant, subject) =>
    credentials.find(
      (a) =>
        a.tenant === tenant &&
        a.subject === subject &&
        a.expiresAt > Date.now(),
    );
  return async (req, res) => {
    const send = (status, data, type = "application/json", extra = {}) => {
      res.writeHead(status, {
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "X-Robots-Tag": "noindex, nofollow",
        ...extra,
      });
      res.end(
        req.method === "HEAD"
          ? ""
          : type === "application/json"
            ? JSON.stringify(data)
            : data,
      );
    };
    let message;
    try {
      const url = new URL(req.url, ORIGIN);
      const path = url.pathname;
      if (req.headers.origin && req.headers.origin !== ORIGIN)
        throw fail("Origin not allowed", 403);
      if (path === "/internal/tick" || path === "/internal/cron") {
        const cron = path === "/internal/cron", secret = cron ? cronToken : workerToken;
        if (req.method !== (cron ? "GET" : "POST")) throw fail("Method not allowed", 405);
        if (
          !secret ||
          hash(req.headers.authorization ?? "") !==
            hash(`Bearer ${secret}`)
        )
          throw fail("Worker authentication required", 401);
        return send(200, await operations.tick(resolveActor, cron ? "vercel-cron" : "manual-worker"));
      }
      if (["GET","HEAD"].includes(req.method) && ["/assets/site.css","/assets/connect.js","/assets/workspace.js","/assets/workspace-polling.js"].includes(path)) {
        const content = await readFile(new URL(`../../public${path}`, import.meta.url), "utf8");
        return send(200, content, path.endsWith('.css') ? 'text/css' : 'text/javascript');
      }
      if (["GET","HEAD"].includes(req.method) && ["/","/projects","/explore","/rules","/automations"].includes(path))
        return send(200, path==='/'?home(catalog):['/projects','/explore'].includes(path)?projects(catalog):workspace(path.slice(1)), 'text/html');
      if (["GET", "HEAD"].includes(req.method) && ["/reference", "/reference.json"].includes(path))
        return path === "/reference" ? send(200, referencePage(MANAGEMENT_TOOLS), "text/html") : send(200, serviceReference(MANAGEMENT_TOOLS));
      if(path==='/tools' && ['GET','HEAD'].includes(req.method))return send(200,toolDirectory(catalog,url.searchParams),'text/html');
      if(path==='/v1/task-sync/connect'&&req.method==='POST'){
        if(req.headers.cookie||req.headers.authorization||url.search||req.headers.origin)throw fail('Use the native device connection',400);
        if(!taskSync)throw fail('Task sync is not configured',403);
        const {connectTaskSync}=await import('./task-sync-connect.mjs');
        const input=await readBody(req);
        return send(200,await connectTaskSync(input,{credentials,rolesConsumer:taskSync.rolesConsumer,connections:taskSync.connections}));
      }
      const actor = authenticate(req.headers, credentials);
      if (actor?.managed) await checkWorkflowAuthority(req.headers.authorization.slice(7), "mcp", "sources:propose");
      if (["/status", "/status.json"].includes(path) && ["GET", "HEAD"].includes(req.method)) {
        const report = await status();
        return send(report.storage === "ready" ? 200 : 503, path === "/status" ? statusPage(report) : report, path === "/status" ? "text/html" : "application/json");
      }
      if (path === "/health" && ["GET", "HEAD"].includes(req.method)) {
        await engine.store.transaction(() => null);
        return send(200, {
          service: "bittrees-mcp",
          release,
          storage: "ready",
          catalogRevision: catalogRevision(catalog),
          adapter: "public-context-and-scoped-source-connections",
          sensitiveActions: sourceConnections?.connections.length ? "configured-source-authorization-required" : "not-configured",
          aiAutomation: aiConnections ? "configured-not-end-to-end-verified" : "not-configured",
          scheduler: await operations.snapshot(),
          rolesExecution: rolesReadiness ?? {consumerEnforcement:"not-integrated"},
        });
      }
      if (path === "/mcp-docs" && ["GET","HEAD"].includes(req.method)) return send(302,undefined,"text/plain",{Location:"/connect#client-help"});
      if (
        ["GET", "HEAD"].includes(req.method) &&
        ["/connect"].includes(path)
      )
        return send(
          200,
          renderConnectionPage(url.searchParams, catalog),
          "text/html",
        );
      if (
        path.startsWith("/schemas/") &&
        ["GET", "HEAD"].includes(req.method)
      ) {
        const name = path.slice(9);
        if (
          !["project-manifest.schema.json", "selection.schema.json"].includes(
            name,
          )
        )
          throw fail("Schema not found", 404);
        return send(
          200,
          JSON.parse(
            await readFile(
              new URL(`../../schemas/${name}`, import.meta.url),
              "utf8",
            ),
          ),
        );
      }
      if (path === "/catalog-sync.json" && ["GET", "HEAD"].includes(req.method))
        return send(
          200,
          JSON.parse(
            await readFile(
              new URL(
                "../../data/catalog-sync-status.json",
                import.meta.url,
              ),
              "utf8",
            ),
          ),
        );
      if (path.startsWith("/v1/ai/connections")) {
        if (!aiConnections) throw fail("AI connections are not configured", 404);
        if (url.search || req.headers.cookie) throw fail("Use the authenticated connection request", 400);
        if (path === "/v1/ai/connections" && req.method === "GET")
          return send(200, { connections: await aiConnections.list(actor) });
        if (req.method !== "POST") throw fail("Method not allowed", 405);
        const actions = {
          "/v1/ai/connections/prepare": [],
          "/v1/ai/connections/register": ["id"],
          "/v1/ai/connections/redeem": ["id", "expectedOwnerId", "confirmed"],
          "/v1/ai/connections/disconnect": ["id", "confirmed"],
        };
        const allowed = actions[path];
        if (!allowed) throw fail("Route not found", 404);
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).length !== allowed.length || allowed.some((key) => !Object.hasOwn(body, key)) ||
            (allowed.includes("id") && (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id))))
          throw fail("Invalid connection request");
        if (path.endsWith("/prepare")) return send(200, await aiConnections.prepare(actor));
        if (path.endsWith("/register")) return send(200, await aiConnections.register(actor, body.id));
        if (path.endsWith("/redeem")) return send(200, await aiConnections.redeem(actor, body));
        if (body.confirmed !== true) throw fail("Confirm disconnection");
        return send(200, await aiConnections.disconnect(actor, body.id));
      }
      if (path === "/v1/workspace" && req.method === "GET") {
        authorize(actor, "catalog:read");
        const history = await engine.act(actor, "history", {limit:50});
        const selected = selectionFromParams(new URLSearchParams("mode=ecosystem"));
        return send(200, { ...history, credentialExpiresAt:actor.expiresAt, capacity:await operations.privateMetrics(actor), aiConnectionsEnabled: Boolean(aiConnections), permissions: actor.permissions, projects: catalogView(catalog,selected).projects.filter(p=>actor.projectIds.includes(p.id)).map(p=>({id:p.id,name:p.name,summary:p.summary})) });
      }
      if (path === "/v1/history" && req.method === "GET")
        return send(200, await engine.act(actor, "history", Object.fromEntries([...url.searchParams].map(([k,v])=>[k,k==="limit"?Number(v):v]))));
      if (req.method === "POST" && path === "/v1/ai/runs/retry")
        return send(200, await engine.act(actor, "ai.retry", await readBody(req)));
      if (req.method === "POST" && path.startsWith("/v1/")) {
        const operations = MANAGEMENT_ROUTES;
        if (!operations[path]) throw fail("Route not found", 404);
        return send(
          200,
          await engine.act(actor, operations[path], await readBody(req)),
        );
      }
      let params = new URLSearchParams(url.searchParams);
      const stored = path.match(/^\/profiles\/([a-f0-9-]{36})\/mcp$/);
      if (stored) {
        authorize(actor, "profile:read");
        if (params.size)
          throw fail("Stored profiles do not accept URL overrides");
        const record = await engine.store.transaction(
          (s) => s.profiles[stored[1]],
        );
        if (
          !record ||
          record.tenant !== actor.tenant ||
          record.subject !== actor.subject
        )
          throw fail("Profile not found", 404);
        params = new URL(
          clientConfiguration(record.selection).mcpServers.bittrees.url,
        ).searchParams;
      }
      for (const name of params.keys())
        if (
          ![
            "mode",
            "projects",
            "exclude",
            "profileVersion",
            "profileRevision",
          ].includes(name)
        )
          throw fail("Unknown selection parameter");
      if (!params.has("mode")) params.set("mode", "ecosystem");
      let profile = selectionFromParams(params);
      // Credentials can restrict public discovery but never expand catalog eligibility.
      if (actor) {
        authorize(actor, "catalog:read");
        const selected = resolveSelection(catalog, profile).projects.filter(
          (p) => actor.projectIds.includes(p.id),
        );
        profile = {
          ...profile,
          mode: "selected",
          selectedIds: selected.map((p) => p.id),
        };
        params = new URL(clientConfiguration(profile).mcpServers.bittrees.url)
          .searchParams;
      }
      if (
        ["GET", "HEAD"].includes(req.method) &&
        ["/catalog.json", "/tool-catalog.json", "/connection.json", "/projects"].includes(path)
      ) {
        const body =
          path === "/connection.json"
            ? clientConfiguration(profile)
            : path === "/tool-catalog.json" ? functionCatalog(catalogView(catalog, profile).projects) : catalogView(catalog, profile);
        const etag = '"' + hash(JSON.stringify(body)) + '"';
        const headers = {
          ETag: etag,
          "X-Catalog-Revision": catalogRevision(catalog),
          ...(path === "/connection.json"
            ? {
                "Content-Disposition":
                  'attachment; filename="bittrees-mcp.json"',
              }
            : {}),
        };
        if (req.headers["if-none-match"] === etag)
          return send(304, undefined, "application/json", headers);
        return send(200, body, "application/json", headers);
      }
      if (
        ["GET", "HEAD"].includes(req.method) &&
        path.startsWith("/v1/projects/")
      ) {
        const project = catalogView(catalog, profile).projects.find(
          (p) => p.id === path.slice(13),
        );
        if (!project) throw fail("Project not found", 404);
        return send(200, project);
      }
      if ((path === "/mcp" || stored) && req.method !== "POST")
        throw fail("MCP supports POST only", 405);
      if ((path === "/mcp" || stored) && req.method === "POST") {
        if (
          req.headers["mcp-protocol-version"] &&
          !["2025-06-18", "2025-03-26"].includes(
            req.headers["mcp-protocol-version"],
          )
        )
          throw fail("Unsupported MCP protocol version");
        if (
          req.headers.accept &&
          !req.headers.accept.includes("application/json") &&
          !req.headers.accept.includes("*/*")
        )
          throw fail("JSON response must be accepted", 406);
        message = await readBody(req);
        if (
          !message ||
          Array.isArray(message) ||
          message.jsonrpc !== "2.0" ||
          typeof message.method !== "string" ||
          (message.id !== undefined &&
            typeof message.id !== "string" &&
            typeof message.id !== "number")
        )
          throw fail("Invalid JSON-RPC request");
        if (message.id === undefined) {
          if (message.method === "notifications/initialized")
            return send(202, undefined);
          throw fail("Unsupported notification");
        }
        const sourceProjects = resolveSelection(catalog, profile).projects.map(p => p.id);
        if(message.method === "tools/call" && message.params?.name?.startsWith("workflow_")) {
          if(["origin","cookie","content-encoding"].some(k=>Object.hasOwn(req.headers,k)))throw fail("Use the native workflow device connection",403);
          if(!workflowDevices)throw fail("Workflow device connection is not configured",403);
          const data=await workflowDevices.call(actor,sourceProjects,message.params.name,message.params.arguments??{});
          return send(200,{jsonrpc:"2.0",id:message.id,result:{structuredContent:data,content:[{type:"text",text:JSON.stringify(data)}]}});
        }
        if(message.method === "tools/call" && message.params?.name?.startsWith("task_sync_")) {
          if(!taskSync)throw fail("Task sync is not configured",403);
          const data=await taskSync.call(actor,sourceProjects,message.params.name,message.params.arguments??{});
          return send(200,{jsonrpc:"2.0",id:message.id,result:{structuredContent:data,content:[{type:"text",text:JSON.stringify(data)}]}});
        }
        if (message.method === "tools/call" && message.params?.name?.startsWith("source_")) {
          if (actor?.managed && message.params.name.endsWith("_execute")) await checkWorkflowAuthority(req.headers.authorization.slice(7), "mcp", "sources:execute");
          if (!sourceConnections) throw fail("Source connections disabled", 403);
          const data = await sourceConnections.call(actor, sourceProjects, message.params.name, message.params.arguments ?? {});
          return send(200, {jsonrpc:"2.0",id:message.id,result:{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
        }
        const management = MANAGEMENT_TOOLS.filter((tool) =>
          (tool.permissions??[tool.permission]).every(p=>actor?.permissions.includes(p)),
        );
        if (
          message.method === "tools/call" &&
          message.params?.name?.startsWith("automation_")
        ) {
          const tool = management.find((t) => t.name === message.params.name);
          if (!tool) throw fail("Tool not available", 403);
          const args = message.params.arguments ?? {};
          if (
            !args ||
            typeof args !== "object" ||
            Array.isArray(args) ||
            Object.keys(args).some(
              (k) => !Object.hasOwn(tool.inputSchema.properties, k),
            )
          )
            throw fail("Invalid tool arguments");
          if (tool.operation === "automation.setup" && !resolveSelection(catalog,profile).projects.some(p=>p.id===args.projectId)) throw fail("Project is outside this selection",403);
          if (tool.operation !== "history" && tool.operation !== "automation.setup") {
            const target = await engine.store.transaction(
              (s) => s.automations[args.id],
            );
            if (
              !target ||
              target.tenant !== actor.tenant ||
              target.subject !== actor.subject
            )
              throw fail("Automation not found", 404);
            if (
              !resolveSelection(catalog, profile).projects.some(
                (p) => p.id === target.projectId,
              )
            )
              throw fail("Automation is outside this selection", 403);
          }
          let data = await engine.act(actor, tool.operation, args);
          if (tool.operation === "history") {
            const ids = new Set(
              resolveSelection(catalog, profile).projects.map((p) => p.id),
            );
            const automations = data.automations.filter((a) =>
              ids.has(a.projectId),
            );
            const automationIds = new Set(automations.map((a) => a.id));
            const runs = data.runs.filter((r) =>
              automationIds.has(r.automationId),
            );
            const runIds = new Set(runs.map((r) => r.id));
            data = {
              automations,
              runs,
              audit: data.audit.filter(
                (a) => automationIds.has(a.recordId) || runIds.has(a.recordId),
              ),
            };
          }
          return send(200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(data) }],
              structuredContent: data,
            },
          });
        }
        const result = scopedMcpResult(
          message,
          { url: `/mcp?${params}` },
          catalog,
          { origin: ORIGIN },
        );
        if (message.method === "tools/list")
          result.result.tools = [
            ...result.result.tools,
            ...(sourceConnections?.list(actor, sourceProjects) ?? []),
            ...(taskSync?.list(actor, sourceProjects) ?? []),
            ...(workflowDevices?.list(actor, sourceProjects) ?? []),
            ...management.map(({ permission, operation, ...tool }) => tool),
          ];
        return send(200, result);
      }
      throw fail("Route or method not available", 404);
    } catch (error) {
      const status = error.statusCode ?? 503;
      const text =
        status >= 500 ? "Service temporarily unavailable" : error.message;
      return send(
        status,
        message
          ? {
              jsonrpc: "2.0",
              id: message.id ?? null,
              error: { code: error.jsonRpcCode ?? -32000, message: text, ...(error.deviceChallenge?{data:error.deviceChallenge}:{}) },
            }
          : { error: text, ...(error.deviceChallenge?{challenge:error.deviceChallenge}:{}) },
      );
    }
  };
}
