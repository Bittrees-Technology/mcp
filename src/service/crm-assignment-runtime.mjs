import { createHash, randomUUID } from "node:crypto";
import { authorize, fail } from "./engine.mjs";
import { canonical, verifyDecision } from "./roles-proof.mjs";
const CRM = "https://crm.bittrees.org/api/integrations/workflow-assignments";
const WORKFLOWS = "https://workflow.bittrees.org";
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");
const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const denied = () =>
  fail("Exact current native CRM assignment authority required", 403);
function exact(v, keys) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(",") !== keys.slice().sort().join(",")
  )
    throw denied();
}
function assignment(v) {
  exact(v, [
    "assignmentId",
    "taskId",
    "taskRevision",
    "projectId",
    "workflowId",
    "workflowRevision",
    "principal",
  ]);
  if (
    ![v.assignmentId, v.taskId, v.projectId].every(uuid) ||
    !Number.isSafeInteger(v.taskRevision) ||
    v.taskRevision < 1 ||
    !Number.isSafeInteger(v.workflowRevision) ||
    v.workflowRevision < 1 ||
    typeof v.workflowId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(v.workflowId) ||
    typeof v.principal !== "string" ||
    !v.principal.startsWith("agent:") ||
    !uuid(v.principal.slice(6))
  )
    throw denied();
  return v;
}
export function crmAssignmentOperation(raw) {
  const o = structuredClone(raw),
    kind = o?.kind,
    base = ["kind", "assignmentId"];
  const lease = ["runId", "leaseId", "crmOperationId"];
  const fields = {
    intake: [],
    task: [],
    claim: ["operationId"],
    write: [...lease, "result"],
    receipt: lease,
    lease: [...lease, "resultDigest"],
    complete: [...lease, "operationId", "resultDigest", "expiresAt"],
    completion: [...lease, "operationId", "resultDigest"],
    finalize: [...lease, "operationId", "resultDigest", "expiresAt"],
    finalization: [...lease, "operationId", "resultDigest"],
  };
  if (!Object.hasOwn(fields, kind ?? "")) throw denied();
  exact(o, [...base, ...fields[kind]]);
  if (
    !uuid(o.assignmentId) ||
    [...lease, "operationId"].some((k) => Object.hasOwn(o, k) && !uuid(o[k])) ||
    ("resultDigest" in o && !hex(o.resultDigest)) ||
    ("expiresAt" in o &&
      (!Number.isSafeInteger(o.expiresAt) || o.expiresAt <= 0))
  )
    throw denied();
  if (kind === "write") {
    exact(o.result, ["summary"]);
    if (
      typeof o.result.summary !== "string" ||
      !o.result.summary.trim() ||
      o.result.summary !== o.result.summary.trim() ||
      o.result.summary.length > 4000
    )
      throw denied();
  }
  return o;
}
export function crmAssignmentParameters(a, connectionId, o) {
  const assignmentDigest = digest(a),
    base = { connectionId, workflowId: a.workflowId, assignmentDigest };
  if (["intake", "task"].includes(o.kind))
    return {
      action: "workflow:claim",
      operationId: null,
      parameters: {
        tool: o.kind === "intake" ? "workflow_crm_intake" : "workflow_crm_task",
        arguments: base,
      },
    };
  if (o.kind === "claim")
    return {
      action: "workflow:claim",
      operationId: o.operationId,
      parameters: {
        tool: "workflow_claim",
        arguments: {
          connectionId,
          workflowId: a.workflowId,
          operationId: o.operationId,
          assignmentDigest,
        },
      },
    };
  const result = {
    connectionId,
    assignmentDigest,
    runId: o.runId,
    leaseId: o.leaseId,
    crmOperationId: o.crmOperationId,
  };
  if (["write", "receipt", "lease"].includes(o.kind))
    return {
      action: "workflow:complete",
      operationId: o.crmOperationId,
      parameters: {
        tool:
          o.kind === "write"
            ? "workflow_crm_result_write"
            : "workflow_crm_result_read",
        arguments: {
          ...result,
          ...(o.kind === "write" ? { resultDigest: digest(o.result) } : {}),
        },
      },
    };
  return {
    action: "workflow:complete",
    operationId: o.operationId,
    parameters: {
      tool: "workflow_crm_completion",
      arguments: {
        runId: o.runId,
        operationId: o.operationId,
        method: ["complete", "finalize"].includes(o.kind) ? "PUT" : "GET",
        connectionId,
        assignmentDigest,
        leaseId: o.leaseId,
        crmOperationId: o.crmOperationId,
        resultDigest: o.resultDigest,
      },
    },
  };
}
/** Host-only assembly. No caller URL/token/config is accepted, and a missing
 * enrolled purpose-correct binding makes no request or vault access. */
export function configuredCrmAssignments({
  env = process.env,
  rolesConsumer,
  request = fetch,
  clock = Date.now,
} = {}) {
  if (env.MCP_CRM_ASSIGNMENTS_ENABLED !== "true") return undefined;
  const resolve = (actor, id) => {
    if (env.MCP_CRM_ASSIGNMENTS_ENABLED !== "true") throw denied();
    authorize(actor, "workflow:execute");
    if (
      !actor?.rolesAuthorityBinding ||
      !["crm", "workflow"].every((p) => actor.projectIds?.includes(p))
    )
      throw denied();
    let rows;
    try {
      const bytes = env.MCP_CRM_ASSIGNMENTS_JSON ?? "[]";
      if (bytes.length > 256000) throw Error();
      rows = JSON.parse(bytes);
      if (!Array.isArray(rows) || rows.length > 20) throw Error();
    } catch {
      throw denied();
    }
    const matches = rows.filter(
      (c) =>
        c.actorTokenHash === actor.tokenHash &&
        c.tenant === actor.tenant &&
        c.subject === actor.subject &&
        c.binding === actor.rolesAuthorityBinding &&
        c.assignments?.some((a) => a.assignmentId === id),
    );
    if (matches.length !== 1) throw denied();
    const c = matches[0];
    exact(c, [
      "version",
      "actorTokenHash",
      "tenant",
      "subject",
      "binding",
      "connectionId",
      "ownerId",
      "datasetId",
      "sourceWorkspace",
      "principal",
      "credentialId",
      "runtimeLeaseId",
      "runtimeBindingDigest",
      "workspace",
      "approvedAt",
      "expiresAt",
      "completeTask",
      "assignments",
      "sourceToken",
      "workflowToken",
    ]);
    if (
      c.version !== 1 ||
      !hex(c.actorTokenHash) ||
      ![
        c.connectionId,
        c.ownerId,
        c.datasetId,
        c.sourceWorkspace,
        c.runtimeLeaseId,
      ].every(uuid) ||
      !hex(c.credentialId) ||
      !hex(c.runtimeBindingDigest) ||
      !Number.isSafeInteger(c.approvedAt) ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.approvedAt > clock() ||
      c.expiresAt <= clock() ||
      c.expiresAt - c.approvedAt > 900000 ||
      typeof c.completeTask !== "boolean" ||
      !Array.isArray(c.assignments) ||
      c.assignments.length < 1 ||
      c.assignments.length > 60 ||
      !hex(c.sourceToken) ||
      c.sourceToken === c.workflowToken ||
      !/^[\x21-\x7e]{32,4096}$/.test(c.workflowToken ?? "")
    )
      throw denied();
    c.assignments.forEach(assignment);
    if (
      new Set(c.assignments.map((a) => a.assignmentId)).size !==
        c.assignments.length ||
      c.assignments.some((a) => a.principal !== c.principal)
    )
      throw denied();
    const bs = rolesConsumer?.bindings?.filter((b) => b.id === c.binding) ?? [],
      b = bs[0];
    if (
      bs.length !== 1 ||
      b.actorTokenHash !== c.actorTokenHash ||
      b.tenant !== c.tenant ||
      b.subject !== c.subject ||
      b.workspace !== c.workspace ||
      b.principal !== c.principal ||
      b.credentialId !== c.credentialId ||
      b.leaseId !== c.runtimeLeaseId ||
      b.runtimeBindingDigest !== c.runtimeBindingDigest ||
      !b.publicKey ||
      b.privateKey != null ||
      b.delegationId != null
    )
      throw denied();
    return c;
  };
  return async (actor, raw) => {
    actor = structuredClone(actor);
    const original = crmAssignmentOperation(raw),
      c = resolve(actor, original.assignmentId),
      pin = digest(c);
    if (["finalize", "finalization"].includes(original.kind) && !c.completeTask)
      throw denied();
    const o = {
      ...original,
      kind:
        { finalize: "complete", finalization: "completion" }[original.kind] ??
        original.kind,
    };
    const a = c.assignments.find((a) => a.assignmentId === o.assignmentId),
      auth = crmAssignmentParameters(a, c.connectionId, o),
      authorityPin = digest(
        rolesConsumer.bindings.filter((b) => b.id === c.binding),
      );
    const current = () => {
      if (
        digest(resolve(actor, o.assignmentId)) !== pin ||
        digest(rolesConsumer.bindings.filter((b) => b.id === c.binding)) !==
          authorityPin
      )
        throw denied();
    };
    const proofs =
      actor.rolesProof?.proofs ?? (actor.rolesProof ? [actor.rolesProof] : []);
    if (!Array.isArray(proofs) || proofs.length > 3) throw denied();
    const nonce =
      auth.operationId ??
      proofs.find(
        (p) => p?.request?.parametersDigest === digest(auth.parameters),
      )?.request?.operationId ??
      randomUUID();
    return rolesConsumer.execute(
      actor,
      c.binding,
      {
        project: "workflow",
        resource: "workflow:" + a.workflowId,
        action: auth.action,
        operationId: nonce,
        stage: "execute",
        deviceChallenge: true,
      },
      auth.parameters,
      async (parameters, envelope) => {
        const decisionCurrent = () => {
          current();
          try {
            const r = envelope?.decision?.request,
              d = verifyDecision(
                envelope,
                r,
                rolesConsumer.decisionKey,
                clock(),
              );
            if (
              !d.allowed ||
              canonical(parameters) !== canonical(auth.parameters) ||
              r.principal !== c.principal ||
              r.credentialId !== c.credentialId ||
              r.leaseId !== c.runtimeLeaseId ||
              r.runtimeBindingDigest !== c.runtimeBindingDigest ||
              r.delegationId !== null ||
              r.tenant !== c.tenant ||
              r.workspace !== c.workspace ||
              r.project !== "workflow" ||
              r.resource !== "workflow:" + a.workflowId ||
              r.action !== auth.action ||
              r.stage !== "execute" ||
              r.operationId !== nonce ||
              r.parametersDigest !== digest(auth.parameters)
            )
              throw Error();
            return Math.min(d.expiresAt, c.expiresAt);
          } catch {
            throw fail(
              "CRM result authority expired or changed; reconcile the original operation",
              409,
            );
          }
        };
        const call = async (
          url,
          token,
          body,
          { method = "POST", proof, lease, operationId } = {},
        ) => {
          const deadline = decisionCurrent(),
            response = await request(url, {
              method,
              redirect: "error",
              signal: AbortSignal.timeout(Math.max(1, deadline - clock())),
              headers: {
                authorization: "Bearer " + token,
                accept: "application/json",
                "accept-encoding": "identity",
                ...(body ? { "content-type": "application/json" } : {}),
                "x-bittrees-roles-decision": encode(envelope),
                "x-bittrees-connection-id": c.connectionId,
                ...(proof ? { "x-bittrees-crm-proof": encode(proof) } : {}),
                ...(lease
                  ? { "x-bittrees-workflow-lease": encode(lease) }
                  : {}),
                ...(operationId ? { "Idempotency-Key": operationId } : {}),
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            });
          if (!response.ok) {
            await response.body?.cancel();
            throw fail(
              "Protected assignment outcome unavailable; reconcile the original operation",
              [401, 403, 404, 409, 429].includes(response.status)
                ? response.status
                : 502,
            );
          }
          const reader = response.body?.getReader();
          if (!reader) throw fail("Missing source receipt", 502);
          const chunks = [];
          let size = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              size += next.value.length;
              if (size > 24000) throw fail("Oversized source receipt", 502);
              chunks.push(next.value);
            }
          } finally {
            await reader.cancel();
          }
          decisionCurrent();
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        };
        const source = async (kind, lease) => {
          const result = await call(
            CRM,
            c.sourceToken,
            { version: 1, connectionId: c.connectionId, kind, operation: o },
            { lease },
          );
          if (
            kind === "result" &&
            (result.receipt?.operationId !== o.crmOperationId ||
              !hex(result.receipt?.resultDigest) ||
              (o.kind === "write" &&
                result.receipt.resultDigest !== digest(o.result)))
          )
            throw fail(
              "Source receipt differs from the original result operation",
              409,
            );
          return result;
        };
        if (o.kind === "lease")
          return call(
            WORKFLOWS + "/api/task-runs/" + o.runId + "/crm-result-lease",
            c.workflowToken,
            {
              assignment: a,
              connectionId: c.connectionId,
              runId: o.runId,
              leaseId: o.leaseId,
              crmOperationId: o.crmOperationId,
              operation: "receipt",
              resultDigest: o.resultDigest,
            },
          );
        const base = "/api/task-assignments/" + a.assignmentId;
        if (o.kind === "task") {
          const task = await source("task");
          if (digest(task.assignment) !== digest(a)) throw denied();
          return task;
        }
        if (["intake", "claim"].includes(o.kind)) {
          const supplied = await source("assignment");
          if (digest(supplied.assignment) !== digest(a)) throw denied();
          return call(
            WORKFLOWS + base + "/" + o.kind,
            c.workflowToken,
            { assignment: a },
            {
              proof: supplied.envelope,
              ...(o.kind === "claim" ? { operationId: o.operationId } : {}),
            },
          );
        }
        if (
          o.kind === "write" ||
          ["finalize", "finalization"].includes(original.kind)
        ) {
          const lease = await call(
            WORKFLOWS + "/api/task-runs/" + o.runId + "/crm-result-lease",
            c.workflowToken,
            {
              assignment: a,
              connectionId: c.connectionId,
              runId: o.runId,
              leaseId: o.leaseId,
              crmOperationId: o.crmOperationId,
              operation: o.kind,
              resultDigest:
                o.kind === "write" ? digest(o.result) : o.resultDigest,
              ...("operationId" in o ? { operationId: o.operationId } : {}),
            },
          );
          const result = await source(
            o.kind === "write" ? "result" : original.kind,
            lease,
          );
          return o.kind === "write" ? result.receipt : result.task;
        }
        const result = await source("result");
        if (o.kind === "receipt") return result.receipt;
        if (result.receipt?.resultDigest !== o.resultDigest)
          throw fail("Completion differs from source receipt", 409);
        return call(
          WORKFLOWS +
            "/api/task-runs/" +
            o.runId +
            "/completions/" +
            o.operationId,
          c.workflowToken,
          o.kind === "complete"
            ? {
                assignment: a,
                claim: {
                  assignmentDigest: digest(a),
                  runId: o.runId,
                  leaseId: o.leaseId,
                  expiresAt: o.expiresAt,
                },
                crmOperationId: o.crmOperationId,
                resultDigest: o.resultDigest,
              }
            : undefined,
          {
            method: o.kind === "complete" ? "PUT" : "GET",
            proof: result.envelope,
            operationId: o.operationId,
          },
        );
      },
    );
  };
}
