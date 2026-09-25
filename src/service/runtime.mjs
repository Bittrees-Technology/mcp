import { AiWorker } from "./ai-worker.mjs";
import { CATALOG } from "../ecosystem/catalog.mjs";
import { AiClient } from "./ai-client.mjs";
import { AiSecrets } from "./ai-secrets.mjs";
import { AiConnections } from "./ai-connections.mjs";
import { createMcpHandler } from "./http.mjs";
import { Engine } from "./engine.mjs";
import { FileStore, PostgresStore } from "./store.mjs";
export async function runtime(env = process.env) {
  const aiConfigured = env.MCP_AI_CLIENT_CREDENTIAL !== undefined || env.MCP_AI_ENCRYPTION_KEY !== undefined;

  let store;
  if (env.MCP_DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: env.MCP_DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    store = new PostgresStore(pool, { allowLegacy: !aiConfigured });
    await store.assertReady();
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
  let aiConnections, aiWorker;
  if (aiConfigured) {
    const secrets = new AiSecrets(env.MCP_AI_ENCRYPTION_KEY);
    const client = new AiClient({
      clientCredential: env.MCP_AI_CLIENT_CREDENTIAL,
      resolveCredential: (intent) => {
        const credential = credentials.find((entry) => entry.tenant === intent.tenant && entry.subject === intent.subject);
        return aiConnections.credentialForDispatch(credential, intent);
      },
    });
    aiConnections = new AiConnections(store, { client, secrets });
    aiWorker = new AiWorker(store, { transport: client, catalog: CATALOG,
      resolveActor: (tenant, subject) => credentials.find((entry) => entry.tenant === tenant && entry.subject === subject),
    });
  }
  return createMcpHandler({
    aiConnections,
    engine: new Engine(store, { aiWorker }),
    credentials,
    workerToken: env.MCP_WORKER_TOKEN,
    release:
      env.VERCEL_GIT_COMMIT_SHA ?? env.MCP_RELEASE_COMMIT ?? "development",
  });
}
