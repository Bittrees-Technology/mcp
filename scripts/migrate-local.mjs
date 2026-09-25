import { migrateFileStore } from "../src/service/store.mjs";
if (process.env.NODE_ENV === "production" || !process.env.MCP_LOCAL_STATE)
  throw new Error("Explicit local development state path required");
await migrateFileStore(process.env.MCP_LOCAL_STATE);
console.log("Local MCP state upgraded; previous snapshot retained for operator recovery");
