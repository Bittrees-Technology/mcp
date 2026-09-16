# Standalone Bittrees MCP service

Independent deployment for **mcp.bittrees.org**. Agent is the person/agent funnel;
this service owns catalog selection, saved profiles, MCP, automation and rules.
This is the independent `Bittrees-Technology/mcp` repository. Run `npm ci`,
`npm test` and `npm run build` at its root. Vercel project `bittrees-mcp` deploys
this repository directly using its own configuration and secrets. Agent remains a
separate repository and deployment. Extraction provenance is in
[docs/EXTRACTION.md](docs/EXTRACTION.md). No Node consumer is implemented.

## Supported slice

Public MCP tools list/read approved project context and prepare a handoff without
sending it. Resources and tools enforce selected/bittrees/ecosystem profiles.
They do not call private product APIs. Authenticated callers additionally have
scoped automation history and trigger/pause/resume/cancel tools. Configuration is
through the authenticated JSON API below. Catalog metadata cannot enable an adapter.

Automations currently execute only `get_bittrees_project`, producing a durable
snapshot of public project context. All private reads, messages, signatures,
spending, permission grants and other downstream mutations are unimplemented.
New definitions are **paused**; an authorized explicit resume is required.

## Configuration and authority

- `MCP_DATABASE_URL`: dedicated PostgreSQL connection with a dedicated database/user.
  Use provider-verified TLS and rotate independently of Agent. Migrations create
  `mcp.bittrees_mcp_state`; runtime has SELECT/UPDATE only and no filesystem fallback.
- `MCP_CREDENTIALS_JSON`: array of server-provisioned service identities. Each has
  `tokenHash` (SHA-256 of a random bearer secret), `tenant`, `subject`,
  `audience: "https://mcp.bittrees.org"`, `expiresAt` (epoch milliseconds),
  `projectIds`, and `permissions`. One active identity per tenant/subject.
  Provision secrets through the approved secret store; never catalogs or URLs.
- Permissions: `catalog:read`, `profile:read`, `profile:write`, `rule:write`,
  `automation:read`, `automation:write`, `automation:execute`. Grant only needed
  permissions and explicit project IDs. No wildcard projects are supported.
- `MCP_WORKER_TOKEN`: separate high-entropy worker credential for `/internal/tick`.
  It cannot configure rules or call profile APIs. Do not reuse client tokens.
- `MCP_RELEASE_COMMIT`: immutable deployed source revision (deployment workflow).
- Development only: `MCP_LOCAL_STATE=/absolute/path/state.json`, with
  `NODE_ENV` other than production. Exclusive fail-fast locking prevents concurrent
  writes; a crashed local writer's stale lock requires an operator check/removal.

Absent a database, public context reads and connection pages work, but `/health`
returns 503 and all durable operations fail closed. This is a preview state, not
production automation readiness. Missing credentials grant no management authority.
Credential revocation uses an independent secret update/redeployment; expiry and
current rule/profile changes are checked on every execution. Never reuse Agent
bearers: separate allowlists and exact audience enforce the service boundary.

## API and example sequence

All writes use POST, JSON and Authorization: Bearer (except internal worker token).
Responses and history are owner-and-tenant scoped; other owners get 404. Public
MCP requests need no token; a supplied invalid/expired token fails with 401.

1. `/v1/profiles`: `{ "selection": { "schema":"agent.bittrees.selection.v1",
   "version":1,"revision":1,"mode":"selected","selectedIds":["agent"],
   "excludedIds":[] } }`. Save its generated ID. Connect using
   `https://mcp.bittrees.org/profiles/PROFILE_ID/mcp` and the separate bearer header.
   Stored profiles reject URL overrides. `/v1/profiles/update` takes `id`,
   `selection`, `expectedRevision` and rejects conflicting edits.
2. `/v1/rules`: `{ "projectIds":["agent"],"tools":["get_bittrees_project"],
   "enabled":true }`. `/v1/rules/update` adds `id` and `expectedVersion`.
   Versions append, never overwrite. Latest version is evaluated per attempt.
3. `/v1/automations`: `{ "profileId":"…","ruleId":"…","projectId":"agent",
   "tool":"get_bittrees_project","trigger":{"type":"manual"} }`.
   Other triggers: `{ "type":"schedule","intervalSeconds":3600 }` or
   `{ "type":"event","event":"reviewed-update" }`.
4. `/v1/automations/resume`: `{ "id":"…" }`. Also pause/cancel. Cancel is terminal;
   queued/retrying runs are cancelled. Paused work stays durable and does not run.
5. `/v1/automations/trigger`: `{ "id":"…","idempotencyKey":"unique-source-event",
   "event":"reviewed-update" }` (event only for event-trigger definitions).
   Caller is authenticated; arbitrary public webhooks and event-supplied URLs are
   not accepted. Duplicate keys return the same run, including after a restart.
6. An approved worker POSTs `/internal/tick`. `/v1/history` (GET) returns the
   caller's definitions, immutable rule versions, attempts and audit decisions.

The MCP `automation_trigger`, `automation_pause`, `automation_resume`,
`automation_cancel`, and `automation_history` tools use the same authority checks
and further restrict results/actions to the current connection project selection.
A management permission cannot bypass execution permission, profile or rule.

## Durability and worker behavior

PostgreSQL row locks serialize a bounded transaction containing queue selection,
public-context execution, history and audit. Two workers cannot execute the same
run concurrently. Each tick queues and attempts at most 20 items. The pure adapter
has a 5-second deadline, at most 3 attempts, and 1s/2s retry backoff. Only explicit
transient adapter failures retry. Denial is terminal, with a bounded generic reason
instead of provider errors or secrets. Rule/profile revision is recorded per attempt.

Scheduled missed intervals coalesce into one run. Resume starts a new schedule
interval. The prepared GitHub worker runs every five minutes when
`MCP_WORKER_ENABLED=true`; schedules are best effort at that cadence, not a
real-time guarantee. Worker outage leaves durable work for later ticks. The worker
never enables an automation. Ten thousand runs/audit entries are a deliberate
capacity cap; fail closed until reviewed backup/archival, rather than discard
history. Single-row serialization is an initial modest-volume implementation.
Do not plug side-effect adapters into this transaction: those need an outbox,
remote idempotency and separate authority review first.

## Release, migration and rollback

Run `npm ci`, `npm test`, `npm run check` and `npm run build`. Set `MCP_TEST_DATABASE_URL` to an isolated test
database for PostgreSQL tests; CI creates PostgreSQL 16 automatically.

Use the `mcp-production` GitHub environment and a distinct Vercel project. The
release workflow validates a READY production target, project ID, exact source SHA, clean
metadata, database health and scoped MCP behavior before assigning mcp.bittrees.org.
Create the immutable production candidate with `vercel deploy --prod --skip-domain` after provisioning its separate environment, then run the release workflow. The initial alias bootstrap is supported; rollback runs the same checks on a
retained compatible deployment. Back up PostgreSQL before schema changes. This
version only creates its own table; never restore a snapshot over newer runs
without explicit reconciliation. Keep schema compatible across retained builds.

Existing `agent.bittrees.org/mcp` continues to serve its legacy contribution API
and existing write gates; explicit scoped legacy requests remain a local read-only
compatibility adapter. There is **no cross-origin POST redirect or token forwarding**.
Migrate public clients by explicitly replacing the URL with the verified new MCP
URL; provision separate service credentials for management. Contribution writes
remain on Agent until an independently reviewed adapter exists. GET /connect on
Agent hands off to the standalone connection page without secrets or query tokens.

Before production activation verify dedicated database backup/restore, credential
provisioning/expiry/revocation, preview identity, real scheduled/event runs, domain,
health, and browser/keyboard acceptance. Catalog synchronization is prepared with
disabled initial sources; it is not claimed active until source and deployment
propagation evidence are recorded. Node work is deferred; its future default is
ecosystem with saved user overrides.

## Standalone site and operations

The service owns `/`, `/projects`, `/connect`, `/automations`, `/rules` and `/status`. The credential-protected workspace uses same-origin APIs and keeps tokens in page memory only. See [production operations](docs/production-operations.md) for isolated credentials, backups, restore drills, release verification and known limits.
