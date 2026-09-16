-- Applied by the dedicated migration identity, never the runtime identity.
CREATE SCHEMA IF NOT EXISTS mcp;
CREATE TABLE IF NOT EXISTS mcp.bittrees_mcp_state (
  id integer PRIMARY KEY CHECK (id = 1),
  body jsonb NOT NULL CHECK (body->>'version' = '1')
);
INSERT INTO mcp.bittrees_mcp_state(id,body)
VALUES (1,'{"version":1,"profiles":{},"rules":{},"automations":{},"runs":{},"audit":[]}')
ON CONFLICT DO NOTHING;
