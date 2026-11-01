// Descriptive setup only. These flags never grant authority or execute a source tool.
export function publicReadConnection(connection) {
 return connection.setup?.authentication==='none' &&
  connection.operations && !Array.isArray(connection.operations) &&
  Object.keys(connection.operations).length>0 &&
  Object.keys(connection.operations).every(operation=>operation==='read');
}
export function localAdapter(connection) {
 return ['local-mcp-adapter','local-mcp'].includes(connection.transport);
}
export function connectionRequirements(connection) {
 const publicRead=Boolean(publicReadConnection(connection));
 return {
  authentication:publicRead?'none':'source-authorization-required',
  schemaDiscovery:{method:'tools/list',authority:localAdapter(connection)?'local-adapter':connection.transport==='managed-mcp'?'gateway':'source-app',requiresExistingConnection:true,requiresCredentials:!publicRead},
  execution:publicRead?'public-read-only-source-connection':'source-authorized-connection-required',
 };
}
export function connectionInstructions(connections) {
 if(connections.length && connections.every(publicReadConnection)) {
  return connections.every(localAdapter)
   ? 'Run the reviewed local adapter and request initialize and tools/list there. Its HTTPS endpoint identifies the public data source, not a remote MCP server. No source credential is required; the source read limits and cost conditions still apply.'
   : 'Connect to the public read-only source and request initialize and tools/list for current schemas. No bearer credential or sign-in is required. This provides no private access or write authority; source read limits and cost conditions still apply.';
 }
 return 'Use the existing scoped app credential for initialize and tools/list. Match current schemas and permissions before calling tools. If missing or denied, report the exact gap; do not grant access or silently use a browser.';
}
