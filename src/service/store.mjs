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
  version: 1,
  profiles: {},
  rules: {},
  automations: {},
  runs: {},
  audit: [],
});
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
        state = JSON.parse(await readFile(this.path, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        state = emptyState();
      }
      const result = await fn(state);
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      const handle = await open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.path);
      return result;
    } finally {
      await lock.close();
      await unlink(`${this.path}.lock`);
    }
  }
}
export class PostgresStore {
  constructor(pool) {
    this.pool = pool;
  }
  async initialize() {
    await this.pool.query("CREATE SCHEMA IF NOT EXISTS mcp");
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS mcp.bittrees_mcp_state (id integer PRIMARY KEY CHECK (id=1), body jsonb NOT NULL)",
    );
    await this.pool.query(
      "INSERT INTO mcp.bittrees_mcp_state(id,body) VALUES(1,$1) ON CONFLICT DO NOTHING",
      [emptyState()],
    );
  }
  async assertReady() {
    const { rows } = await this.pool.query("SELECT body->>'version' AS version FROM mcp.bittrees_mcp_state WHERE id=1");
    if (rows[0]?.version !== "1") throw new Error("Database migration required");
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const { rows } = await client.query(
        "SELECT body FROM mcp.bittrees_mcp_state WHERE id=1 FOR UPDATE",
      );
      if (!rows.length) throw new Error("Store not initialized");
      const state = rows[0].body;
      const result = await fn(state);
      await client.query("UPDATE mcp.bittrees_mcp_state SET body=$1 WHERE id=1", [
        state,
      ]);
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
