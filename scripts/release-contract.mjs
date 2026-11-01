// The release smoke selects Agent only; reject extra projects and wrong origins.
export function verifySelectedAgentResources(reply) {
 const expected=new Map([
  ['selected-tool-directory','https://mcp.bittrees.org/tool-catalog.json'],
  ['selected-catalog','https://mcp.bittrees.org/catalog.json'],
  ['agent','https://mcp.bittrees.org/v1/projects/agent'],
 ]);
 const resources=reply?.result?.resources;
 if(reply?.error || !Array.isArray(resources) || resources.length!==expected.size ||
    new Set(resources.map(r=>r.name)).size!==expected.size ||
    resources.some(r=>expected.get(r.name)!==r.uri || r.mimeType!=='application/json'))
  throw new Error('Scoped MCP verification failed');
}
