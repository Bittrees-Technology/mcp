-- Dedicated migration identity only. Existing public automation records survive.
BEGIN;
LOCK TABLE mcp.bittrees_mcp_state IN ACCESS EXCLUSIVE MODE;
ALTER TABLE mcp.bittrees_mcp_state DROP CONSTRAINT IF EXISTS bittrees_mcp_state_body_check;
UPDATE mcp.bittrees_mcp_state SET body = body ||
  '{"version":2,"aiDispatchVersion":1,"aiConnections":{},"aiDispatchOutbox":{}}'::jsonb
WHERE body->>'version'='1';
ALTER TABLE mcp.bittrees_mcp_state DROP CONSTRAINT IF EXISTS bittrees_mcp_state_format_check;
ALTER TABLE mcp.bittrees_mcp_state ADD CONSTRAINT bittrees_mcp_state_format_check
  CHECK ((body->>'version'='2' AND body->>'aiDispatchVersion'='1'
    AND jsonb_typeof(body->'aiConnections')='object'
    AND jsonb_typeof(body->'aiDispatchOutbox')='object') IS TRUE);
CREATE OR REPLACE FUNCTION mcp.require_current_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('bittrees.mcp_writer_version',true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'MCP writer upgrade required';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS require_current_writer ON mcp.bittrees_mcp_state;
CREATE TRIGGER require_current_writer BEFORE UPDATE OR DELETE ON mcp.bittrees_mcp_state
FOR EACH ROW EXECUTE FUNCTION mcp.require_current_writer();
COMMIT;
