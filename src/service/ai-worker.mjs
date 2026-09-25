import { authorize } from "./engine.mjs";
import { aiActor } from "./ai-secrets.mjs";
import { AiDispatchOutbox, aiCommandId } from "./ai-outbox.mjs";
import { requireSelectedProject } from "../ecosystem/catalog.mjs";
const denied = () => Object.assign(new Error("AI automation authority is not current"), { statusCode: 403 });
export class AiWorker {
  constructor(store, { transport, resolveActor, catalog, clock = Date.now }) {
    this.store = store; this.resolveActor = resolveActor; this.catalog = catalog; this.clock = clock;
    this.outbox = new AiDispatchOutbox(store, {
      transport, clock,
      authorize: (state, intent, operation) => this.authorized(state, intent, operation),
    });
  }
  connection(state, actor, id) {
    const row = state.aiConnections?.[id];
    if (!row || row.status !== "connected" || row.expiresAt <= this.clock() ||
        JSON.stringify(row.actor) !== JSON.stringify(aiActor(actor))) throw denied();
    return row;
  }
  authorized(state, intent, operation) {
    try {
      const actor = this.resolveActor(intent.tenant, intent.subject);
      authorize(actor, operation === "manage" ? "automation:write" : "automation:execute");
      const automation = state.automations[intent.automationId], run = state.runs[intent.runId];
      if (!automation || !run || run.automationId !== automation.id ||
          automation.tenant !== actor.tenant || automation.subject !== actor.subject ||
          intent.actorId !== aiActor(actor).actorId) return false;
      if (operation === "manage") return true;
      const connection = this.connection(state, actor, intent.grantId), grant = connection.grant;
      const ruleRecord = state.rules[automation.ruleId], rule = ruleRecord?.versions.at(-1), profile = state.profiles[automation.profileId];
      if ((operation !== "inspect" && automation.status !== "active") || automation.tool !== "run_ai_template" || automation.connectionId !== connection.id ||
          !actor.projectIds.includes(automation.projectId) || !rule?.enabled || !rule.tools.includes("run_ai_template") ||
          !rule.projectIds.includes(automation.projectId) || ruleRecord.tenant !== actor.tenant || ruleRecord.subject !== actor.subject ||
          profile?.tenant !== actor.tenant || profile?.subject !== actor.subject ||
          run.aiAuthority?.ruleVersion !== rule.version || run.aiAuthority?.profileRevision !== profile.revision ||
          grant.permissionId !== intent.permissionId || grant.deviceId !== intent.command.deviceId ||
          grant.templateId !== intent.command.templateId || grant.templateRevision !== intent.command.templateRevision) return false;
      requireSelectedProject(this.catalog, profile.selection, automation.projectId);
      return true;
    } catch { return false; }
  }
  prepare(state, run, automation, actor, rule, profile, now) {
    const connection = this.connection(state, actor, automation.connectionId), grant = connection.grant;
    run.aiAuthority = { ruleVersion: rule.version, profileRevision: profile.revision };
    const intent = { runId: run.id, automationId: automation.id, ...aiActor(actor),
      grantId: connection.id, permissionId: grant.permissionId,
      command: { id: "", deviceId: grant.deviceId, templateId: grant.templateId, templateRevision: grant.templateRevision,
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + 60000, grant.expiresAt)).toISOString() } };
    intent.command.id = aiCommandId(intent);
    this.outbox.enqueueInState(state, intent);
    run.status = "dispatch_pending";
  }
  async tick() {
    const ids = await this.store.transaction((state) => Object.entries(state.aiDispatchOutbox ?? {})
      .filter(([, entry]) => ["queued", "uncertain", "dispatching"].includes(entry.state))
      .slice(0, 20).map(([id]) => id));
    for (const id of ids) {
      try { await this.outbox.process(id); } catch { /* Current authority may have been withdrawn. */ }
      await this.store.transaction((state) => {
        const entry = state.aiDispatchOutbox[id], run = state.runs[id];
        if (!entry || !run) return;
        run.status = entry.state === "accepted" ? "accepted" : entry.state === "queued" ? "dispatch_pending" : entry.state;
        if (entry.receipt) run.result = entry.receipt;
      });
    }
    return ids.length;
  }
}
