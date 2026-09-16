import { writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { validateCatalog, catalogRevision } from "./catalog.mjs";

const SAFE_FIELDS = ["name", "summary", "lifecycle"];
export function reconcileCatalog(
  previous,
  sources,
  updates,
  now = new Date().toISOString(),
) {
  validateCatalog(previous);
  const next = structuredClone(previous);
  const changes = [];
  const errors = [];
  const ids = new Set();
  for (const source of sources.filter((s) => s.enabled)) {
    if (ids.has(source.id)) {
      errors.push({ id: source.id, error: "Duplicate approved source" });
      continue;
    }
    ids.add(source.id);
    const update = updates[source.id];
    if (!update?.project) {
      errors.push({
        id: source.id,
        error: "Approved manifest unavailable; previous data retained",
      });
      continue;
    }
    const index = next.projects.findIndex((p) => p.id === source.id);
    const base = index >= 0 ? next.projects[index] : source.approvedTemplate;
    const incoming = update.project;
    if (
      !base ||
      incoming.id !== source.id ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(base.repositoryUrl ?? "") ||
      base.repositoryUrl !== `https://github.com/${source.repository}`
    ) {
      errors.push({ id: source.id, error: "Source identity requires review" });
      continue;
    }
    const fixed = Object.keys(base).filter(
      (key) => !SAFE_FIELDS.includes(key) && key !== "source",
    );
    if (
      Object.keys(incoming).some((key) => !Object.hasOwn(base, key)) ||
      fixed.some(
        (key) => JSON.stringify(incoming[key]) !== JSON.stringify(base[key]),
      )
    ) {
      errors.push({
        id: source.id,
        error:
          "Origin, affiliation, ownership, aliases, or capability change requires review",
      });
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(update.revision ?? "")) {
      errors.push({
        id: source.id,
        error: "Immutable source revision missing",
      });
      continue;
    }
    const candidate = {
      ...base,
      ...Object.fromEntries(SAFE_FIELDS.map((key) => [key, incoming[key]])),
      source: { ...base.source, revision: update.revision, observedAt: now },
    };
    if (index >= 0) next.projects[index] = candidate;
    else next.projects.push(candidate);
    if (
      JSON.stringify({ ...base, source: null }) !==
        JSON.stringify({ ...candidate, source: null }) ||
      base.source.revision !== update.revision
    )
      changes.push({
        id: source.id,
        revision: update.revision,
        change:
          index < 0
            ? "added"
            : candidate.lifecycle === "removed"
              ? "removed"
              : "updated",
      });
  }
  if (!errors.length)
    try {
      validateCatalog(next);
    } catch {
      errors.push({
        id: "catalog",
        error: "Schema or deduplication validation failed",
      });
    }
  if (errors.length)
    return {
      catalog: previous,
      report: {
        state: "failed",
        lastAttemptAt: now,
        lastSuccessAt: previous.sync?.lastSuccessAt ?? null,
        errors,
        changes: [],
        retainedRevision: catalogRevision(previous),
      },
    };
  const enabled = sources.some((s) => s.enabled);
  next.sync = {
    state: enabled ? "reconciled" : "prepared",
    lastAttemptAt: now,
    lastSuccessAt: enabled ? now : null,
    errors: [],
  };
  return {
    catalog: next,
    report: { ...next.sync, changes, revision: catalogRevision(next) },
  };
}
export async function atomicWriteJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, path);
}
