# AI marketplace source connections

This opt-in gateway routes AI's reviewed proposals to CRM and Mercado using fixed HTTPS endpoints. Source credentials stay in MCP's server configuration. Public catalog discovery never grants these tools.

Configure `MCP_SOURCE_CONNECTIONS_JSON` as an array of `{tenant,subject,actorTokenHash,source,token,expiresAt}`. `source` is `crm` or `mercado`; expiry is Unix milliseconds. Each entry binds to an existing service actor AND its current token hash, so service-token rotation invalidates old bindings. The actor needs `catalog:read`, `sources:propose`, permitted project IDs and the corresponding project selection. Removing the connection revokes routing; source apps independently enforce their grants.

Tools: `source_crm_brief`, `source_crm_preview`, `source_crm_status`, `source_mercado_preview`, `source_mercado_status`. No arbitrary URL, bearer, publication or approval parameters are accepted. Source endpoints validate full payloads and operation IDs. Requests time out after 20 seconds and reject redirects. Never generate a new operation ID after a lost response.

Mercado's catalog entry is approved for this user-requested integration, based on the checked-out Bittrees-Technology/mercado repository and its README. Source proposal access remains separately opt-in. This does not mark either app's general private API as implemented.

Deploy both source-app changes first. AI's coordinator has a separate migration, owner-bound MCP credential and bounded worker. No source credentials are installed by this commit.
