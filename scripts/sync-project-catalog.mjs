import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reconcileCatalog, atomicWriteJson } from "../src/ecosystem/sync.mjs";

const root = new URL("../", import.meta.url);
const previous = JSON.parse(
  await readFile(new URL("data/bittrees-projects.json", root), "utf8"),
);
const policy = JSON.parse(
  await readFile(new URL("data/catalog-sources.json", root), "utf8"),
);
const updates = {};
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "bittrees-catalog-reconciler",
};
if (process.env.GITHUB_TOKEN)
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
async function github(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000)
    throw new Error("Response exceeds catalog limit");
  return JSON.parse(text);
}
for (const source of policy.sources.filter((s) => s.enabled)) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
    source.manifestPath !== "bittrees.project.json" ||
    !/^[-\w./]+$/.test(source.branch)
  )
    throw new Error("Unapproved repository source configuration");
  try {
    const commit = await github(
      `repos/${source.repository}/commits/${encodeURIComponent(source.branch)}`,
    );
    if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error("Invalid revision");
    const file = await github(
      `repos/${source.repository}/contents/${source.manifestPath}?ref=${commit.sha}`,
    );
    if (file.encoding !== "base64" || file.size > 64_000)
      throw new Error("Invalid manifest encoding or size");
    const envelope = JSON.parse(
      Buffer.from(file.content, "base64").toString("utf8"),
    );
    if (
      envelope.schema !== "agent.bittrees.project.v1" ||
      envelope.version !== 1
    )
      throw new Error("Unsupported source schema");
    updates[source.id] = { project: envelope.project, revision: commit.sha };
  } catch {
    updates[source.id] = { error: "Source unavailable or invalid" };
  }
}
const result = reconcileCatalog(previous, policy.sources, updates);
await mkdir(new URL("output/catalog-sync/", root), { recursive: true });
await writeFile(
  new URL("output/catalog-sync/report.json", root),
  JSON.stringify(result.report, null, 2) + "\n",
);
if (!process.argv.includes("--check")) {
  // Preserve a rollback artifact and atomically replace only a validated full snapshot.
  await writeFile(
    new URL("output/catalog-sync/previous.json", root),
    JSON.stringify(previous, null, 2) + "\n",
  );
  if (result.report.state !== "failed")
    await atomicWriteJson(
      fileURLToPath(new URL("data/bittrees-projects.json", root)),
      result.catalog,
    );
  await atomicWriteJson(
    fileURLToPath(new URL("data/catalog-sync-status.json", root)),
    result.report,
  );
}
console.log(JSON.stringify(result.report));
if (result.report.state === "failed") process.exitCode = 1;
