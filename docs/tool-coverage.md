# Prefer MCP for app work

Start with `list_bittrees_tool_coverage`, then `plan_bittrees_tool_use` with a selected `projectId` and operation (`read`, `create`, `update`, `complete`, `research`, `sync`, `publish`, `prepare`, `delete`). The results distinguish reviewed routes from gaps. They execute no app operation and grant no permissions.

Use the existing app connection and its live `initialize` / `tools/list` before execution. Match current input schemas. Keep operation IDs across uncertain responses and current revisions for edits. Check saved receipts after writes. A source-inspected route is not proof of deployment, an active connection or authorization. Do not silently fall back to a browser when an app denies access.

## Coverage

| App | Tool route | Limits / next gap |
| --- | --- | --- |
| CRM | Native dataset MCP: task lifecycle, dataset and qualification; managed supplier proposal MCP | Paginated ordinary-task inventory is available within connected projects; unassigned supplier preparation remains a gap; current project grant required |
| Calendar | Native MCP: read, save, delete, source deadlines, availability | Source access checked independently; no invitation email |
| News | Native MCP: reading, curation and reviewed publication | Publication approvals preserved; Acer model configuration untouched |
| TLD | Native MCP: policy reading, validation and unsigned preparation | No signing, Safe submission or execution |
| Roles | Local MCP adapter: own access and explicitly scoped policy reading | Existing scoped grant; administration excluded |
| AutoNote | Local MCP adapter: transcript, review status and receipt | Existing meeting grant; approval and publication excluded |
| Mercado | Existing managed MCP proposal preview/status | Exact source connection required; no new publication authority |
| AI, Workflows, Insights and other selected catalog apps | Public context and explicit coverage-gap reporting | Source API adapters need contract review before adding operations |

The catalog includes AI, Workflows, Calendar, News and TLD as public project contexts. Existing excluded or pending apps remain excluded/pending. Every selected project gets a coverage result; unknown is never reported as implemented. Catalog selection does not expose a private record.

## Roles and AutoNote local MCP adapter

Run `node integrations/app-api-mcp.mjs` from this repository with Node 22 or later. Configure `BITTREES_APP` as `roles` or `autonote`, and supply that app's **existing** 64-character scoped credential through `BITTREES_APP_TOKEN` in the MCP client's secret-backed environment. Use a separate process/credential per app. Do not put credentials in tool arguments, URLs, source files or shared configuration. The adapter does not issue, exchange, approve, renew or recover credentials.

The line-delimited stdio transport offers:

- `roles.read_access {}`
- `roles.read_policy {}` (requires existing policy scope)
- `autonote.read_transcript {meetingId}`
- `autonote.review_status {}`
- `autonote.review_receipt {operationId}`

The source app rechecks authorization on every read. The adapter permits only fixed HTTPS app paths, sends no browser cookies, rejects redirects, bounds inputs/responses and returns sanitized errors. Source content remains untrusted data. Tests use synthetic credentials and responses; live private reads are not implied by a passing test. Installation does not activate a grant or recurring workflow.

## Expansion order

1. CRM ordinary-task inventory and supplier preparation, preserving original confirmation tasks.
2. Reuse existing source APIs for additional read/status/receipt tools; add contract-specific writes only with versioning, idempotency and existing approval checks.
3. Review AI and Workflows source-owned task controls, then Insights and Mail. Preserve Mail eligibility, MFA, send consent and controller signatures.
4. Review the remaining apps individually. Preserve Bounties escrow/payment approval and governance/controller authority. Do not expose broad SQL, arbitrary HTTP, credentials or permission-grant tools.

Human sign-in or granting new access may still require an app approval flow. Routine execution should not require an open browser after the scoped connection exists.

## Central discovery and automatic sync

`mcp.bittrees.org` is the canonical starting point for agents, even when an operation runs through an app's own authorized MCP connection. Use `search_bittrees_tools` across selected apps, `get_bittrees_tool` for an exact `app:function` ID, and `plan_bittrees_tool_use` for operation routing. `/tool-catalog.json` and the `selected-tool-directory` MCP resource contain the same selected-project function directory, project components, gaps and sync state. Current input schemas come from the app's authorized `tools/list`, not an assumed stale central copy.

Each allowlisted repository publishes `bittrees.tools.json` with schema `bittrees.app-tools.v1`, version1, its fixed `projectId`, `canonicalDiscovery: https://mcp.bittrees.org/mcp`, and its public `connections` metadata. Update it alongside tool additions/removals. Empty connections explicitly declare a coverage gap; they do not infer private access or pretend an adapter exists.

The central `Sync app tool manifests` workflow reconciles hourly, by manual dispatch, or on `bittrees-tools-updated` repository dispatch. Dispatch payloads never provide fetch URLs. Sources, branches, paths, connection endpoints, transports and local adapter setup are centrally allowlisted in `data/tool-sources.json`. Public repositories are fetched at immutable commit revisions. Private repositories publish only their public tool metadata at the fixed `https://<app>.bittrees.org/.well-known/bittrees-tools.json` address. The app build regenerates that file from its root manifest. These HTTPS reads send no credentials, reject redirects, and record a SHA-256 content revision instead of a Git commit. A private repository never needs to expose its source or grant the central service a repository token. Tool names and operation mappings may update within reviewed routes, but new endpoints/setup require a reviewed central change. This is metadata synchronization only; it cannot grant execution authority.

An invalid or unavailable app retains its last known tools and publishes a warning without blocking other valid app updates. A valid empty manifest removes obsolete routes. Reports are retained as CI artifacts and source health appears in the directory. Existing catalog exclusions and pending publication states still apply.
