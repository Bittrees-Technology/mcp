# Ecosystem gateway contract and onboarding

## One product, one identity

The canonical registry is `data/bittrees-projects.json`, schema
`agent.bittrees.project-registry.v2`. It feeds the project directory, existing
project APIs, `/catalog.json`, connection configuration, and the standalone MCP service.
Stable IDs are never reassigned. `chat` remains Chirpy's ID; `chirpy` is an alias.
Mercado includes the local name `marcada`. IDACC lists its site, Manager and Brain
as components, and The Verse includes its website. Contract repositories are
components of Capital, Gov, Research, or BAG; archives and the WBTC test token do
not become additional production services.

Each project records aliases, repository/public URLs, affiliation evidence,
repository controller, pending accountable-contact status, source commit and
observation time, lifecycle, health, adapter/capability status, and auth scopes.
Null URLs/revisions and pending affiliation mean unverified, not nonexistent.
The original 14-project readiness review remains historical; new inventory entries
have no fabricated launch review. Bitlogic and SkillMesh remain discovery-only.

Approval in this release is permission to expose already-public catalog context.
It does not certify the product or identify a support owner. Existing reviewed
catalog membership supplies legacy related-project provenance; organization
location alone is insufficient for a new affiliation. New candidates stay pending
unless reviewed source evidence explicitly identifies the Bittrees product.

## Connection and persistence

Use `/connect` to choose selected, bittrees or ecosystem and download
`/connection.json`. The configuration saves the selection in the remote MCP URL:

`https://mcp.bittrees.org/mcp?mode=selected&projects=agent,crm&profileVersion=1&profileRevision=1`

No server-side bearer secret is embedded. The client persists this URL in its own
settings. `selected` pins stable IDs and never adds a newly discovered ID. Dynamic
modes re-evaluate approved eligible projects each request. `exclude` is a persistent
comma-separated exclusion list. Removed/deprecated/pending pinned IDs remain in
the profile and appear as unavailable, rather than silently moving to another
project. Changing affiliation affects group selections; an approved explicit pin
remains pinned. The config's profile revision changes only on explicit edits.

An explicit scope is enforced before discovery, resource reads, tool lists,
tool calls and handoffs. Unknown methods, extra URL arguments, other origins,
unselected IDs and private tools are rejected. The server resolves only catalog
IDs; it performs no client-selected upstream fetch. All current scoped adapters
serve public catalog records. MCP-ready means that context resource works, not
that accounting, mail, finance, hosting or other downstream tools are connected.
Listed, fresh/reachable, MCP-ready and action-ready are distinct; action-ready is
false throughout this initial release.

For compatibility, unparameterized `/mcp` retains the historical contribution
API and existing bearer/identity/write gates. It is the legacy broad connection,
not a saved selected profile. New generated configs always specify a mode.
To change a saved selected scope, change the client configuration explicitly;
selection itself is not an authentication boundary. Public catalog data remains
public through ordinary website routes.

## Adapter and authorization contract

A future private adapter must carry immutable project ID, actor ID, tenant ID,
audience, narrowly scoped authorization, expiry, revocation and request correlation.
Resolve its endpoint and credential server-side from an approved adapter map.
Never reuse one project's credential for another project, forward the gateway
bearer token upstream, accept an arbitrary URL in tool input, or fall back from a
failed private request to a broader public/global query. Authentication does not
follow from selecting ecosystem. Scoped clients currently have no private or
mutation tools; supplying a token cannot enable one. Existing contribution writes
remain at the legacy interface with their existing independent gates.

New capabilities require code implementation, adapter tests, tenant isolation,
authority review and then a manifest update. A manifest cannot enable a private
read or action merely by changing a boolean. Content-only projects use resources.

## Service separation and Node deferral

`services/mcp` builds an independent deployment for mcp.bittrees.org. It owns MCP,
profiles, deterministic rules and durable automation execution. See its README
for authenticated contracts, PostgreSQL durability, deployment gates and migration.
Agent provides discovery/onboarding and links to the standalone service. Existing
Agent MCP clients keep their original API and authorization; no authenticated POST
is redirected and no tokens are forwarded across service audiences.

Node implementation is deferred. No Node consumer code ships. Its future default
remains ecosystem while preserving saved selection overrides.

## Trusted updates

A project owner copies `examples/bittrees.project.json` to the source repository's
`bittrees.project.json`. The public schema is in
`schemas/project-manifest.schema.json`; selection schema is alongside it.
After review, add the exact source ID/repository/branch to `data/catalog-sources.json`.
The reconciler fetches only that fixed filename at an immutable GitHub commit.
No event-supplied URL, hostname, token, affiliation or capability is trusted.

GitHub authenticates `repository_dispatch` calls through its repository write
permissions. Owners send event type `bittrees-catalog-source-updated` using an
approved GitHub App token; the payload is only a notification and is not fetched.
A six-hour scheduled reconciliation catches missed notifications. No custom public
webhook or shared secret endpoint is introduced. Tokens go only to api.github.com,
and redirects are refused. Do not distribute a gateway repository write token to
projects; use a narrowly installed GitHub App or dispatch from the trusted owner.

Only reviewed identities can update automatically. Existing source changes may
update name, summary and explicit lifecycle (including removal). Affiliation,
new origins, owner/aliases, auth scopes and capabilities require a policy review.
A new preapproved source may use an `approvedTemplate`; new sources not in policy
are ignored. Invalid data, duplicate identity, source failure or an elevated
capability retains the entire last-known-good snapshot. No failed source creates
an empty catalog. Reports contain bounded generic errors, not provider bodies.
Validated snapshots are atomically replaced and expose revision/ETag. Rollback
snapshots and change reports are retained as workflow artifacts for 30 days.

The workflow is **prepared**, not active: sources are initially disabled and
`CATALOG_AUTO_PUBLISH` is not assumed enabled. After the manifest is merged, verify
one reconciliation, approve the source and enable publishing. A workflow push is
not proof Vercel deployed it: verify the resulting deployed catalog revision. A
failed check must be reported by workflow failure and `/catalog-sync.json`; when
publishing is disabled only the artifact is current. Never call a disabled source
or an unmerged schedule “automatic updates running.”

## Release checks and ownership

Run `npm test`, `npm run check`, `npm run build`, and `npm run verify:api`.
The ecosystem tests cover propagation, pinned selections, exclusions, removal and
reclassification, invalid profiles, forbidden project calls, token non-escalation,
source failure, unsafe manifests, ETags,
and the actual generated-config HTTP path. Check mobile/keyboard navigation and
copy/download manually. Keep the existing noindex and write/legal/storage gates.

Before activation record: accountable source owner, approved affiliation evidence,
a manifest-commit event, scheduled-run evidence, publication commit, deployed
revision match, observed latency, and rollback drill. Deprecations leave stable
IDs with a lifecycle record; never repurpose an ID or redirect a pin to a successor.
Use a reviewed git revert of catalog/source policy to roll back, followed by deploy
verification. Scheduled jobs serialize; git push is non-forced and fails on drift.

The new canonical transport is targeted at `https://mcp.bittrees.org/mcp`.
A built artifact or preview is not production activation. Record deployment URL,
source revision, dedicated storage/credential configuration and domain verification
before marking it production-ready. The shared rollout matrix is in
`docs/ecosystem-rollout-plan.md`.
