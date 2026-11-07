import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createHash,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import {
  configuredCrmAssignments,
  crmAssignmentOperation,
  crmAssignmentParameters,
} from "../src/service/crm-assignment-runtime.mjs";
import { RolesConsumer } from "../src/service/roles-consumer.mjs";
import {
  canonical,
  decisionMessage,
  requestMessage,
} from "../src/service/roles-proof.mjs";
const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");
function fixture() {
  const now = Date.now(),
    keys = generateKeyPairSync("ed25519"),
    credential = generateKeyPairSync("ed25519");
  let time = now,
    after = () => {},
    calls = [],
    decisions = 0;
  const pem = (k) => k.export({ type: "spki", format: "pem" }).toString();
  const a = {
    assignmentId: randomUUID(),
    taskId: randomUUID(),
    taskRevision: 3,
    projectId: randomUUID(),
    workflowId: "review",
    workflowRevision: 2,
    principal: "agent:" + randomUUID(),
  };
  const actor = {
    audience: "https://mcp.bittrees.org",
    expiresAt: now + 60000,
    permissions: ["workflow:execute"],
    projectIds: ["crm", "workflow"],
    tokenHash: "a".repeat(64),
    tenant: "tenant",
    subject: "device",
    rolesAuthorityBinding: "binding",
  };
  const c = {
    version: 1,
    actorTokenHash: "a".repeat(64),
    tenant: "tenant",
    subject: "device",
    binding: "binding",
    connectionId: randomUUID(),
    ownerId: randomUUID(),
    datasetId: randomUUID(),
    sourceWorkspace: randomUUID(),
    principal: a.principal,
    credentialId: createHash("sha256")
      .update(pem(credential.publicKey))
      .digest("hex"),
    runtimeLeaseId: randomUUID(),
    runtimeBindingDigest: "b".repeat(64),
    workspace: "workspace",
    approvedAt: now - 1,
    expiresAt: now + 60000,
    completeTask: true,
    assignments: [a],
    sourceToken: "c".repeat(64),
    workflowToken: "w".repeat(64),
  };
  const env = {
    MCP_CRM_ASSIGNMENTS_ENABLED: "true",
    MCP_CRM_ASSIGNMENTS_JSON: JSON.stringify([c]),
  };
  const binding = {
    id: c.binding,
    actorTokenHash: c.actorTokenHash,
    tenant: c.tenant,
    subject: c.subject,
    workspace: c.workspace,
    principal: c.principal,
    credentialId: c.credentialId,
    leaseId: c.runtimeLeaseId,
    runtimeBindingDigest: c.runtimeBindingDigest,
    publicKey: pem(credential.publicKey),
  };
  const roles = {
    bindings: [binding],
    decisionKey: pem(keys.publicKey),
    execute: async (_actor, _binding, scope, parameters, effect) => {
      decisions++;
      const request = {
        version: 1,
        source: "mcp.bittrees.org",
        audience: "https://roles.bittrees.org/api/authority/mcp-decision",
        requestId: randomUUID(),
        operationId: scope.operationId,
        issuedAt: time,
        parametersDigest: digest(parameters),
        principal: c.principal,
        credentialId: c.credentialId,
        leaseId: c.runtimeLeaseId,
        runtimeBindingDigest: c.runtimeBindingDigest,
        delegationId: null,
        tenant: c.tenant,
        workspace: c.workspace,
        project: scope.project,
        resource: scope.resource,
        action: scope.action,
        stage: scope.stage,
      };
      const decision = {
        version: 1,
        issuer: "https://roles.bittrees.org",
        audience: "https://mcp.bittrees.org",
        request,
        checkedAt: time,
        expiresAt: time + 5000,
        requiresSourceAuthorization: true,
        allowed: true,
      };
      return effect(parameters, {
        decision,
        signature: sign(
          null,
          Buffer.from(decisionMessage(decision)),
          keys.privateKey,
        ).toString("base64"),
      });
    },
  };
  const ref = {
    runId: randomUUID(),
    leaseId: randomUUID(),
    crmOperationId: randomUUID(),
  };
  const request = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    after(calls.at(-1));
    if (url.endsWith("/crm-result-lease"))
      return Response.json({
        proof: { state: body.operation === "write" ? "running" : "completed" },
        signature: "source-signed",
      });
    if (url.startsWith("https://crm.bittrees.org/"))
      return Response.json({
        assignment: a,
        envelope: { proof: "crm-signed" },
        instruction: "private",
        receipt: {
          operationId: ref.crmOperationId,
          resultDigest:
            body.operation.kind === "write"
              ? digest(body.operation.result)
              : "d".repeat(64),
        },
        task: { status: "Done", version: 4 },
      });
    return Response.json({
      runId: ref.runId,
      leaseId: ref.leaseId,
      confirmed: true,
    });
  };
  const handler = configuredCrmAssignments({
    env,
    rolesConsumer: roles,
    request,
    clock: () => time,
  });
  return {
    a,
    actor,
    c,
    env,
    roles,
    calls,
    ref,
    credential,
    keys,
    call: (o) => handler(actor, { assignmentId: a.assignmentId, ...o }),
    save: () => (env.MCP_CRM_ASSIGNMENTS_JSON = JSON.stringify([c])),
    after: (f) => (after = f),
    expire: () => (time += 6000),
    decisions: () => decisions,
  };
}
test("disabled or missing assembly does not inspect configuration or contact sources", () => {
  assert.equal(
    configuredCrmAssignments({
      env: { MCP_CRM_ASSIGNMENTS_JSON: "invalid" },
      request: () => {
        throw Error("network");
      },
    }),
    undefined,
  );
});
test("strict typed operations reject caller URLs, tokens, extra fields and bad result text", () => {
  for (const v of [
    { kind: "task", assignmentId: randomUUID(), url: "https://evil.invalid" },
    { kind: "receipt", assignmentId: randomUUID() },
    {
      kind: "write",
      assignmentId: randomUUID(),
      runId: randomUUID(),
      leaseId: randomUUID(),
      crmOperationId: randomUUID(),
      result: { summary: " hi" },
    },
  ])
    assert.throws(() => crmAssignmentOperation(v));
});
test("one fresh signed decision wraps source intake and central intake under exact fixed custody", async () => {
  const f = fixture();
  await f.call({ kind: "intake" });
  assert.equal(f.decisions(), 1);
  assert.equal(f.calls.length, 2);
  assert.equal(
    f.calls[0].url,
    "https://crm.bittrees.org/api/integrations/workflow-assignments",
  );
  assert.equal(
    f.calls[0].options.headers.authorization,
    "Bearer " + f.c.sourceToken,
  );
  assert.equal(
    f.calls[1].options.headers.authorization,
    "Bearer " + f.c.workflowToken,
  );
  assert.equal(
    f.calls[0].options.headers["x-bittrees-roles-decision"],
    f.calls[1].options.headers["x-bittrees-roles-decision"],
  );
  assert.equal(f.calls[1].options.redirect, "error");
  assert.equal(f.calls[0].body.kind, "assignment");
  assert.deepEqual(f.calls[1].body, { assignment: f.a });
});
test("writes request actual running lease before one source result and never repeat a mutation", async () => {
  const f = fixture();
  const result = await f.call({
    kind: "write",
    ...f.ref,
    result: { summary: "candidate" },
  });
  assert.equal(result.operationId, f.ref.crmOperationId);
  assert.equal(f.decisions(), 1);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.endsWith("/crm-result-lease"));
  assert.equal(f.calls[0].body.operation, "write");
  assert.equal(f.calls[1].body.kind, "result");
  assert.ok(f.calls[1].options.headers["x-bittrees-workflow-lease"]);
  assert.equal(f.calls[0].body.resultDigest, digest({ summary: "candidate" }));
});
test("finalization and read recovery use the original completion ID with distinct source operations", async () => {
  const f = fixture(),
    id = randomUUID(),
    input = { ...f.ref, operationId: id, resultDigest: "d".repeat(64) };
  await f.call({ kind: "finalize", ...input, expiresAt: Date.now() + 10000 });
  await f.call({ kind: "finalization", ...input });
  assert.deepEqual(
    f.calls.map((c) => c.body.kind ?? c.body.operation),
    ["complete", "finalize", "completion", "finalization"],
  );
  assert.ok(
    f.calls.every(
      (c) => (c.body.operationId ?? c.body.operation.operationId) === id,
    ),
  );
  assert.equal(
    f.calls.filter((c) => c.url.includes("/completions/")).length,
    0,
  );
});
test("source status approval, runtime identity, scope and actor changes deny before private dispatch", async () => {
  for (const mutate of [
    (f) => (f.c.completeTask = false),
    (f) => (f.roles.bindings[0].leaseId = randomUUID()),
    (f) => (f.c.assignments[0].principal = "agent:" + randomUUID()),
    (f) => (f.actor.projectIds = ["crm"]),
    (f) => (f.c.expiresAt = Date.now() - 1),
  ]) {
    const f = fixture();
    mutate(f);
    f.save();
    await assert.rejects(
      f.call({
        kind: "finalization",
        ...f.ref,
        operationId: randomUUID(),
        resultDigest: "d".repeat(64),
      }),
      { statusCode: 403 },
    );
    assert.equal(f.calls.length, 0);
  }
});
test("revocation or expiry during a committed reply holds without retry; receipt keeps original IDs", async () => {
  for (const expire of [false, true]) {
    const f = fixture();
    f.after((call) => {
      if (call.url.startsWith("https://crm.bittrees.org/")) {
        if (expire) f.expire();
        else f.env.MCP_CRM_ASSIGNMENTS_JSON = "[]";
      }
    });
    await assert.rejects(
      f.call({ kind: "write", ...f.ref, result: { summary: "candidate" } }),
    );
    assert.equal(f.calls.length, 2);
    assert.equal(
      f.calls[1].body.operation.crmOperationId,
      f.ref.crmOperationId,
    );
  }
  const f = fixture();
  await f.call({ kind: "receipt", ...f.ref });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.operation.crmOperationId, f.ref.crmOperationId);
});
test("central completion checks original source receipt before fixed completion route", async () => {
  const f = fixture(),
    operationId = randomUUID();
  await f.call({
    kind: "complete",
    ...f.ref,
    operationId,
    resultDigest: "d".repeat(64),
    expiresAt: Date.now() + 1000,
  });
  assert.equal(f.decisions(), 1);
  assert.equal(f.calls[1].options.method, "PUT");
  assert.equal(f.calls[1].options.headers["Idempotency-Key"], operationId);
  assert.equal(f.calls[1].body.crmOperationId, f.ref.crmOperationId);
  const g = fixture();
  await assert.rejects(
    g.call({
      kind: "completion",
      ...g.ref,
      operationId,
      resultDigest: "e".repeat(64),
    }),
    { statusCode: 409 },
  );
  assert.equal(g.calls.length, 1);
});
test("authority parameter contract separates result write/read and completion methods", () => {
  const f = fixture();
  for (const kind of [
    "intake",
    "claim",
    "task",
    "write",
    "receipt",
    "complete",
    "completion",
  ]) {
    const o = {
      kind,
      assignmentId: f.a.assignmentId,
      ...f.ref,
      operationId: randomUUID(),
      result: { summary: "candidate" },
      resultDigest: "d".repeat(64),
    };
    const p = crmAssignmentParameters(f.a, f.c.connectionId, o);
    assert.equal(p.parameters.arguments.assignmentDigest, digest(f.a));
    if (kind === "write")
      assert.equal(p.parameters.arguments.resultDigest, digest(o.result));
    if (kind === "receipt")
      assert.equal(p.parameters.arguments.resultDigest, undefined);
    if (["complete", "completion"].includes(kind))
      assert.equal(
        p.parameters.arguments.method,
        kind === "complete" ? "PUT" : "GET",
      );
  }
});

test("local authority replacement or feature disablement during a reply denies release", async () => {
  for (const change of [
    (f) => (f.roles.bindings[0].publicKey = "replaced"),
    (f) => (f.roles.bindings[0].permissions = []),
    (f) => (f.env.MCP_CRM_ASSIGNMENTS_ENABLED = "false"),
  ]) {
    const f = fixture();
    f.after(() => change(f));
    await assert.rejects(f.call({ kind: "task" }));
    assert.equal(f.calls.length, 1);
  }
});

test("actual Roles consumer challenges then resumes an exact native read with one decision", async () => {
  const f = fixture(),
    gateway = generateKeyPairSync("ed25519");
  let decisions = 0;
  f.roles.bindings[0].permissions = [
    {
      project: "workflow",
      resource: "workflow:" + f.a.workflowId,
      action: "workflow:claim",
    },
  ];
  const consumer = new RolesConsumer({
    bindings: f.roles.bindings,
    decisionKey: f.roles.decisionKey,
    gatewayKey: gateway.privateKey.export({ type: "pkcs8", format: "pem" }),
    request: async (url, options) => {
      assert.equal(
        url,
        "https://roles.bittrees.org/api/authority/mcp-decision",
      );
      const p = JSON.parse(options.body);
      assert.ok(
        verify(
          null,
          Buffer.from(requestMessage(p.request)),
          gateway.publicKey,
          Buffer.from(p.signature, "base64"),
        ),
      );
      assert.ok(
        verify(
          null,
          Buffer.from(requestMessage(p.request)),
          f.credential.publicKey,
          Buffer.from(p.principalSignature, "base64"),
        ),
      );
      assert.ok(p.runtimeAttestation);
      decisions++;
      const d = {
        version: 1,
        issuer: "https://roles.bittrees.org",
        audience: "https://mcp.bittrees.org",
        request: p.request,
        checkedAt: Date.now(),
        expiresAt: Date.now() + 5000,
        requiresSourceAuthorization: true,
        allowed: true,
      };
      return Response.json({
        decision: d,
        signature: sign(
          null,
          Buffer.from(decisionMessage(d)),
          f.keys.privateKey,
        ).toString("base64"),
      });
    },
  });
  f.roles.execute = consumer.execute.bind(consumer);
  let challenge;
  await assert.rejects(f.call({ kind: "task" }), (e) => {
    challenge = e.deviceChallenge;
    return e.statusCode === 428;
  });
  assert.equal(f.calls.length, 0);
  assert.equal(decisions, 0);
  f.actor.rolesProof = {
    request: challenge.request,
    signature: sign(
      null,
      Buffer.from(requestMessage(challenge.request)),
      f.credential.privateKey,
    ).toString("base64"),
    attestation: {
      request: { fixture: true },
      signature: "fixture-attestation",
    },
  };
  const reply = await f.call({ kind: "task" });
  assert.equal(reply.instruction, "private");
  assert.equal(decisions, 1);
  assert.equal(f.calls.length, 1);
  // Replacing the requested action cannot reuse the read signature.
  await assert.rejects(f.call({ kind: "intake" }), { statusCode: 428 });
  assert.equal(f.calls.length, 1);
});

test("model lease admission reads current Workflows state without claim, renewal or source mutation", async () => {
  const f = fixture();
  await f.call({ kind: "lease", ...f.ref, resultDigest: "d".repeat(64) });
  assert.equal(f.decisions(), 1);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith("/crm-result-lease"));
  assert.equal(f.calls[0].body.operation, "receipt");
  assert.equal(f.calls[0].body.crmOperationId, f.ref.crmOperationId);
});
