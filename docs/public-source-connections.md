# Public reads and protected app connections

The central directory describes reviewed source adapters. It does not forward a caller's credentials, execute listed app functions, create grants, or change a source's access controls.

Public read-only adapters can declare `setup: {"authentication":"none"}` only when the gateway policy pins that exact setup, endpoint, transport, operation and function names. Such routes accept only the reviewed `read` operations. Adding a write operation or an unreviewed read function is rejected, retaining the last valid source metadata until review. Protected routes cannot become public by changing a manifest.

Public HTTP MCP sources use their own `initialize`, `tools/list` and `tools/call` interface. Their listed tools return bounded projections of existing public data. Public access does not convey private account access, execution rights, CRM import authority, or approval of linked content. Source-defined pagination, revision checks, output limits and cost conditions continue to apply.

A public local adapter uses the reviewed `node` command and script from its source checkout. Its HTTPS endpoint identifies the fixed public data source; it is not a remote MCP server. Run the reviewed local adapter to discover its current schemas. Listing a command never launches it automatically.

Protected connections continue to require the source's current credentials, owner consent and any MFA, role, device or Safe checks. In particular, Mail selected-message access is separate from public Agent/Gov data. Neither the central discovery connection nor public read configuration provides a Mail credential or authorizes a mailbox selection.

Agent task-feed reads retain source IDs, fingerprints, revision and omission/conflict policy. A read result is not consent to import or delete a CRM task. CryptoDirectory listings are untrusted third-party data; a verified listing is not a Bittrees integration, security approval or authority to visit another site.

Register implemented source contracts first; publish function metadata only from a reviewed, released source revision. A source release and a central directory release have separate owners and verification evidence. No new polling schedule or integration activation is needed for descriptive manifest reconciliation.
