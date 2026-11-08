# Live CRM assignment assembly

The staged assignment issuer, gateway, native transport and independent result
validator are not a configured live service. Keep the production route unavailable
until its complete host assembly is present. Existing native identity, task import,
shared sign-in and ordinary dataset permission are separate from this capability.

## Composition and remaining acceptance

1. CRM now implements a fixed protected source route with current dataset/project
   consent, owner/workspace/record access, exact assignment revisions, Roles
   decisions and independently signed running/completed Workflows proofs. Its
   explicit schema migration and feature remain unactivated. Deployment and real
   configured source acceptance remain required.
2. `configuredCrmAssignments` now constructs the production MCP handler. It is
   default off unless `MCP_CRM_ASSIGNMENTS_ENABLED=true`. The server-only
   `MCP_CRM_ASSIGNMENTS_JSON` contains exact actor token hash/tenant/subject,
   Roles binding, device credential/runtime lease/digest, connection, source
   owner/dataset/workspace, reviewed assignment tuples, fifteen-minute approval,
   separate completeTask approval, and existing source/Workflows transport
   credentials. No request supplies these fields or an endpoint URL. The actual
   Roles binding must be device-held and purpose-correct; a private server-side
   principal key is rejected. Configuration is admission scope, never a grant.

   One fresh native Roles decision wraps each typed operation. Source intake and
   task reads precede central intake/claim; writes require an independently signed
   current Workflows lease. Central completion verifies the original source
   receipt first. Separately approved finalize/finalization calls obtain completed
   lease proofs and perform source status write/read, without repeating central
   completion. GET reconciliation retains the same original IDs and cannot issue
   a write. Current configuration, local Roles binding and signed decision expiry
   are checked before and after every fixed TLS dispatch. No write retry occurs
   inside the handler. Missing/revoked/changed bindings fail closed.
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

The host assembly tests exercise actual RolesConsumer native challenge/resume and
signed decision verification, fixed endpoint/custody separation, intake/write/
central completion/finalization, parameter boundaries, approval loss, local Roles
binding replacement and expiry after a potentially committed reply. The local
fixture uses synthetic signers and responses; it is not live source acceptance.

The typed `lease` operation obtains only the existing signed read-only Workflows
result-lease proof under exact `workflow_crm_result_read` Roles parameters. It
retains the original assignment/run/lease/future CRM result-operation ID and
expected result digest. No source result is read or written, claim replayed,
lease renewed or job completed. The native helper separately checks current CRM
source input before using the proof for model-start admission. A lease proof is
not a CRM source grant, model permission or independent work validation.
