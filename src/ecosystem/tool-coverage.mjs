import { readFileSync } from 'node:fs';
import { scopeError } from './catalog.mjs';
import { WORKFLOW_DEVICE_CONNECTION } from './workflow-device-route.mjs';
const registry = JSON.parse(readFileSync(new URL('../../data/tool-coverage.json', import.meta.url), 'utf8'));
export const OPERATIONS = ['read', 'create', 'update', 'complete', 'research', 'sync', 'publish', 'prepare', 'delete'];
const policy = {
  preference: ['authenticated-app-mcp', 'documented-scoped-api', 'browser-only-when-required'],
  browserFallbackAutomatic: false,
  credentialsInToolArguments: false,
  discoveryGrantsAccess: false,
  instructions: 'Use the existing app connection and discover its tools first. A tool name in this coverage index is not proof of live availability or permission. Preserve source approvals, revisions and retry identities. Never switch to the browser to bypass denied access.',
};
export function coverageFor(project) {
  const connections = registry.connections.filter(c => c.projectId === project.id);
  if(project.id==='workflow'&&!connections.some(c=>c.transport==='managed-mcp'&&c.endpoint===WORKFLOW_DEVICE_CONNECTION.endpoint))connections.push(structuredClone(WORKFLOW_DEVICE_CONNECTION));
  for (const c of connections) {
    const u = new URL(c.endpoint);
    const managed = c.transport === 'managed-mcp' && c.endpoint === 'https://mcp.bittrees.org/mcp';
    if ((!managed && u.origin !== new URL(project.publicUrl).origin) || u.protocol !== 'https:' || u.search || u.hash || u.username || u.password)
      throw scopeError('Invalid reviewed tool endpoint');
  }
  return {
    projectId: project.id,
    reviewedAt: registry.reviewedAt,
    sync: registry.apps?.find(a=>a.projectId===project.id) ?? {state:"awaiting-first-sync"},
    status: connections.length ? 'app-mcp-source-inspected' : (registry.apps?.some(a=>a.projectId===project.id&&a.state==='synced') ? 'no-tools-declared' : 'operation-coverage-not-reviewed'),
    connections,
    publicContextTool: 'get_bittrees_project',
    gatewayExecutesAppTools: false,
    liveAvailability: 'not-checked',
    permission: 'check-with-app',
    gap: connections.length ? null : 'Only public project context is verified here. Inspect the source app for a scoped MCP or API contract before implementing a browser workflow.',
  };
}
export function toolCoverage(projects) {
  return { policy, projects: projects.map(coverageFor) };
}
export function planToolUse(project, operation) {
  if (!OPERATIONS.includes(operation)) throw scopeError('Unsupported operation');
  const coverage = coverageFor(project);
  const routes = coverage.connections.filter(c => c.operations[operation]?.length).map(c => ({
    transport: c.transport, endpoint: c.endpoint, tools: c.operations[operation],
    source: c.source, verification: c.verification, boundary: c.boundary, ...(c.setup ? {setup:c.setup} : {}),
  }));
  return {
    projectId: project.id, operation, policy, routes, sync:coverage.sync,
    status: routes.length ? 'discover-app-tools-first' : 'coverage-gap',
    executionAllowed: false,
    nextAction: routes.length
      ? 'Use the existing scoped app credential for initialize and tools/list. Match current schemas and permissions before calling tools. If missing or denied, report the exact gap; do not grant access or silently use a browser.'
      : 'No reviewed route for this operation. Inspect or add a scoped app MCP/API adapter. Do not treat public catalog access as permission for this action.',
  };
}

// A central directory, not a proxy that borrows downstream credentials.
export function functionCatalog(projects) {
  const coverage = toolCoverage(projects);
  const functions = [];
  for (const p of coverage.projects) {
    for (const c of p.connections) {
      const names = [...new Set(Object.values(c.operations).flat())];
      for (const name of names) functions.push({
        id: `${p.projectId}:${name}`, projectId: p.projectId, name,
        operations: Object.entries(c.operations).filter(([,names])=>names.includes(name)).map(([operation])=>operation),
        transport:c.transport, endpoint:c.endpoint, description:c.boundary,
        verification:c.verification, source:c.source, sync:p.sync,
        ...(c.setup ? {setup:c.setup} : {}),
        schemaDiscovery:{method:'tools/list',authority:c.transport==='managed-mcp'?'gateway':'source-app',requiresExistingConnection:true},
        execution:'source-authorized-connection-required',
      });
    }
  }
  return {
    schema:'bittrees.mcp.tool-directory.v1', canonicalDiscovery:'https://mcp.bittrees.org/mcp',
    policy:coverage.policy, reviewedAt:registry.reviewedAt,
    functions:functions.sort((a,b)=>a.id.localeCompare(b.id)),
    projects:projects.map(p=>({id:p.id,name:p.name,components:p.components??[],coverage:coverage.projects.find(c=>c.projectId===p.id).status,sync:coverage.projects.find(c=>c.projectId===p.id).sync})),
    gaps:coverage.projects.filter(p=>p.gap).map(p=>({projectId:p.projectId,reason:p.gap})),
  };
}
export function searchFunctions(projects, args={}) {
  if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200))throw scopeError('Query must be at most 200 characters');
  if(args.operation!==undefined&&!OPERATIONS.includes(args.operation))throw scopeError('Unsupported operation');
  const limit=args.limit??25,offset=args.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw scopeError('Invalid result page');
  const catalog=functionCatalog(projects), query=(args.query??'').toLowerCase().trim();
  const matches=catalog.functions.filter(f=>(!args.operation||f.operations.includes(args.operation))&&(!query||`${f.id} ${f.description} ${f.operations.join(' ')}`.toLowerCase().includes(query)));
  const score=f=>!query?0:f.name.toLowerCase()===query?4:f.name.toLowerCase().startsWith(query)?3:f.name.toLowerCase().includes(query)?2:1;
  matches.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  return {canonicalDiscovery:catalog.canonicalDiscovery,functions:matches.slice(offset,offset+limit),total:matches.length,nextOffset:offset+limit<matches.length?offset+limit:null,gaps:catalog.gaps};
}
export function getFunction(projects, id) {
  if(typeof id!=='string'||id.length>200)throw scopeError('Invalid function ID');
  const found=functionCatalog(projects).functions.find(f=>f.id===id);
  if(!found)throw scopeError('Function not available in this selection');
  return found;
}
