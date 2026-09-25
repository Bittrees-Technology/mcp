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
const tools = ["get_bittrees_project", "run_ai_template"];
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
function displayName(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw fail("Choose a name between 1 and 100 characters");
  return value.trim();
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
      aiWorker,
    } = {},
  ) {
    this.store = store;
    this.catalog = catalog;
    this.adapter = adapter;
    this.clock = clock;
    this.aiWorker = aiWorker;
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
      if (operation === "automation.setup") {
        authorize(actor, "profile:write");
        authorize(actor, "rule:write");
        fields(input, ["name", "projectId", "intervalSeconds", "idempotencyKey", "connectionId"]);
        const aiConnection = input.connectionId === undefined ? null : this.aiWorker?.connection(state, actor, input.connectionId);
        if (input.connectionId !== undefined && !aiConnection) throw fail("AI connections are not configured", 409);
        const tool = aiConnection ? "run_ai_template" : "get_bittrees_project";
        key(input.idempotencyKey);
        const selection = validateSelection({schema:"agent.bittrees.selection.v1",version:1,revision:1,mode:"selected",selectedIds:[input.projectId],excludedIds:[]});
        const project = requireSelectedProject(this.catalog, selection, input.projectId);
        if (!actor.projectIds.includes(project.id)) throw fail("Project is outside your access", 403);
        const name = displayName(input.name, `${project.name} update`);
        if (input.intervalSeconds !== undefined && ![3600,21600,86400].includes(input.intervalSeconds))
          throw fail("Choose manual, hourly, every six hours or daily");
        const fingerprint = createHash("sha256").update(JSON.stringify(aiConnection ? [name,project.id,input.intervalSeconds??null,input.connectionId] : [name,project.id,input.intervalSeconds??null])).digest("hex");
        const prior = Object.values(state.automations).find(r=>owns(r,actor)&&r.setupKey===input.idempotencyKey);
        if(prior){if(prior.setupFingerprint!==fingerprint)throw fail("This save request has already been used; refresh before creating another",409);return prior;}
        const profile={id:randomUUID(),tenant:actor.tenant,subject:actor.subject,selection,revision:1};
        const rule={id:randomUUID(),name:`${name} permission`,tenant:actor.tenant,subject:actor.subject,versions:[{version:1,projectIds:[project.id],tools:[tool],enabled:true,createdAt:now}]};
        const record={id:randomUUID(),name,tenant:actor.tenant,subject:actor.subject,profileId:profile.id,ruleId:rule.id,projectId:project.id,tool,...(aiConnection ? {connectionId:aiConnection.id} : {}),trigger:input.intervalSeconds?{type:"schedule",intervalSeconds:input.intervalSeconds}:{type:"manual"},status:"paused",nextAt:null,createdAt:now,setupKey:input.idempotencyKey,setupFingerprint:fingerprint};
        state.profiles[profile.id]=profile;state.rules[rule.id]=rule;state.automations[record.id]=record;
        audit(state,actor,"profile.create",profile.id,now);
        audit(state,actor,"rule.create",rule.id,now,{version:1});
        audit(state,actor,"automation.create",record.id,now);
        return record;
      }
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
          "name",
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
          throw fail("Only implemented tools may be allowed");
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
        record.name = displayName(input.name, record.name ?? "Project context permission");
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
        fields(input, ["name", "profileId", "ruleId", "projectId", "tool", "trigger"]);
        owned(state.profiles, input.profileId, actor);
        owned(state.rules, input.ruleId, actor);
        if (
          input.tool !== "get_bittrees_project" ||
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
          name: displayName(input.name, "Project context update"),
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
      if (operation === "ai.retry") {
        fields(input, ["runId", "confirmed"]);
        if (!this.aiWorker || input.confirmed !== true) throw fail("Confirm AI retry", 409);
        const run = owned(state.runs, input.runId, actor);
        this.aiWorker.outbox.retryInState(state, run.id);
        run.status = "dispatch_pending";
        audit(state, actor, operation, run.id, now);
        return run;
      }
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
        if (operation === "cancel") {
          for (const entry of Object.values(state.aiDispatchOutbox ?? {})) {
            if (entry.intent.automationId !== record.id) continue;
            entry.cancelRequested = true;
            if (["queued", "awaiting_retry"].includes(entry.state)) {
              entry.state = "cancelled";
              const run = state.runs[entry.intent.runId];
              if (run) run.status = "cancelled";
            }
          }
        }
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
    const result = await this.store.transaction(async (state) => {
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
          if (automation.tool === "run_ai_template") {
            if (!this.aiWorker) throw fail("AI worker unavailable", 403);
            this.aiWorker.prepare(state, run, automation, actor, rule, profile, now);
            attempt.outcome = "dispatch_pending";
            audit(state, actor, "execution", run.id, now, { status: run.status, ruleVersion: rule.version });
            continue;
          }
          // Public adapter only. AI network dispatch occurs after this transaction.
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
    if (this.aiWorker) result.dispatched = await this.aiWorker.tick();
    return result;
  }
}
