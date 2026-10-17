// Keep the inventory and runtime on the same configured credential sources.
export function configuredCredentials(env = process.env) {
  return ['MCP_CREDENTIALS_JSON', 'MCP_SOURCE_ACTORS_JSON', 'MCP_QUALIFIED_ACTORS_JSON'].flatMap(name => {
    const rows = JSON.parse(env[name] ?? '[]');
    if (!Array.isArray(rows)) throw new Error('Invalid MCP service credential configuration');
    return rows;
  });
}
