# Gateway execution and interface rollout — 17 October 2026

The gateway has four primary areas: Connect, Explore, Automations and Status. `/explore` is the canonical project view; `/projects`, `/tools`, `/rules` and `/mcp-docs` retain compatibility. Agent owns its funnel and links; MCP owns integration and automation.

## Scheduled occurrences

A due schedule creates one stable occurrence identity. Missed intervals coalesce. A successful enqueue or terminal denial/failure advances the next interval from the current tick. Transient enqueue failures retain the original due time and become visible `deferred` runs. Retries wait at least five minutes then ten minutes; the third failed authorization/connection attempt is terminal. Every retry rechecks current authority. Explicit denials never enter automatic retry. Cancel includes deferred occurrences; pause holds them and resume preserves their identity.

Capacity exhaustion fails the worker instead of dropping an occurrence. Worker heartbeat and job outcomes are separate; outstanding deferred occurrences remain visible even during a tick without a retry. A healthy worker is not proof of successful jobs or protected execution.

## APIs and client compatibility

`automation_setup` mirrors `/v1/automations/setup`: profile, rule and automation are created atomically and paused. All three write permissions, selected project scope and current engine checks apply. Existing individual routes and lifecycle semantics remain supported. The trusted management registry supplies REST route names, input schemas, required permissions, side-effect classifications and MCP definitions; engine field guards and the JSON reference consume those definitions. engine validation and source adapters remain the final enforcement boundary. This is an incremental consolidation, not a claim that every downstream schema is generated here.

`/v1/history?limit=50` returns owner-isolated pages with `page.nextCursor` for runs and `page.auditNextCursor` for audit entries. Pass `cursor` and `auditCursor` independently. IDs identify the last item in a descending time/ID ordering; responses retain chronological ordering within each page for existing renderers. A cursor from another owner is rejected. Requests without a limit preserve legacy full-history behavior. `/v1/workspace` returns at most 50 runs and 50 audit entries; definitions remain available for the workspace. The UI exposes older activity without repeated full-history polling.

Public catalog pages and diagnostics initialize without contacting the state database. Transactions still validate the database format and protected operations fail closed. No local storage fallback or cached permission is introduced. Accepted MCP initialized notifications return 202 with no body.

## Evidence and readiness

`data/verification-evidence.json` contains only reviewed, redacted evidence. The October 15 snapshot restoration and NAS read-back are bound to a digest of the current SQL migrations and expire after 30 days. A schema change or expiry invalidates the green recovery label. This is historical recovery evidence, not a live backup-job check.

Positive protected execution remains unverified. To publish acceptance evidence, record `passed`, `checkedAt`, `expiresAt`, exact public-safe `scope`, deployment `release`, and `policyRevision` under `execution`, with a supporting protected test record. Changes to release/policy or expiry invalidate it. Evidence never grants authority. Do not publish actor IDs, secrets, private resource names or grant documents.

Project dispositions distinguish resources-only, adapters available, source failure, pending approval and absent enrollment. A project may supply useful public context without an action adapter. Project metadata reconciliation and tool-manifest synchronization have separate source lists and timestamps. Approved source changes are triggered by authenticated GitHub repository dispatch and reconciled periodically; event payloads cannot supply fetch URLs. Only reviewed source identity and safe descriptive fields may update automatically.

## Operational envelope and escalation

Current storage retains a single serialized state row, 10,000 runs and 10,000 audit entries. Automation batches are capped at 20 due schedules and 20 processed runs per tick. This release makes no throughput SLA. Before increasing volume, benchmark representative state size and lock duration in an isolated PostgreSQL environment; use observed duration to choose a narrower workload or normalized tables. Do not run a load test against production.

Operator review is required when a worker is failed/stalled/stale, jobs remain deferred across retry windows, credentials approach expiry, or either global record count reaches 80% of its limit. Owner workspace counts do not represent global free capacity. The existing 30-minute GitHub watchdog is best effort and reports via workflow failure; it cannot guarantee 15-minute notification. Provider cron remains every five minutes.

Before archival, approve retention period, destination, recoverability and access controls. No automatic deletion is enabled. Preserve the existing backups and test a restore separately before a storage migration.

## Remaining activation gates

Roles revision 6 is active and mandatory source/AI guards are deployed. Zero enrolled actors/bindings means no protected execution access. Roles confirmed no safe automatic mapping from existing app roles: enrollment requires fresh session and possession proof, and exact MCP action/delegation grants need the existing authority approval path. Shared sign-in alone does not register MCP as a client or confer workspace membership. Keep self-service enrollment unavailable until the client and entitlement contracts are approved.

AI activation additionally needs paired dedicated credentials, verified storage migration, an approved actor/template and both sides of consent. Do not generate an execution grant from a staff role or enable an automation as part of setup.

The nine withdrawn products remain excluded from discovery, feeds, automatic enrollment and active work. The Agent/CRM task-feed integration is a separate bounded import: per-project destination mapping must be verified and actor permission must exist before any writes. Source omission never deletes or completes CRM tasks.

## Release and rollback

CI must pass service/PostgreSQL and browser tests. Deploy the exact merged commit, verify `/explore`, Connect discovery, status, exclusions and notification semantics, and observe two genuine scheduled ticks. A manual tick cannot establish provider cadence. Roll back the UI commit if necessary, but never restore the legacy no-binding Roles bypass. No state migration is required by this rollout; additive run metadata and statuses are retained.

## Agent backlog import preparation

Run `node scripts/prepare-task-sync.mjs` to inspect the fixed, approved Agent `/tasks.json` feed without writing to CRM. An optional `MCP_TASK_MAPPING_FILE` supplies a reviewed list with `sourceProjectId`, exact `sourceSiteUrl` (null only for a catalog entry without a site), `crmProjectId`, `workspaceId`, `approved: true` and `expiresAt`. A valid mapping is preparation, not execution authority. Ambiguous, expired, excluded or mismatched sources are rejected or held. Changes to existing destination mappings and owner-edited source content require review. Missing tasks are retained.

Current live feed validation found 66 tasks across 11 projects; all require approved destination mappings. CRM's inspected `tasks.create`/`tasks.update` schemas require `AI draft` or `AI review`, so they cannot represent the entire ordinary production backlog faithfully. Agent chat is coordinating a source capability for ordinary task import. The planner is implemented and tested; it intentionally has no CRM write transport and must not be described as an activated sync.

A subsequent adapter implementation adds `task_sync_preview`/`task_sync_execute` behind an empty-by-default dedicated connection configuration. See [task-sync-adapter.md](task-sync-adapter.md). The read-only planning command still never writes. Actual activation remains blocked on CRM source deployment, approved mapping and actor authority.

Worker loops also reserve time for durable finalization: public scheduling/execution stops starting new work after 45 seconds, and AI dispatch starts only when a full transport lease plus database margin fits within the overall worker budget. Remaining work stays pending for the next tick; this does not promise a fixed delivery time.

Project and tool reconciliation share a publication concurrency group. Before pushing a metadata commit, the publisher rebases onto current main and reruns validation; up to three non-forced push attempts handle concurrent code merges. Conflicts fail visibly and preserve the last published catalog.
