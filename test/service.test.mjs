import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { FileStore, PostgresStore } from "../src/service/store.mjs";
import { Engine } from "../src/service/engine.mjs";
import { createMcpHandler } from "../src/service/http.mjs";
import { selectionFromParams } from "../src/ecosystem/catalog.mjs";
const token = "test-service-token-no-production-authority";
const actor = {
  tenant: "test-a",
  subject: "operator",
  audience: "https://mcp.bittrees.org",
  expiresAt: Date.now() + 3600000,
  projectIds: ["agent", "crm"],
  permissions: [
    "catalog:read",
    "profile:read",
    "profile:write",
    "rule:write",
    "automation:write",
    "automation:read",
    "automation:execute",
  ],
  tokenHash: createHash("sha256").update(token).digest("hex"),
};
const selection = () =>
  selectionFromParams(new URLSearchParams("mode=selected&projects=agent"));
async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bittrees-mcp-"));
  const store = new FileStore(join(dir, "state.json"));
  return {
    store,
    engine: new Engine(store, options),
    clean: () => rm(dir, { recursive: true, force: true }),
  };
}
async function configure(engine, trigger = { type: "manual" }) {
  const profile = await engine.act(actor, "profile.create", {
    selection: selection(),
  });
  const rule = await engine.act(actor, "rule.create", {
    projectIds: ["agent"],
    tools: ["get_bittrees_project"],
    enabled: true,
  });
  const automation = await engine.act(actor, "automation.create", {
    profileId: profile.id,
    ruleId: rule.id,
    projectId: "agent",
    tool: "get_bittrees_project",
    trigger,
  });
  return { profile, rule, automation };
}
test("standalone profile → context → rules and durable execution history", async () => {
  const fixture = await setup();
  const server = createServer(
    createMcpHandler({
      engine: fixture.engine,
      credentials: [actor],
      workerToken: "test-worker",
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, auth = token) => {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const config = await call(
      "/connection.json?mode=selected&projects=agent",
      null,
      null,
    );
    assert.match(
      config.data.mcpServers.bittrees.url,
      /^https:\/\/mcp.bittrees.org\/mcp/,
    );
    const p = await call("/v1/profiles", { selection: selection() });
    assert.equal(p.status, 200);
    const endpoint = `/profiles/${p.data.id}/mcp`;
    const result = await call(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_bittrees_project",
        arguments: { projectId: "agent" },
      },
    });
    assert.equal(result.data.result.structuredContent.project.id, "agent");
    assert.equal(
      (
        await call(endpoint, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "get_bittrees_project",
            arguments: { projectId: "crm" },
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          endpoint,
          { jsonrpc: "2.0", id: 3, method: "tools/list" },
          null,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(endpoint + "?mode=ecosystem", {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
        })
      ).status,
      400,
    );
    const { automation } = await configure(fixture.engine);
    assert.equal(automation.status, "paused");
    assert.equal(
      (
        await call("/v1/automations/trigger", {
          id: automation.id,
          idempotencyKey: "event-1",
        })
      ).status,
      409,
    );
    await call("/v1/automations/resume", { id: automation.id });
    const first = await call("/v1/automations/trigger", {
      id: automation.id,
      idempotencyKey: "event-1",
    });
    const duplicate = await call("/v1/automations/trigger", {
      id: automation.id,
      idempotencyKey: "event-1",
    });
    assert.equal(first.data.id, duplicate.data.id);
    assert.equal((await call("/internal/tick", {}, "test-worker")).status, 200);
    const history = await call("/v1/history");
    assert.equal(history.data.runs.length, 1);
    assert.equal(history.data.runs[0].status, "succeeded");
    assert.equal(history.data.runs[0].attempts[0].ruleVersion, 1);
    const restarted = new Engine(new FileStore(fixture.store.path));
    assert.equal(
      (await restarted.act(actor, "history")).runs[0].status,
      "succeeded",
    );
    assert.equal(
      (
        await call(
          "/mcp",
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          "unknown-service-token",
        )
      ).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await fixture.clean();
  }
});
test("tenant isolation, revoked authority and updated rules deny without leaking history", async () => {
  const f = await setup();
  try {
    const { automation, rule } = await configure(f.engine);
    const other = { ...actor, tenant: "test-b" };
    assert.deepEqual((await f.engine.act(other, "history")).runs, []);
    await assert.rejects(
      () => f.engine.act(other, "resume", { id: automation.id }),
      /not found/,
    );
    await f.engine.act(actor, "resume", { id: automation.id });
    await f.engine.act(actor, "enqueue", {
      id: automation.id,
      idempotencyKey: "deny",
    });
    await f.engine.act(actor, "rule.update", {
      id: rule.id,
      expectedVersion: 1,
      projectIds: ["agent"],
      tools: ["get_bittrees_project"],
      enabled: false,
    });
    await f.engine.tick(() => actor);
    let run = (await f.engine.act(actor, "history")).runs[0];
    assert.equal(run.status, "denied");
    assert.equal(run.attempts[0].ruleVersion, 2);
    assert.equal(run.result, undefined);
    await f.engine.act(actor, "enqueue", {
      id: automation.id,
      idempotencyKey: "revoked",
    });
    await f.engine.tick(() => null);
    assert.equal(
      (await f.engine.act(actor, "history")).runs[1].status,
      "denied",
    );
    await assert.rejects(
      () => f.engine.act({ ...actor, expiresAt: 0 }, "history"),
      /denied/,
    );
    await assert.rejects(
      () =>
        f.engine.act(actor, "rule.create", {
          projectIds: ["agent"],
          tools: ["send_message"],
          enabled: true,
        }),
      /implemented/,
    );
  } finally {
    await f.clean();
  }
});
test("bounded retries persist, pause holds work, cancellation prevents further attempts", async () => {
  let now = Date.now(),
    calls = 0;
  const f = await setup({
    clock: () => now,
    adapter: () => {
      calls++;
      throw Object.assign(new Error("upstream secret must not leak"), {
        transient: true,
      });
    },
  });
  try {
    const { automation } = await configure(f.engine);
    await f.engine.act(actor, "resume", { id: automation.id });
    await f.engine.act(actor, "enqueue", {
      id: automation.id,
      idempotencyKey: "retry",
    });
    await f.engine.tick(() => actor);
    assert.equal(calls, 1);
    await f.engine.act(actor, "pause", { id: automation.id });
    now += 10000;
    await f.engine.tick(() => actor);
    assert.equal(calls, 1);
    await f.engine.act(actor, "resume", { id: automation.id });
    await f.engine.tick(() => actor);
    now += 10000;
    await f.engine.tick(() => actor);
    now += 10000;
    await f.engine.tick(() => actor);
    assert.equal(calls, 3);
    let history = await f.engine.act(actor, "history");
    assert.equal(history.runs[0].status, "failed");
    assert.doesNotMatch(JSON.stringify(history), /upstream secret/);
    await f.engine.act(actor, "enqueue", {
      id: automation.id,
      idempotencyKey: "cancel",
    });
    await f.engine.act(actor, "cancel", { id: automation.id });
    await f.engine.tick(() => actor);
    assert.equal(calls, 3);
    history = await f.engine.act(actor, "history");
    assert.equal(history.runs[1].status, "cancelled");
  } finally {
    await f.clean();
  }
});
test("scheduled triggers coalesce missed intervals and duplicate events are idempotent", async () => {
  let now = Date.now();
  const f = await setup({ clock: () => now });
  try {
    const { automation } = await configure(f.engine, {
      type: "schedule",
      intervalSeconds: 60,
    });
    await f.engine.act(actor, "resume", { id: automation.id });
    await f.engine.tick(() => actor);
    assert.equal((await f.engine.act(actor, "history")).runs.length, 0);
    now += 600000;
    await f.engine.tick(() => actor);
    await f.engine.tick(() => actor);
    assert.equal((await f.engine.act(actor, "history")).runs.length, 1);
    const event = await configure(f.engine, {
      type: "event",
      event: "reviewed-update",
    });
    await f.engine.act(actor, "resume", { id: event.automation.id });
    await assert.rejects(
      () =>
        f.engine.act(actor, "enqueue", {
          id: event.automation.id,
          idempotencyKey: "e1",
          event: "wrong",
        }),
      /match/,
    );
    await f.engine.act(actor, "enqueue", {
      id: event.automation.id,
      idempotencyKey: "e1",
      event: "reviewed-update",
    });
    await f.engine.act(actor, "enqueue", {
      id: event.automation.id,
      idempotencyKey: "e1",
      event: "reviewed-update",
    });
    await f.engine.tick(() => actor);
    assert.equal((await f.engine.act(actor, "history")).runs.length, 2);
  } finally {
    await f.clean();
  }
});
test(
  "PostgreSQL transactions preserve state across instances and roll back failures",
  { skip: !process.env.MCP_TEST_DATABASE_URL },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.MCP_TEST_DATABASE_URL,
    });
    const store = new PostgresStore(pool);
    try {
      await store.initialize();
      await store.transaction((s) => {
        Object.assign(s, {
          profiles: {},
          rules: {},
          automations: {},
          runs: {},
          audit: [],
        });
      });
      const engine = new Engine(store);
      const { automation } = await configure(engine);
      assert.equal(
        (await new Engine(new PostgresStore(pool)).act(actor, "history"))
          .automations[0].id,
        automation.id,
      );
      await assert.rejects(
        () =>
          store.transaction((s) => {
            s.audit.push({ bad: true });
            throw new Error("rollback");
          }),
        /rollback/,
      );
      assert.ok(!(await engine.act(actor, "history")).audit.some((a) => a.bad));
    } finally {
      await pool.end();
    }
  },
);

test("MCP management tools preserve tenant and selected-project boundaries", async () => {
  const f = await setup();
  const { automation } = await configure(f.engine);
  const server = createServer(
    createMcpHandler({ engine: f.engine, credentials: [actor] }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(project, name, args = {}) {
    const response = await fetch(
      `${base}/mcp?mode=selected&projects=${project}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      },
    );
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal(
      (await call("crm", "automation_resume", { id: automation.id })).status,
      403,
    );
    assert.equal(
      (await call("agent", "automation_resume", { id: automation.id })).status,
      200,
    );
    await call("agent", "automation_trigger", {
      id: automation.id,
      idempotencyKey: "mcp-event",
    });
    await f.engine.tick(() => actor);
    const hidden = await call("crm", "automation_history");
    assert.deepEqual(hidden.data.result.structuredContent, {
      automations: [],
      runs: [],
      audit: [],
    });
    const visible = await call("agent", "automation_history");
    assert.equal(
      visible.data.result.structuredContent.runs[0].status,
      "succeeded",
    );
    const schema = await fetch(base + "/schemas/selection.schema.json");
    assert.equal(schema.status, 200);
    assert.equal((await schema.json()).type, "object");
  } finally {
    await new Promise((r) => server.close(r));
    await f.clean();
  }
});

test('friendly setup is atomic, named, paused, scoped and retry-safe', async () => {
 const f=await setup();
 try {
  const input={name:'Daily Agent update',projectId:'agent',intervalSeconds:86400,idempotencyKey:'setup-test-1'};
  const record=await f.engine.act(actor,'automation.setup',input);
  assert.equal(record.name,input.name);assert.equal(record.status,'paused');
  const again=await f.engine.act(actor,'automation.setup',input);assert.equal(again.id,record.id);
  let history=await f.engine.act(actor,'history');assert.equal(history.profiles.length,1);assert.equal(history.rules.length,1);assert.equal(history.automations.length,1);
  assert.equal(history.rules[0].name,'Daily Agent update permission');
  await assert.rejects(f.engine.act(actor,'automation.setup',{...input,name:'Different name'}),/already been used/);
  await assert.rejects(f.engine.act({...actor,permissions:actor.permissions.filter(p=>p!=='rule:write')},'automation.setup',{...input,idempotencyKey:'no-rule'}),/Permission denied/);
  await assert.rejects(f.engine.act(actor,'automation.setup',{...input,idempotencyKey:'wrong-project',projectId:'bittrees-capital'}));
  await assert.rejects(f.engine.act(actor,'automation.setup',{...input,idempotencyKey:'wrong-interval',intervalSeconds:1}),/Choose manual/);
  history=await f.engine.act(actor,'history');assert.equal(history.automations.length,1);assert.equal(history.rules.length,1);assert.equal(history.profiles.length,1);
  await f.engine.act(actor,'resume',{id:record.id});await f.engine.act(actor,'enqueue',{id:record.id,idempotencyKey:'friendly-run'});await f.engine.tick(()=>actor);
  assert.equal((await f.engine.act(actor,'history')).runs[0].status,'succeeded');
  await f.engine.act(actor,'rule.update',{id:record.ruleId,expectedVersion:1,projectIds:['agent'],tools:['get_bittrees_project'],enabled:false});
  const updated=(await f.engine.act(actor,'history')).rules[0];assert.equal(updated.name,'Daily Agent update permission');assert.equal(updated.versions.length,2);
 }finally{await f.clean();}
});
