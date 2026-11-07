# Live CRM assignment assembly

The staged assignment issuer, gateway, native transport and independent result
validator are not a configured live service. Keep the production route unavailable
until its complete host assembly is present. Existing native identity, task import,
shared sign-in and ordinary dataset permission are separate from this capability.

## Composition still required

1. CRM must expose the internal assignment issuer through a fixed protected source
   adapter. Authenticate the existing owner/source connection, check current native
   workspace membership and explicit AI assignment, task/project revisions, current
   Roles authorization and approved workflow version in the transaction. Verify
   the exact current Workflows run/lease before accepting a result. Keep the
   source signing key on CRM. Do not use the source eligibility endpoint as action
   authority or create assignments from arbitrary caller IDs.
2. The MCP production runtime must construct the assignment gateway from an exact
   owner-approved actor/connection/workflow/assignment binding. Its resolver must
   independently recheck current Roles/source permission, connection revocation,
   credential identity and expiry. The resolver is called before and after each
   protected dispatch; retain one configured source adapter identity. A changed
   binding blocks the reply, including a reply to a potentially committed write.
   Reconcile only the original operation with fresh permission. Never retry the
   source write inside the gateway.
3. The normal native launcher must construct the broker from an already enrolled,
   purpose-correct device and protected existing credentials. Bind source/action
   permissions, reviewed workflow revision, pinned model, independent validator,
   finite request budget and source/model/runtime cost admission. Missing providers
   must keep the capability unavailable without a vault read or network request.
   Caller/model data must not create this configuration.
4. Verify a real eligible assignment through intake, local generation, independent
   source validation, revision-safe CRM result and central completion, followed by
   a separately authorized successor if in scope. Verify multiple deliveries,
   original-operation recovery and denial after revocation. Synthetic results
   cannot stand in for this proof.

The original nine CryptoDirectory retry budgets remain exhausted. Do not create
new retry IDs, clear counters or use them as fixtures. Enrollment, grants and
controller signatures remain on their normal owner-controlled approval paths.
Existing release spending approval does not authorize live runtime usage.

## Current implementation checkpoint

The gateway now pins the connection fingerprint and re-resolves it before and
after source and Workflows calls. Local tests cover revocation during assignment
lookup, protected task read, committed-result reply and Workflows reply;
replacement of each scope field; and original-operation receipt reconciliation.
These checks prevent stale connection use. They are not proof of a configured
production issuer, current Roles decisions or live acceptance.
