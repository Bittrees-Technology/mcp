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
  renderCatalogStatus,
} from "../ecosystem/ui.mjs";
import { fail, authorize } from "./engine.mjs";
const ORIGIN = "https://mcp.bittrees.org";
const MANAGEMENT_TOOLS = [
  {
    name: "automation_history",
    description:
      "Read only your automation definitions, rules and execution history.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    permission: "automation:read",
    operation: "history",
  },
  ...["trigger", "pause", "resume", "cancel"].map((action) => ({
    name: `automation_${action}`,
    description: `${action} an existing automation within this project selection. Configuration is prepared separately; sensitive adapters are unavailable.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ...(action === "trigger"
          ? { idempotencyKey: { type: "string" }, event: { type: "string" } }
          : {}),
      },
      required: action === "trigger" ? ["id", "idempotencyKey"] : ["id"],
      additionalProperties: false,
    },
    permission: "automation:write",
    operation: action === "trigger" ? "enqueue" : action,
  })),
];
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
      !Number.isFinite(actor.expiresAt) ||
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
  if (!actor || actor.expiresAt <= Date.now())
    throw fail("Invalid or expired service credential", 401);
  return actor;
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
  catalog = CATALOG,
  release = "development",
} = {}) {
  validateCredentials(credentials);
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
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
      if (path === "/internal/tick") {
        if (req.method !== "POST") throw fail("Method not allowed", 405);
        if (
          !workerToken ||
          hash(req.headers.authorization ?? "") !==
            hash(`Bearer ${workerToken}`)
        )
          throw fail("Worker authentication required", 401);
        return send(200, await engine.tick(resolveActor));
      }
      const actor = authenticate(req.headers, credentials);
      if (path === "/health" && ["GET", "HEAD"].includes(req.method)) {
        await engine.store.transaction(() => null);
        return send(200, {
          service: "bittrees-mcp",
          release,
          storage: "ready",
          catalogRevision: catalogRevision(catalog),
          adapter: "public-catalog-context",
          sensitiveActions: "not-implemented",
        });
      }
      if (path === "/mcp-docs" && ["GET", "HEAD"].includes(req.method)) return send(200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your client</title><style>body{font:18px/1.6 system-ui;max-width:900px;margin:auto;padding:28px;background:#f4f7f0;color:#19392b}a{color:#245e42}code{overflow-wrap:anywhere}</style></head><body><main><h1>Connect your client</h1><p>This service is in preview. Keep existing clients on their current endpoint until production activation is verified.</p><ol><li><a href="/connect">Choose your project selection</a> and download the connection configuration.</li><li>Add the URL in your agent client's remote MCP server settings. Use Streamable HTTP with JSON responses.</li><li>Run <code>list_bittrees_projects</code> to inspect your selection, then <code>get_bittrees_project</code> to read public project context.</li></ol><h2>Saved profiles and automation</h2><p>A service operator provisions a separate scoped credential. Send it in an Authorization bearer header, never a URL. Saved profile URLs reject selection overrides. New automations start paused; an authorized agent can inspect history and trigger, pause, resume or cancel them. Public catalog membership grants no execution permission.</p><p><a href="https://github.com/Bittrees-Technology/mcp/blob/main/README.md">Configuration and automation API guide</a> · <a href="/status">Service status</a> · <a href="https://agent.bittrees.org">Agent onboarding</a></p></main></body></html>`, "text/html");
      if (
        ["GET", "HEAD"].includes(req.method) &&
        ["/", "/connect", "/status"].includes(path)
      )
        return send(
          200,
          path === "/status"
            ? renderCatalogStatus(catalog)
            : renderConnectionPage(url.searchParams, catalog),
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
      if (path === "/v1/history" && req.method === "GET")
        return send(200, await engine.act(actor, "history"));
      if (req.method === "POST" && path.startsWith("/v1/")) {
        const operations = {
          "/v1/profiles": "profile.create",
          "/v1/profiles/update": "profile.update",
          "/v1/rules": "rule.create",
          "/v1/rules/update": "rule.update",
          "/v1/automations": "automation.create",
          "/v1/automations/pause": "pause",
          "/v1/automations/resume": "resume",
          "/v1/automations/cancel": "cancel",
          "/v1/automations/trigger": "enqueue",
        };
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
        ["/catalog.json", "/connection.json", "/projects"].includes(path)
      ) {
        const body =
          path === "/connection.json"
            ? clientConfiguration(profile)
            : catalogView(catalog, profile);
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
            return send(202, {});
          throw fail("Unsupported notification");
        }
        const management = MANAGEMENT_TOOLS.filter((tool) =>
          actor?.permissions.includes(tool.permission),
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
          if (tool.operation !== "history") {
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
              error: { code: error.jsonRpcCode ?? -32000, message: text },
            }
          : { error: text },
      );
    }
  };
}
