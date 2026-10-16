import { readFileSync } from 'node:fs';
import { scopeError } from './catalog.mjs';
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
  for (const c of connections) {
    const u = new URL(c.endpoint);
    const managed = c.transport === 'managed-mcp' && c.endpoint === 'https://mcp.bittrees.org/mcp';
    if ((!managed && u.origin !== new URL(project.publicUrl).origin) || u.protocol !== 'https:' || u.search || u.hash || u.username || u.password)
      throw scopeError('Invalid reviewed tool endpoint');
  }
  return {
    projectId: project.id,
    reviewedAt: registry.reviewedAt,
    status: connections.length ? 'app-mcp-source-inspected' : 'operation-coverage-not-reviewed',
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
    projectId: project.id, operation, policy, routes,
    status: routes.length ? 'discover-app-tools-first' : 'coverage-gap',
    executionAllowed: false,
    nextAction: routes.length
      ? 'Use the existing scoped app credential for initialize and tools/list. Match current schemas and permissions before calling tools. If missing or denied, report the exact gap; do not grant access or silently use a browser.'
      : 'No reviewed route for this operation. Inspect or add a scoped app MCP/API adapter. Do not treat public catalog access as permission for this action.',
  };
}
