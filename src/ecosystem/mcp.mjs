import {
  CATALOG,
  catalogView,
  selectionFromParams,
  requireSelectedProject,
  connectionUrl,
  scopeError,
} from "./catalog.mjs";
const LEGACY_ORIGIN = "https://mcp.bittrees.org";
export const ECOSYSTEM_TOOLS = [
  {
    name: "list_bittrees_projects",
    description:
      "List the approved public project contexts in this connection selection.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_bittrees_project",
    description:
      "Read selected project metadata and exact adapter readiness. Does not access private data.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "prepare_bittrees_project_handoff",
    description:
      "Prepare a local handoff description. Does not submit or mutate any project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, intent: { type: "string" } },
      required: ["projectId", "intent"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];
function resource(project, ORIGIN) {
  return {
    uri: `${ORIGIN}/v1/projects/${project.id}`,
    name: project.id,
    title: project.name,
    description: project.summary,
    mimeType: "application/json",
  };
}
const wrap = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
  isError: false,
});
export function scopedMcpResult(
  message,
  req,
  catalog = CATALOG,
  { origin = LEGACY_ORIGIN } = {},
) {
  const ORIGIN = origin;
  const params = new URL(req.url ?? "/mcp", ORIGIN).searchParams;
  // An explicit mode opts into the versioned ecosystem contract. Unparameterized
  // clients retain their previously documented contribution API during migration.
  if (
    !params.has("mode") &&
    !params.has("projects") &&
    !params.has("exclude") &&
    !params.has("profileVersion")
  )
    return undefined;
  const profile = selectionFromParams(params);
  const view = catalogView(catalog, profile);
  const result = (value) => ({ jsonrpc: "2.0", id: message.id, result: value });
  switch (message.method) {
    case "server/discover":
      return result({
        resultType: "complete",
        supportedVersions: ["2025-06-18"],
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        selection: view.selection,
        catalogRevision: view.revision,
        instructions:
          "Only selected public catalog resources are connected. Private reads and actions require future project adapters.",
        ttlMs: 0,
        cacheScope: "public",
      });
    case "initialize":
      return result({
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        serverInfo: { name: "bittrees-ecosystem-gateway", version: "2.0.0" },
        instructions: `This connection uses ${profile.mode} selection. Re-list resources to refresh the approved catalog. No downstream permissions are granted.`,
      });
    case "tools/list":
      return result({ tools: ECOSYSTEM_TOOLS });
    case "resources/list":
      return result({
        resources: [
          {
            uri: `${ORIGIN}/catalog.json`,
            name: "selected-catalog",
            mimeType: "application/json",
          },
          ...view.projects.map((p) => resource(p, ORIGIN)),
        ],
      });
    case "resources/read": {
      const uri = message.params?.uri;
      let url;
      try {
        url = new URL(uri);
      } catch {
        throw scopeError("Invalid resource URI");
      }
      if (
        url.origin !== ORIGIN ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw scopeError("Only canonical selected resource URIs are allowed");
      let data;
      if (url.pathname === "/catalog.json") data = view;
      else {
        const match = url.pathname.match(/^\/v1\/projects\/([a-z0-9-]+)$/);
        if (!match)
          throw scopeError("Resource not available in this selection");
        data = requireSelectedProject(catalog, profile, match[1]);
      }
      return result({
        contents: [
          { uri, mimeType: "application/json", text: JSON.stringify(data) },
        ],
      });
    }
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw scopeError("Invalid tool arguments");
      const tool = ECOSYSTEM_TOOLS.find((tool) => tool.name === name);
      if (!tool) throw scopeError("Tool not available in this selection");
      if (
        Object.keys(args).some(
          (key) => !Object.hasOwn(tool.inputSchema.properties, key),
        )
      )
        throw scopeError("Unsupported tool argument");
      if (name === "list_bittrees_projects") {
        if (args.query !== undefined && typeof args.query !== "string")
          throw scopeError("Invalid query");
        const projects = view.projects.filter(
          (p) =>
            !args.query ||
            `${p.id} ${p.name} ${p.summary}`
              .toLowerCase()
              .includes(args.query.toLowerCase()),
        );
        return result(wrap({ ...view, projects, count: projects.length }));
      }
      const project = requireSelectedProject(catalog, profile, args.projectId);
      if (name === "get_bittrees_project")
        return result(wrap({ project, catalogRevision: view.revision }));
      if (
        typeof args.intent !== "string" ||
        !args.intent.trim() ||
        args.intent.length > 2000
      )
        throw scopeError("A bounded handoff intent is required");
      return result(
        wrap({
          status: "prepared-only",
          projectId: project.id,
          intent: args.intent,
          connection: connectionUrl(profile),
          mutationAllowed: false,
          nextAction:
            "Ask the project owner to review the handoff; no request has been sent.",
        }),
      );
    }
    case "ping":
      return result({});
    default:
      throw Object.assign(
        scopeError("Method not available in scoped gateway"),
        { jsonRpcCode: -32601 },
      );
  }
}
