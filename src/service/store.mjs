import {
  mkdir,
  readFile,
  rename,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
export const emptyState = () => ({
  version: 2,
  aiDispatchVersion: 1,
  aiConnections: {},
  aiDispatchOutbox: {},
  profiles: {},
  rules: {},
  automations: {},
  runs: {},
  audit: [],
});
function assertFormat(state, allowLegacy = false) {
  if (allowLegacy && state?.version === 1 && state.profiles && state.rules && state.automations && state.runs && Array.isArray(state.audit)) return;
  if (state?.version !== 2 || state.aiDispatchVersion !== 1 ||
      !state.aiConnections || !state.aiDispatchOutbox) throw new Error("Store migration required");
}
// Local development uses a durable snapshot with an exclusive, fail-fast lock.
// Production uses PostgreSQL: no ephemeral/serverless filesystem fallback.
export class FileStore {
  constructor(path) {
    this.path = path;
  }
  async transaction(fn) {
    await mkdir(dirname(this.path), { recursive: true });
    let lock;
    try {
      lock = await open(`${this.path}.lock`, "wx", 0o600);
    } catch {
      throw Object.assign(new Error("Store busy; retry later"), {
        statusCode: 503,
      });
    }
    try {
      let state;
      try {
        const marker = JSON.parse(await readFile(this.path, "utf8"));
        if (marker.version !== 2 || marker.storage !== "separate-v2") throw new Error("Local store migration required");
        try { state = JSON.parse(await readFile(`${this.path}.v2`, "utf8")); }
        catch { throw new Error("Versioned local state is missing or unreadable"); }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        try { await readFile(`${this.path}.v2`); throw new Error("Local store migration marker missing"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        state = emptyState();
      }
      assertFormat(state);
      const result = await fn(state);
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      const handle = await open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      assertFormat(state);
      await rename(temp, `${this.path}.v2`);
      // The original path is a tombstone without mutable automation maps. Old
      // engines fail instead of rewriting the independently stored v2 records.
      await writeFile(temp, JSON.stringify({ version: 2, storage: "separate-v2" }), { mode: 0o600 });
      await rename(temp, this.path);
      return result;
    } finally {
      await lock.close();
      await unlink(`${this.path}.lock`);
    }
  }
}
/** Explicit local development upgrade. Retains a read-only-format original
 * snapshot for operator recovery; never automatically restores it over v2. */
export async function migrateFileStore(path) {
  await mkdir(dirname(path), { recursive: true });
  const lock = await open(`${path}.lock`, "wx", 0o600);
  try {
    const original = await readFile(path, "utf8"), old = JSON.parse(original);
    if (old.version === 2 && old.storage === "separate-v2") {
      assertFormat(JSON.parse(await readFile(`${path}.v2`, "utf8")));
      return;
    }
    if (old.version !== 1 || !old.profiles || !old.rules || !old.automations || !old.runs || !Array.isArray(old.audit))
      throw new Error("Unsupported local store format");
    await writeFile(`${path}.pre-v2`, original, { mode: 0o600, flag: "wx" });
    const upgraded = { ...old, version: 2, aiDispatchVersion: 1, aiConnections: {}, aiDispatchOutbox: {} };
    const handle = await open(`${path}.v2`, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(upgraded)); await handle.sync(); }
    finally { await handle.close(); }
    const marker = `${path}.migration.tmp`;
    await writeFile(marker, JSON.stringify({ version: 2, storage: "separate-v2" }), { mode: 0o600 });
    await rename(marker, path);
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
export class PostgresStore {
  constructor(pool, { allowLegacy = false } = {}) {
    this.pool = pool;
    this.allowLegacy = allowLegacy;
  }
  async initialize() {
    // Test/operator helper only; runtime calls assertReady with its restricted role.
    await this.pool.query(await readFile(new URL("../../migrations/001_state.sql", import.meta.url), "utf8"));
    await this.pool.query(await readFile(new URL("../../migrations/002_ai_dispatch.sql", import.meta.url), "utf8"));
  }
  async assertReady() {
    const { rows } = await this.pool.query("SELECT body->>'version' AS version FROM mcp.bittrees_mcp_state WHERE id=1");
    if (rows[0]?.version !== "2" && !(this.allowLegacy && rows[0]?.version === "1")) throw new Error("Database migration required");
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL bittrees.mcp_writer_version = '2'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const { rows } = await client.query(
        "SELECT body FROM mcp.bittrees_mcp_state WHERE id=1 FOR UPDATE",
      );
      if (!rows.length) throw new Error("Store not initialized");
      const state = rows[0].body;
      assertFormat(state, this.allowLegacy);
      const before = JSON.stringify(state);
      const result = await fn(state);
      assertFormat(state, this.allowLegacy);
      if (JSON.stringify(state) !== before) {
        await client.query("UPDATE mcp.bittrees_mcp_state SET body=$1 WHERE id=1", [state]);
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
