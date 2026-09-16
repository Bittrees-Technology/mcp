# Bittrees standalone MCP service and integration plan

Prepared 16 September 2026. Implementation delegated to the existing **work.agent** task, `01a06f48-5775-72f2-9fb7-5d7f3e44637f`. This document is a proposal and implementation brief, not a claim of deployment.

## Product decision

Revised by explicit user direction: build MCP as a standalone service; defer Node implementation. This revision supersedes the earlier single-site gateway placement.

Build `mcp.bittrees.org` as an independently deployable integration, automation and rules service. Its target canonical MCP transport is `https://mcp.bittrees.org/mcp`, activated only after deployment verification. Keep `agent.bittrees.org` as the person/agent onboarding and discovery funnel linking into this service. Reuse existing gateway capabilities through project adapters rather than operate a separate MCP server for every repository. Independently useful products may maintain their own MCP server, with the gateway providing scoped routing. Static sites, documentation and contract packages generally need resources or an adapter under their parent product, not another server.

Provide three choices: **Selected projects**, **All Bittrees projects**, and **Bittrees + related projects**. Node is deferred; its future default remains the third. “All” means all eligible, approved catalog entries; it does not install all software, host all services or grant permissions to private data and actions. Keep discovered but unreviewed projects visible as pending entries to operators.

## Evidence and unresolved inventory

The local gateway documents an existing Streamable HTTP MCP endpoint and project discovery/handoff tools. Its August 21 registry contains 14 products. September 16 GitHub repository listings for Bittrees-Technology and bobofbuilding establish additional candidates below. Repository existence is not proof of live deployment or affiliation. The local marcada README identifies its product as Mercado; it must not be registered twice. IDACC runtime and marketing site likewise represent one product with multiple components.

The existing Node plan uses `node.bittrees.com`. The present request says `node.bittrees`; the implementation owner must resolve the current canonical hostname rather than assume `.org` or change DNS. Mail, MyCloud and Node appear in the prior Node plan but their current repositories/endpoints still require verification. Web inspection of the three requested hostnames was unavailable in this planning pass; toolbar and production behavior require implementation-time verification.

## Project-by-project MCP fit

Every row is a proposed scope, not an assertion that its APIs already exist. Read access to private data requires project authorization. An adapter must report unavailable capabilities honestly until its downstream integration is verified.

| Product or repository group | Initial integration | Subsequent capability, only with project authorization |
| --- | --- | --- |
| Agent funnel | Person/agent onboarding, discovery and explicit handoff to MCP service | Existing gated contribution workflows where appropriate |
| Standalone MCP service | Project catalog, connection profiles, MCP transport and supported adapters | Scoped automation execution, deterministic rules and audit history |
| Bittrees.org | Organization/project resources and canonical links; no separate server | Reviewed content publication through existing owner workflow |
| Governance / Bittrees-Inc | Proposals, public forum context and voting metadata | Prepare proposals/vote payloads; signing and submission retain explicit authority |
| Research / Bittrees-Research | Public research and scoped member resources | Draft research/contributor submissions and review status |
| Capital | Public token/portfolio context; authorized treasury views | Transaction preparation and simulation; signing/spending remain separately authorized |
| Vault | Pool/liquidity documentation and verified read APIs, grouped with Capital where sensible | Prepare swaps/liquidity changes with wallet approval |
| Bitlogic | Discovery/docs now; authorized accounting reads when implementation resumes | Draft journal/import workflows with accounting permissions; retain prior feature-work deferral |
| Bounties | Search bounties, requirements and public state | Draft/apply/submit workflows; escrow/settlement separately authorized |
| Chirpy (legacy catalog ID chat) | Community discovery and authorized conversation reads | Draft messages; sending requires explicit messaging authorization |
| CryptoDirectory | Search and retrieve directory records as resources | Reviewed directory corrections |
| IDACC, idacc-site, id-agents, Brain | One product entry with component aliases; release/support resources | Supported local/private adapter for scoped task submission and status; no public raw runtime access |
| NFTFactory | Public collections/assets and publication requirements | Authorized draft/upload/publish workflows; minting remains wallet-controlled |
| SkillMesh | Discover existing MCP/OpenAPI/A2A capabilities and compatibility | Federate supported tools after scope and transport review; retain prior feature-work deferral |
| TCP | Public project context and authorized planning/scenario reads | Draft scenarios and approved operational jobs |
| Roles | Public policy description and caller-scoped membership/permission reads | Approved policy-change workflow; catalog inclusion never grants roles |
| Mercado (local directory marcada) | Public catalog/offers and authorized quote reads | Quote/catalog drafts and approved seller actions |
| Insights | Private, permission-filtered analytics queries and aggregates | Saved reports with tenant isolation; no default public telemetry |
| CRM | Authorized contacts, pipeline search and workspace resources | Draft/update records with explicit workspace scopes |
| AutoNote | Authorized meetings, transcripts and notes | Draft summaries/action items; export/share requires appropriate scopes |
| Wallet | Public chain/account capability descriptions and caller-approved account context | Prepare/simulate transactions; wallet retains signing and secret custody |
| Mail | Caller-authorized mailbox metadata/search via a dedicated adapter | Draft messages; send/delete/provision require distinct permissions |
| Node (deferred) | Future authorized service inventory, health and job status; no implementation in this pass | Future fixed, scoped operational jobs |
| MyCloud | Discovery pending source verification; later authorized file metadata/search | Explicitly scoped upload/share operations; no public private-file indexing |
| Ecrypt | Documentation and authorized encrypted-record metadata | Encryption/access workflows preserving decryption boundaries and keys |
| The Verse + the-verse-website | One product entry; public documentation/catalog/game state where an API exists | Game actions or marketplace preparation after API and authority review |
| Cryptoalegre | Public organizational/resources catalog; resources-first | Reviewed membership/content workflows if supported |
| Builders Advocacy Group + bag-membership | Public project/membership contract reads | Membership transaction preparation, with separate signing |
| BTREE ERC20, BGOV, BRGOV, research-contract packages | Verified contract/address resources grouped under Capital/Gov/Research | Reuse parent adapters; no independent server per token contract |
| WBTC test token | Development-only contract resource, excluded from production capability defaults | Test environment only |
| Metatokens | Discovery entry pending repository/API assessment | Decide adapter fit after actual product contract is verified |
| TreeSwap | Public swap capability/quote resources after endpoint verification | Intent preparation and status with separate payment/signing authorization |
| IPFS node (repository ipsf-node) | Component of Node: pin/retrieval/replica health | Bounded authorized pin/publish jobs with quotas |
| bbrf-pt | Pending product/ownership review; no invented tools | Define scope only after source assessment |
| Archive/archived contract and deployer repositories | Historical resources and aliases, excluded from active defaults | No new server or active tools |

Classify each reviewed product explicitly as `bittrees` or `related`, with source evidence and an accountable owner. Keep `pending` for unresolved affiliation. Organization location, domain or branding alone must not silently decide the boundary. This inventory is a starting set, not a forever-complete list.

## Shared registry and selections

Maintain one versioned registry owned by the MCP service, consumed by the funnel UI, MCP discovery and downloadable client configuration. Reserve a future consumer contract for Node without implementing it now. A project manifest includes stable ID, component aliases, affiliation, lifecycle, repository/public URLs, approved endpoint, owner, capabilities, auth scopes, source commit, observed/published timestamps and schema version. Track catalog presence, availability, adapter readiness and action readiness separately.

Persist a selection profile with mode `selected`, `bittrees` or `ecosystem`, explicit selected/excluded IDs, profile revision and catalog revision. Selected profiles gain no extra project automatically. Dynamic profiles include newly approved eligible entries, subject to any explicit exclusions. Removal/deprecation and reclassification must produce a visible change record; inaccessible IDs remain explainable rather than silently rerouting to another project.

Enforce profiles on the server for lists, resource reads, tool calls and handoffs. Client-side filtering alone is insufficient. Resolve project IDs to approved adapters; never proxy arbitrary URLs supplied in a tool argument. Maintain project/tenant/actor context through every downstream request. Broad catalog choice cannot widen tokens or downstream entitlements.

Future Node requirement only: initialize new configurations to `ecosystem`, preserve saved choices, and separate catalog visibility from workload execution. Node repository discovery, hostname decisions and consumer implementation are deferred.

## Gateway simplification and toolbar

The Agent site introduces the ecosystem, helps a person or agent choose a path, and hands off to MCP. The MCP site owns the operational journey: choose project scope, connect, manage rules and automations, and inspect execution history. Use concise navigation adapted to each audience. Show readable readiness/freshness indicators and useful errors. Keep machine endpoint details in connection instructions, not scattered through normal navigation.

Build the missing deployment at `https://mcp.bittrees.org` and add its toolbar/tab link in the Agent funnel. Move the canonical transport to `https://mcp.bittrees.org/mcp` after verification. Preserve current Agent MCP clients through an explicit compatibility adapter or documented migration; never blindly redirect authenticated POSTs across origins. Keep service configuration, credentials and deployment lifecycle separate. Verify navigation, keyboard behavior, mobile layout and absence of redirect/proxy loops. Do not advertise a broken destination as operational.

## Automation and rules service

Implement project-scoped automation definitions with event/schedule triggers, durable run state, idempotency, bounded retries, timeouts, execution history and pause/cancel controls. Rules are versioned, deterministic policies checked at execution against current actor, project, tenant and capability permissions. A catalog selection does not authorize an action. Revocation or a paused rule must prevent subsequent execution; record the policy revision and decision with each run.

Start with a supported read/status integration and a useful automation slice that can be tested without unauthorized external effects. Distinguish draft, enabled, paused, failed and completed states. Configuration creation must not silently authorize sending messages, spending, signing or changing permissions. Validate duplicate events, denial, retries, pause/cancel, source failure and audit privacy. Identify unimplemented project adapters explicitly.

Keep runtime secrets server-side and separate between services. Verify authentication audiences during migration. Choose the durable store and scheduler from actual hosting capabilities; do not claim reliable automation from process-local memory. Document rollback and deployment evidence independently for the funnel and MCP service.

## Automatic updates

Each approved source publishes a versioned manifest. Authenticated repository events trigger validation and refresh; scheduled reconciliation catches missed events. Inspect existing hosting/CI before choosing the mechanism. Validate schema, approved source, affiliation, URL/endpoint allowlists, duplicates, capability changes and compatibility before an atomic snapshot is published.

Automatically publish permitted metadata updates and newly eligible projects from previously approved onboarding rules. New origins, unresolved affiliation and elevated capabilities remain reviewable changes. Deduplicate retries by source/revision. A failed fetch must preserve the last-known-good registry and show stale/error status, never masquerade as an empty ecosystem. Actual removals require an explicit lifecycle event or verified source change.

Publish revision/ETag and freshness metadata; invalidate funnel/service UI and configuration caches consistently. Keep audit records, rollback snapshots and bounded retries. Verify update latency with a real test manifest change. Do not claim auto-update is active until trigger, scheduled fallback, deployment and propagation evidence are recorded.

## Delivery order and acceptance

1. Reconcile inventory, current upstream branches/PRs, source ownership and MCP hosting configuration. Preserve existing work and deferred product backlog.
2. Ship the independently deployable MCP service, registry schema, selection profiles, supported read integrations and generated client configuration. Verify cross-project and cross-tenant isolation.
3. Simplify the Agent funnel and link the standalone MCP service; verify browser/mobile/keyboard behavior and existing-client migration.
4. Wire trusted event updates and scheduled reconciliation; demonstrate additions, changes, removals, reclassification, retry, stale-source retention and rollback.
5. Implement a useful rules/automation slice and integrate adapters in small batches: public resources first; then authorized project reads; finally separately authorized mutations. Reuse existing APIs; add an independent project MCP service only where justified.
6. Record staging/production status, tests, remaining project gates and ownership. Existing documented gateway storage/security/legal/write gates need current evidence before describing public mutations as released.

Required meaningful checks: pinned selections do not expand; all modes expand correctly; explicit exclusions persist; forbidden project calls fail even when crafted manually; auth expiry/revocation is respected; failed upstream sources do not erase projects; reclassification/removal changes are deterministic; configs connect to the actual implemented route; update evidence reaches funnel UI, service UI and machine catalog at the same revision.

## Reusable integration prompt for future project owners

Integrate this project with the standalone Bittrees MCP service at mcp.bittrees.org; agent.bittrees.org is its onboarding funnel. Inspect the current shared manifest schema and adapter contract before implementing. Register one stable product ID, evidence-backed affiliation, component aliases, owner, repository/public endpoints, lifecycle, supported capability versions and authentication scopes. Reuse existing APIs; expose resources for content-only surfaces. Keep private reads tenant-scoped and mutations explicitly authorized. Preserve selected/bittrees/ecosystem profile enforcement and saved preferences. Node work is deferred. Add contract/isolation tests, trusted manifest update triggers, health/freshness evidence, deprecation and rollback instructions. Submit reviewable code and report separately what is implemented, tested, deployed and blocked. Never claim capabilities based solely on a repository or landing page existing.

## Handoff and source trail

The revised implementation assignment has been sent to work.agent: standalone MCP service, simplified Agent funnel, project selection, rules/automation, catalog synchronization and onboarding documentation. Node implementation is explicitly deferred. That task owns implementation changes to avoid concurrent edits here.

Sources inspected: `agent/data/bittrees-projects.json`, `agent/docs/unified-bittrees-mcp-completion.md`, `agent/README.md`, prior `plans/node-bittrees-product-plan.md` and `plans/bittrees-identity-authority-nodes.md`, Mercado/Roles/Wallet local READMEs, and authenticated GitHub repository inventories for Bittrees-Technology and bobofbuilding on September 16. Historical gateway launch blockers and endpoint implementation are source evidence, not fresh production verification.
