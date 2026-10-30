// Gateway-owned registration. Independent of Workflows' public manifest and
// retained through source-manifest refreshes. Discovery never enables a worker.
export const WORKFLOW_DEVICE_CONNECTION={
 projectId:'workflow',transport:'managed-mcp',endpoint:'https://mcp.bittrees.org/mcp',
 verification:'gateway-adapter-source-inspected',
 source:'https://github.com/Bittrees-Technology/mcp/blob/main/src/service/workflow-devices.mjs',
 operations:{sync:['workflow_claim','workflow_renew'],complete:['workflow_complete']},
 boundary:'Local Bittrees AI text-generation queue only. Requires an existing scoped gateway credential, enrolled device-held proof, exact tenant/workspace/connection/workflow binding and current Roles action authority on every claim, renew and completion. Workflows independently verifies its current owner authority, approved source connection, workflow revision, lease and signed Roles decision. Until-revoked delegation remains revocable and requires explicit parent action/delegation authority. Durable operation IDs are retained for reconciliation; completion queues only the authorized next step. No registration, grant, scheduling, arbitrary tool execution, private history, reputation publication, wallet or Safe approval is provided. Discovery is not live enrollment or permission.'
};
