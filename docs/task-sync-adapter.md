# Agent backlog → CRM task adapter

This gateway adapter is implemented but **unconfigured in production**. It uses CRM PR39's dedicated ordinary-backlog capability, not the AI task or lead tools. Source migration/deployment, explicit project mapping and an enrolled actor remain activation prerequisites. No configuration/grants are created by deploying this code.

## Endpoints and scopes

The source is fixed to `https://agent.bittrees.org/tasks.json`; the only CRM destination is `https://crm.bittrees.org/api/integrations/datasets/mcp`. Call `task_sync_preview` and `task_sync_execute` through `/mcp`; tools are advertised only for a matching configured actor with a Roles binding and the required transport permissions. Select CRM **and** the source project(s). Both must be in the credential's project list.

`task_sync_preview` requires `task-sync:read`, fetches and validates the public feed, then reads `projects.list` under a fresh Roles decision. It accepts no arguments. The CRM owner must have enabled a project's exact `backlogSourceProjectId` mapping; the matching site URL and project expiry are checked. Ambiguous/absent mappings stay blocked. Public feed fetches receive no credential.

`task_sync_execute` requires both `task-sync:read` and `task-sync:write`. Arguments are `{sourceId, expectedFingerprint, confirmed:true}` from the preview. The gateway re-fetches the source and mapping, rejects changed content, reads `tasks.import_source_status`, and submits `tasks.import_source` under another fresh Roles decision. It imports one bounded task per call. A preview is never a reusable permission token.

Required exact Roles scopes use project `crm`:

- `task:read` on `workspace:projects` for connected-project discovery.
- `task:read` on `project:<CRM project UUID>` for task status.
- `task:import` on that same project resource for an import.

The configured actor and source grants must independently authorize these operations. No wildcard or automatic conversion of existing app roles is included.

## Configuration preparation

`MCP_TASK_SYNC_CONNECTIONS_JSON` is a server-only array, empty by default. Each approved connection has `tenant`, `subject`, `actorTokenHash`, a dedicated CRM dataset `token`, and numeric `expiresAt`. It must match an existing explicitly enrolled credential's `rolesAuthorityBinding`. Keep tokens outside source control and client configuration; do not reuse lead-import credentials without verifying the new scope.

CRM `projects.list` must return `id`, `workspaceId`, exact `backlogSourceProjectId`/`backlogSourceSiteUrl`, and a valid `expiresAt`. Mapping is chosen by the source owner, never inferred from a fuzzy project-name match. A source project with no canonical site may map only through an explicit matching null-site identity.

## Retry and conflict behavior

The gateway computes its own canonical content fingerprint. An import operation UUID is deterministic for owner, source task, destination and content. Before sending, it persists the exact request (including expected CRM version) with its binding/token identity. An uncertain retry reuses that payload and operation UUID. CRM must implement current-authority checks before returning its stored exact-operation receipt.

Source content changes require another preview. Version conflicts, source-field edits, task movement and assignment changes require review; no automatic merge overwrites them. Imports omit CRM owner, comments, due date and completion fields. Source status/priority are provenance; CRM's ordinary-import contract owns how a newly created task is initialized and preserves existing CRM completion on update. Missing/tombstoned source records are retained for review, never deleted or auto-completed.

The internal import ledger is bounded to 1,000 entries with operator review at capacity. No deletion or automatic retry loop is introduced. Accepted/denied/reconciliation states remain durable. Positive production acceptance requires the exact approved actor, source mapping and a bounded reviewed import; no synthetic production task is created by this rollout.

## Validation and release prerequisites

Gateway tests cover missing binding, changed source, scope restriction, fresh per-attempt denial, uncertain-response identity, source conflict and omission of owner-controlled fields. Source PR39 independently tests actual PostgreSQL idempotency/authorization/conflict behavior. Verify both final deployed revisions before configuring a connection. Replay one approved import, revoke permission and confirm the next attempt is denied before enabling unattended task orchestration.

Ordinary backlog import is independent of CRM’s AI-task grant (`tasks`). An exact enabled backlog mapping may be used with `tasks:false`; the gateway must not require or enable unrelated AI-task access. Current Roles decisions, mapping expiry and CRM source authorization still apply.
