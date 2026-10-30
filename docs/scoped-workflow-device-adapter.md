# Local AI workflow adapter

The gateway registers exactly `workflow_claim`, `workflow_renew` and
`workflow_complete`. Central discovery describes this gateway-owned route even
when Workflows declares an empty public manifest. It does not prove deployment,
enrollment, usable credentials or approved grants. Source manifest refreshes do
not erase gateway-owned registration; they do not enable it either.

The existing Mac `CentralWorkflowWorker` uses this contract at
`https://mcp.bittrees.org/mcp?mode=selected&projects=workflow`. The local task key
signs the exact arguments, operation ID, tenant, workspace and delegation on
every request. It remains separate from a transaction key.

## Review and activation

- The active person signs in to Roles using their original fresh session. Roles
  derives their verified identity; person registration grants no authority.
- Enroll the actual local device through the reviewed native flow. A public
  catalogue entry, pasted owner/profile ID or key fingerprint is not enrollment.
  The gateway's device binding uses the public key only; the private key stays
  local. Initial pairing, runtime enrollment and delegation are separate steps.
- Review the exact tenant, workspace and workflow. The three action tuples are
  `workflow:claim`, `workflow:renew` and `workflow:complete` on
  `workflow:<reviewed-workflow-id>`. Until-revoked delegation requires current
  parent action, `delegate:<action>` and `delegate-until-revoked:<action>`
  authority for each tuple. Policy replacement, suspension, expiry and revocation
  remain enforced per request. Contributor labels and reputation grant nothing.
- The Workflows owner explicitly approves the exact source connection and active
  local-AI workflow revision. Workflows rechecks current owner/source authority
  in the same transaction as each queue mutation. A gateway allow is insufficient.
- Provision only the reviewed existing gateway credential, source token and exact
  bindings through operator secret storage. Preserve existing connections and
  grants. Never send credentials, private keys or authority fields as arguments.
  Missing or ambiguous configuration exposes no executable device tools.
- The optional Mac native helper still requires independently reviewed source and
  cost evidence plus exact bounded native confirmation. Saved configuration is
  not approval. Wallet, controller, Safe, publication and payment approvals remain
  independent. This adapter creates no production grants, enrollment or schedules.

## Execution and recovery

The adapter validates exact arguments, lease IDs and bounded model evidence
before asking Roles. It rechecks the connection after Roles and after the source
reply. Native device calls deny browser Origin/Cookie headers, even empty, and
encoded bodies. Source URL and redirect policy are fixed. Replies require bounded
streamed bytes, valid UTF-8, exact operation results and a matching job input hash;
the deadline includes body consumption and cancellation does not await a stalled
stream.

The Mac durably saves claim/completion operation IDs and pinned model evidence.
Uncertain outcomes remain held. Retries obtain fresh Roles proof with the same
logical operation and evidence; they do not regenerate accepted output. Workflows
owns leases, bounded attempts and atomic authorized successor creation. Only
local text generation is supported. Model output cannot invoke arbitrary tools,
change permissions, publish reputation or approve a transaction. Work history is
evidence, never current authority.

## Validation limits

HTTP tests exercise the real gateway handler, device-held and gateway signatures,
current signed Roles decisions and revocation. Contract tests cover altered
configuration, strict model evidence, malformed/oversized/encoded responses and
stream cancellation. An isolated cross-repository acceptance also exercised the
actual Mac worker, Roles policy evaluator, Workflows SQL queue and existing local
model: two steps, lost-reply reconciliation without regeneration, successor and
source/delegation revocation denial. Its identities, policies and source grants
were synthetic and in memory. It is controlled pilot evidence, not production
enrollment, deployment or live user authority.
