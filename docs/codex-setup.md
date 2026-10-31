# Codex connections

The public ecosystem connection uses Streamable HTTP:

```sh
codex mcp add bittrees --url 'https://mcp.bittrees.org/mcp?mode=ecosystem&profileVersion=1&profileRevision=1'
```

This discovers approved project context and source-owned function metadata. A listed function does not inherit a source credential or become executable through this anonymous connection. Re-list tools in a newly loaded Codex session after configuration changes.

## Existing News credential on macOS

`integrations/news-keychain-mcp.mjs` is an optional local stdio transport for an existing News bearer credential. It reads the generic-password Keychain item with service `org.bittrees.codex.news` and account `bittrees_news`. An authorized operator must put the existing credential there using secure input, or use Keychain Access. Never put a token in a shell argument, transcript, repository, tool argument, or the `bearer_token_env_var` configuration field: that field expects an environment variable name.

Install an independent copy of this reviewed adapter at a stable local path, then configure it:

```sh
codex mcp add bittrees_news -- node /absolute/stable/path/news-keychain-mcp.mjs
```

The adapter only forwards MCP protocol requests to `https://news.bittrees.org/api/mcp`, refuses redirects and unbounded responses, and does not create or rotate credentials. The source continues to check expiry, revocation, owner and read/curate/publish scopes. Normal source and publication approvals still apply. No network request is made simply by installing the file or configuration; a client's initialization or tool-list request does contact News.

Keychain storage and offline transport fixtures establish local setup, not live token validity or runtime cost coverage. Before a live test, verify the current source authorization and applicable included usage or explicit runtime spending approval. A routine deployment exception is not a general runtime allowance.

## Directory maintenance

The allowlisted tool-manifest workflow validates source identity, reviewed endpoints and setup metadata before publication. A source returning a valid empty manifest declares no reviewed adapter; it does not mean its website or session-based APIs are unavailable. Readiness tests use controlled failure/recovery fixtures so a source's legitimate recovery cannot permanently block future directory updates.
