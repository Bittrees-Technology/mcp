import { createMcpHandler } from "./http.mjs";
import { Engine } from "./engine.mjs";
import { FileStore, PostgresStore } from "./store.mjs";
export async function runtime(env = process.env) {
  let store;
  if (env.MCP_DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: env.MCP_DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    store = new PostgresStore(pool);
    await store.initialize();
  } else if (env.NODE_ENV !== "production" && env.MCP_LOCAL_STATE) {
    store = new FileStore(env.MCP_LOCAL_STATE);
  } else
    store = {
      transaction: async () => {
        throw Object.assign(new Error("Dedicated database not configured"), {
          statusCode: 503,
        });
      },
    };
  const credentials = JSON.parse(env.MCP_CREDENTIALS_JSON ?? "[]");
  return createMcpHandler({
    engine: new Engine(store),
    credentials,
    workerToken: env.MCP_WORKER_TOKEN,
    release:
      env.VERCEL_GIT_COMMIT_SHA ?? env.MCP_RELEASE_COMMIT ?? "development",
  });
}
