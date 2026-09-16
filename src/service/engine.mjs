import { randomUUID, createHash } from "node:crypto";
import {
  CATALOG,
  validateSelection,
  requireSelectedProject,
  catalogRevision,
} from "../ecosystem/catalog.mjs";
export const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const tools = ["get_bittrees_project"];
function fields(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw fail("Unsupported configuration field");
}
function key(value) {
  if (typeof value !== "string" || !ID.test(value))
    throw fail("Invalid identifier");
  return value;
}
function owns(record, actor) {
  return (
    record && record.tenant === actor.tenant && record.subject === actor.subject
  );
}
export function authorize(actor, permission) {
  if (
    !actor ||
    actor.expiresAt <= Date.now() ||
    actor.audience !== "https://mcp.bittrees.org" ||
    !actor.permissions.includes(permission)
  )
    throw fail("Permission denied", 403);
}
function owned(map, id, actor) {
  const record = map[id];
  if (!owns(record, actor)) throw fail("Record not found", 404);
  return record;
}
function audit(state, actor, event, id, now, detail = {}) {
  if (state.audit.length >= 10000)
    throw fail("Audit capacity reached; operator archival required", 503);
  state.audit.push({
    id: randomUUID(),
    at: now,
    tenant: actor.tenant,
    subject: actor.subject,
    event,
    recordId: id,
    ...detail,
  });
}
export class Engine {
  constructor(
    store,
    {
      catalog = CATALOG,
      adapter = (project) => ({
        projectId: project.id,
        name: project.name,
        summary: project.summary,
        catalogRevision: catalogRevision(catalog),
      }),
      clock = () => Date.now(),
    } = {},
  ) {
    this.store = store;
    this.catalog = catalog;
    this.adapter = adapter;
    this.clock = clock;
  }
  async act(actor, operation, input = {}) {
    return this.store.transaction(async (state) => {
      const now = this.clock();
      authorize(
        actor,
        operation === "history"
          ? "automation:read"
          : operation.startsWith("profile")
            ? "profile:write"
            : operation.startsWith("rule")
              ? "rule:write"
              : "automation:write",
      );
      if (operation === "profile.create") {
        fields(input, ["selection"]);
        const selection = validateSelection(input.selection);
        const record = {
          id: randomUUID(),
          tenant: actor.tenant,
          subject: actor.subject,
          selection,
          revision: 1,
        };
        state.profiles[record.id] = record;
        audit(state, actor, operation, record.id, now);
        return record;
      }
      if (operation === "profile.update") {
        fields(input, ["id", "selection", "expectedRevision"]);
        const record = owned(state.profiles, input.id, actor);
        if (input.expectedRevision !== record.revision)
          throw fail("Profile revision conflict", 409);
        record.selection = validateSelection(input.selection);
        record.revision++;
        audit(state, actor, operation, record.id, now);
        return record;
      }
      if (operation === "rule.create" || operation === "rule.update") {
        fields(input, [
          "id",
          "expectedVersion",
          "projectIds",
          "tools",
          "enabled",
        ]);
        if (
          !Array.isArray(input.projectIds) ||
          !input.projectIds.length ||
          input.projectIds.length > 300 ||
          input.projectIds.some(
            (id) => !this.catalog.projects.some((p) => p.id === id),
          ) ||
          new Set(input.projectIds).size !== input.projectIds.length
        )
          throw fail("Invalid rule projects");
        if (
          !Array.isArray(input.tools) ||
          input.tools.some((t) => !tools.includes(t)) ||
          typeof input.enabled !== "boolean"
        )
          throw fail("Only implemented public-context tools may be allowed");
        if (input.projectIds.some((id) => !actor.projectIds.includes(id)))
          throw fail("Rule exceeds actor project authority", 403);
        const record =
          operation === "rule.update"
            ? owned(state.rules, input.id, actor)
            : {
                id: randomUUID(),
                tenant: actor.tenant,
                subject: actor.subject,
                versions: [],
              };
        if (
          operation === "rule.update" &&
          input.expectedVersion !== record.versions.length
        )
          throw fail("Rule version conflict", 409);
        record.versions.push({
          version: record.versions.length + 1,
          projectIds: input.projectIds,
          tools: input.tools,
          enabled: input.enabled,
          createdAt: now,
        });
        state.rules[record.id] = record;
        audit(state, actor, operation, record.id, now, {
          version: record.versions.length,
        });
        return record;
      }
      if (operation === "automation.create") {
        fields(input, ["profileId", "ruleId", "projectId", "tool", "trigger"]);
        owned(state.profiles, input.profileId, actor);
        owned(state.rules, input.ruleId, actor);
        if (
          !tools.includes(input.tool) ||
          !actor.projectIds.includes(input.projectId)
        )
          throw fail("Unsupported tool or project", 403);
        fields(input.trigger, ["type", "intervalSeconds", "event"]);
        if (!["manual", "schedule", "event"].includes(input.trigger.type))
          throw fail("Invalid trigger");
        if (
          input.trigger.type === "schedule" &&
          (!Number.isSafeInteger(input.trigger.intervalSeconds) ||
            input.trigger.intervalSeconds < 60 ||
            input.trigger.intervalSeconds > 2592000)
        )
          throw fail("Schedule interval must be 60 seconds to 30 days");
        if (input.trigger.type === "event") key(input.trigger.event);
        const record = {
          ...input,
          id: randomUUID(),
          tenant: actor.tenant,
          subject: actor.subject,
          status: "paused",
          nextAt: null,
          createdAt: now,
        };
        state.automations[record.id] = record;
        audit(state, actor, operation, record.id, now);
        return record;
      }
      if (operation === "history")
        return {
          profiles: Object.values(state.profiles).filter((r) => owns(r, actor)),
          rules: Object.values(state.rules).filter((r) => owns(r, actor)),
          automations: Object.values(state.automations).filter((r) =>
            owns(r, actor),
          ),
          runs: Object.values(state.runs).filter((r) => owns(r, actor)),
          audit: state.audit.filter((r) => owns(r, actor)),
        };
      const record = owned(state.automations, input.id, actor);
      if (["pause", "resume", "cancel"].includes(operation)) {
        fields(input, ["id"]);
        if (record.status === "cancelled")
          throw fail("Cancelled automation cannot resume", 409);
        record.status = {
          pause: "paused",
          resume: "active",
          cancel: "cancelled",
        }[operation];
        if (operation === "resume" && record.trigger.type === "schedule")
          record.nextAt = now + record.trigger.intervalSeconds * 1000;
        if (operation === "cancel")
          for (const run of Object.values(state.runs))
            if (
              run.automationId === record.id &&
              ["queued", "retrying"].includes(run.status)
            )
              run.status = "cancelled";
        audit(state, actor, operation, record.id, now);
        return record;
      }
      if (operation === "enqueue") {
        fields(input, ["id", "idempotencyKey", "event"]);
        key(input.idempotencyKey);
        if (record.status !== "active")
          throw fail("Automation is paused or cancelled", 409);
        if (
          record.trigger.type === "event" &&
          input.event !== record.trigger.event
        )
          throw fail("Event does not match trigger");
        return this.enqueue(state, record, input.idempotencyKey, now, actor);
      }
      throw fail("Unknown operation");
    });
  }
  enqueue(state, record, idempotencyKey, now, actor) {
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          record.tenant,
          record.subject,
          record.id,
          idempotencyKey,
        ]),
      )
      .digest("hex");
    if (state.runs[id]) return state.runs[id];
    if (Object.keys(state.runs).length >= 10000)
      throw fail("Run capacity reached; operator archival required", 503);
    const run = {
      id,
      tenant: record.tenant,
      subject: record.subject,
      automationId: record.id,
      status: "queued",
      attempts: [],
      nextAt: now,
      createdAt: now,
    };
    state.runs[id] = run;
    audit(state, actor, "enqueue", id, now);
    return run;
  }
  async tick(resolveActor) {
    return this.store.transaction(async (state) => {
      const now = this.clock();
      let scheduled = 0,
        processed = 0;
      for (const automation of Object.values(state.automations)) {
        const actor = resolveActor(automation.tenant, automation.subject);
        if (
          automation.status === "active" &&
          automation.trigger.type === "schedule" &&
          automation.nextAt <= now &&
          scheduled < 20
        ) {
          // Missed intervals coalesce into one run, avoiding catch-up storms.
          this.enqueue(
            state,
            automation,
            `schedule-${automation.nextAt}`,
            now,
            actor ?? { tenant: automation.tenant, subject: automation.subject },
          );
          scheduled++;
          automation.nextAt = now + automation.trigger.intervalSeconds * 1000;
        }
      }
      for (const run of Object.values(state.runs)) {
        const automation = state.automations[run.automationId];
        if (processed >= 20) break;
        if (
          !["queued", "retrying"].includes(run.status) ||
          run.nextAt > now ||
          automation.status !== "active"
        )
          continue;
        processed++;
        const actor = resolveActor(run.tenant, run.subject);
        const rule = state.rules[automation.ruleId]?.versions.at(-1);
        const profile = state.profiles[automation.profileId];
        const attempt = {
          number: run.attempts.length + 1,
          at: now,
          ruleVersion: rule?.version ?? null,
          profileRevision: profile?.revision ?? null,
        };
        run.attempts.push(attempt);
        try {
          authorize(actor, "automation:execute");
          if (
            !owns(profile, actor) ||
            !owns(state.rules[automation.ruleId], actor) ||
            !actor.projectIds.includes(automation.projectId) ||
            !rule?.enabled ||
            !rule.projectIds.includes(automation.projectId) ||
            !rule.tools.includes(automation.tool)
          )
            throw fail("Execution denied by current authority or rule", 403);
          const project = requireSelectedProject(
            this.catalog,
            profile.selection,
            automation.projectId,
          );
          // The only adapter is pure public catalog context; never an external side effect.
          let timeout;
          try {
            run.result = await Promise.race([
              this.adapter(project),
              new Promise((_, reject) => {
                timeout = setTimeout(
                  () =>
                    reject(
                      Object.assign(new Error("Adapter deadline"), {
                        transient: true,
                      }),
                    ),
                  5000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
          run.status = "succeeded";
          attempt.outcome = "succeeded";
        } catch (error) {
          const transient = error.transient === true;
          run.status =
            transient && attempt.number < 3
              ? "retrying"
              : transient
                ? "failed"
                : "denied";
          run.nextAt = now + Math.min(60000, 1000 * 2 ** (attempt.number - 1));
          attempt.outcome = run.status;
          attempt.reason = transient
            ? "Adapter temporarily unavailable"
            : "Current authority, selection or rule denied execution";
        }
        audit(
          state,
          { tenant: run.tenant, subject: run.subject },
          "execution",
          run.id,
          now,
          { status: run.status, ruleVersion: attempt.ruleVersion },
        );
      }
      return { scheduled, processed };
    });
  }
}
