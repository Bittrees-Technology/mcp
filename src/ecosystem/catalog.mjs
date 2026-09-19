import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const PRIMARY_TRANSPORT = "https://mcp.bittrees.org/mcp";
export const MANIFEST_SCHEMA = "agent.bittrees.project-registry.v2";
export const PROFILE_SCHEMA = "agent.bittrees.selection.v1";
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const excludedIds = new Set(JSON.parse(readFileSync(new URL("../../data/excluded-projects.json", import.meta.url), "utf8")).ids);
const modes = ["selected", "bittrees", "ecosystem"];
export function scopeError(message) {
  return Object.assign(new Error(message), {
    jsonRpcCode: -32602,
    statusCode: 400,
  });
}
export function validateCatalog(catalog) {
  if (
    catalog?.schema !== MANIFEST_SCHEMA ||
    catalog.version !== 2 ||
    !Array.isArray(catalog.projects) ||
    catalog.projects.length > 300
  )
    throw scopeError("Unsupported catalog schema or size");
  const names = new Set();
  const repositories = new Set();
  for (const p of catalog.projects) {
    if ([p.id, ...(p.aliases ?? [])].some(id => excludedIds.has(id)))
      throw scopeError("Project excluded from publication pending owner reapproval");
    if (
      !ID.test(p.id) ||
      typeof p.name !== "string" ||
      typeof p.summary !== "string" ||
      !Array.isArray(p.aliases)
    )
      throw scopeError("Invalid project identity");
    for (const id of [p.id, ...p.aliases]) {
      if (!ID.test(id) || names.has(id))
        throw scopeError(`Duplicate or invalid project alias: ${id}`);
      names.add(id);
    }
    if (
      !["bittrees", "related", "pending"].includes(p.affiliation) ||
      !["approved", "pending"].includes(p.approval)
    )
      throw scopeError("Invalid affiliation review");
    if (p.approval === "approved" && p.affiliation === "pending")
      throw scopeError("Pending affiliation cannot be approved");
    if (
      !Array.isArray(p.affiliationEvidence) ||
      !p.affiliationEvidence.length ||
      !p.owner ||
      !p.source
    )
      throw scopeError("Project provenance is required");
    if (
      !["planned", "preview", "active", "deprecated", "removed"].includes(
        p.lifecycle,
      )
    )
      throw scopeError("Invalid lifecycle");
    if (!["unverified", "reachable", "unavailable"].includes(p.health?.status))
      throw scopeError("Invalid health state");
    if (p.source.revision !== null && !/^[0-9a-f]{40}$/.test(p.source.revision))
      throw scopeError("Invalid source revision");
    if (!Number.isFinite(Date.parse(p.source.observedAt)))
      throw scopeError("Invalid source observation time");
    for (const [field, url] of Object.entries({
      repositoryUrl: p.repositoryUrl,
      publicUrl: p.publicUrl,
    })) {
      if (url === null) continue;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw scopeError(`Invalid ${field}`);
      }
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        parsed.search
      )
        throw scopeError(`Unsafe ${field}`);
      if (field === "repositoryUrl") {
        if (
          parsed.hostname !== "github.com" ||
          !/^\/[^/]+\/[^/]+$/.test(parsed.pathname)
        )
          throw scopeError("Invalid canonical repository");
        if (repositories.has(url.toLowerCase()))
          throw scopeError("Duplicate canonical repository");
        repositories.add(url.toLowerCase());
      }
    }
    if (
      !Array.isArray(p.capabilities) ||
      !Array.isArray(p.authScopes) ||
      !p.adapter
    )
      throw scopeError("Adapter contract is required");
    // This release implements only public metadata adapters. Future auth/action
    // additions need implementation and review, never a manifest-only toggle.
    if (
      p.adapter.type !== "catalog-resource" ||
      p.adapter.privateReads !== "not-implemented" ||
      p.adapter.actions !== "not-implemented" ||
      p.authScopes.length
    )
      throw scopeError("Unimplemented adapter or elevated scope");
    for (const c of p.capabilities) {
      if (
        c.id !== "project.context" ||
        c.kind !== "resource" ||
        c.scope !== "public:catalog" ||
        !["ready", "pending"].includes(c.status)
      )
        throw scopeError("Unimplemented capability");
    }
  }
  return catalog;
}
export function catalogRevision(catalog) {
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}
export const CATALOG = validateCatalog(
  JSON.parse(
    readFileSync(
      new URL("../../data/bittrees-projects.json", import.meta.url),
      "utf8",
    ),
  ),
);
export function validateSelection(profile) {
  if (
    profile?.schema !== PROFILE_SCHEMA ||
    profile.version !== 1 ||
    !modes.includes(profile.mode)
  )
    throw scopeError("Unsupported selection profile");
  if (!Number.isSafeInteger(profile.revision) || profile.revision < 1)
    throw scopeError("Invalid profile revision");
  for (const key of ["selectedIds", "excludedIds"]) {
    if (
      !Array.isArray(profile[key]) ||
      profile[key].length > 300 ||
      profile[key].some((id) => typeof id !== "string" || !ID.test(id)) ||
      new Set(profile[key]).size !== profile[key].length
    )
      throw scopeError(`Invalid ${key}`);
  }
  if (profile.mode !== "selected" && profile.selectedIds.length)
    throw scopeError("Only selected mode accepts pinned IDs");
  return {
    schema: PROFILE_SCHEMA,
    version: 1,
    revision: profile.revision,
    mode: profile.mode,
    selectedIds: [...profile.selectedIds],
    excludedIds: [...profile.excludedIds],
  };
}
export function selectionFromParams(
  params = new URLSearchParams(),
  defaultMode = "ecosystem",
) {
  for (const key of [
    "mode",
    "projects",
    "exclude",
    "profileVersion",
    "profileRevision",
  ])
    if (params.getAll(key).length > 1)
      throw scopeError(`Duplicate selection field: ${key}`);
  const split = (key) => (params.get(key) ? params.get(key).split(",") : []);
  return validateSelection({
    schema: PROFILE_SCHEMA,
    version: Number(params.get("profileVersion") ?? 1),
    revision: Number(params.get("profileRevision") ?? 1),
    mode: params.get("mode") ?? defaultMode,
    selectedIds: split("projects"),
    excludedIds: split("exclude"),
  });
}
export function eligible(p) {
  return (
    p.approval === "approved" &&
    p.affiliation !== "pending" &&
    !["deprecated", "removed"].includes(p.lifecycle)
  );
}
export function resolveSelection(catalog, input) {
  const profile = validateSelection(input);
  const byId = new Map(catalog.projects.map((p) => [p.id, p]));
  const projects = catalog.projects.filter(
    (p) =>
      eligible(p) &&
      !profile.excludedIds.includes(p.id) &&
      (profile.mode === "selected"
        ? profile.selectedIds.includes(p.id)
        : profile.mode === "bittrees"
          ? p.affiliation === "bittrees"
          : true),
  );
  const unavailable = profile.selectedIds
    .filter((id) => !projects.some((p) => p.id === id))
    .map((id) => ({
      id,
      reason: profile.excludedIds.includes(id)
        ? "excluded"
        : !byId.has(id)
          ? "removed-or-unknown"
          : `ineligible:${byId.get(id).approval}:${byId.get(id).lifecycle}`,
    }));
  return {
    profile,
    catalogRevision: catalogRevision(catalog),
    projects,
    unavailable,
    excludedIds: profile.excludedIds,
  };
}
export function requireSelectedProject(catalog, profile, id) {
  const project = resolveSelection(catalog, profile).projects.find(
    (p) => p.id === id,
  );
  if (!project) throw scopeError("Project is not available in this selection");
  return project;
}
export function projectState(p, now = Date.now()) {
  const observed = Date.parse(p.source.observedAt);
  return {
    listed: true,
    reachable:
      p.health.status === "reachable" &&
      now - Date.parse(p.health.checkedAt) < 300_000,
    mcpReady: eligible(p) && p.adapter.status === "ready",
    actionReady: false,
    freshness: now - observed > 7 * 86_400_000 ? "stale" : "snapshot",
    lastObservedAt: p.source.observedAt,
    note: "MCP-ready means public catalog context only; no private product API is connected.",
  };
}
export function catalogView(catalog, profile, { includePending = false } = {}) {
  const selected = resolveSelection(catalog, profile);
  return {
    schema: MANIFEST_SCHEMA,
    version: 2,
    revision: selected.catalogRevision,
    selection: selected.profile,
    projects: selected.projects.map((p) => ({
      ...p,
      readiness: projectState(p),
    })),
    unavailable: selected.unavailable,
    ...(includePending
      ? {
          pending: catalog.projects
            .filter((p) => !eligible(p))
            .map((p) => ({ ...p, readiness: projectState(p) })),
        }
      : {}),
    sync: catalog.sync,
    authority:
      "Selection provides catalog visibility only; no downstream permissions are granted.",
  };
}
export function connectionUrl(profile) {
  const p = validateSelection(profile);
  const url = new URL(PRIMARY_TRANSPORT);
  url.searchParams.set("mode", p.mode);
  url.searchParams.set("profileVersion", "1");
  url.searchParams.set("profileRevision", String(p.revision));
  if (p.selectedIds.length)
    url.searchParams.set("projects", p.selectedIds.join(","));
  if (p.excludedIds.length)
    url.searchParams.set("exclude", p.excludedIds.join(","));
  return url.href;
}
export function clientConfiguration(profile) {
  return { mcpServers: { bittrees: { url: connectionUrl(profile) } } };
}
