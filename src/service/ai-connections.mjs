import { createHash, randomBytes, randomUUID } from "node:crypto";
import { authorize } from "./engine.mjs";
import { aiActor } from "./ai-secrets.mjs";
const fail = () => Object.assign(new Error("AI connection unavailable or no longer authorized"), { statusCode: 409 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function connections(state) {
  if (state.aiDispatchVersion !== 1 || !state.aiConnections) throw fail();
  return state.aiConnections;
}
function binding(row, phase) { return { ...row.actor, id: row.id, phase }; }
function visible(row) {
  return { id: row.id, actor: row.actor, status: row.status, expiresAt: row.expiresAt, grant: row.grant ?? null };
}
/** Caller must supply the current server-authenticated MCP credential record.
 * Claims are durable before remote calls; no transaction spans network work. */
export class AiConnections {
  constructor(store, { client, secrets, clock = Date.now }) {
    this.store = store; this.client = client; this.secrets = secrets; this.clock = clock;
  }
  owned(state, credential, id) {
    authorize(credential, "automation:write");
    const actor = aiActor(credential), row = connections(state)[id];
    if (!row || JSON.stringify(row.actor) !== JSON.stringify(actor)) throw fail();
    return row;
  }
  async list(credential) {
    authorize(credential, "automation:read");
    const actor = aiActor(credential);
    return this.store.transaction((state) => Object.values(connections(state))
      .filter((row) => JSON.stringify(row.actor) === JSON.stringify(actor)).map(visible));
  }
  async prepare(credential) {
    authorize(credential, "automation:write");
    const actor = aiActor(credential), id = randomUUID();
    const secret = { verifier: randomBytes(32).toString("base64url"), approvalCode: randomBytes(32).toString("base64url") };
    return this.store.transaction((state) => {
      authorize(credential, "automation:write");
      const all = connections(state);
      if (Object.keys(all).length >= 1000 || Object.values(all).filter((r) => r.actor.tenant === actor.tenant && r.actor.subject === actor.subject).length >= 20) throw fail();
      const row = { id, actor, status: "prepared", expiresAt: this.clock() + 300000 };
      row.sealed = this.secrets.seal(binding(row, "pending"), secret);
      all[id] = row;
      return visible(row);
    });
  }
  async register(credential, id) {
    const request = await this.store.transaction((state) => {
      const row = this.owned(state, credential, id);
      if (!["prepared", "pending"].includes(row.status) || row.expiresAt <= this.clock()) throw fail();
      const secret = this.secrets.open(binding(row, "pending"), row.sealed);
      return { id, actor: row.actor, challenge: createHash("sha256").update(secret.verifier).digest("base64url"), approvalHash: hash(secret.approvalCode) };
    });
    const result = await this.client.begin(request);
    return this.store.transaction((state) => {
      const row = this.owned(state, credential, id);
      if (!["prepared", "pending"].includes(row.status) || row.expiresAt <= this.clock() || result.id !== id ||
          !Number.isSafeInteger(result.requestExpiresAt) || result.requestExpiresAt <= this.clock()) throw fail();
      row.status = "pending";
      row.expiresAt = Math.min(row.expiresAt, result.requestExpiresAt);
      // Returned only for the explicit consent display; never in URLs/history.
      return { ...visible(row), approvalCode: this.secrets.open(binding(row, "pending"), row.sealed).approvalCode };
    });
  }
  async redeem(credential, { id, expectedOwnerId, confirmed }) {
    if (confirmed !== true || !uuid.test(expectedOwnerId ?? "")) throw fail();
    const request = await this.store.transaction((state) => {
      const row = this.owned(state, credential, id);
      if (row.status !== "pending" || row.expiresAt <= this.clock()) throw fail();
      const { verifier } = this.secrets.open(binding(row, "pending"), row.sealed);
      // A lost response is not retried: the target returns its credential once.
      row.status = "redeeming";
      return { id, expectedOwnerId, confirmed: true, actor: row.actor, verifier };
    });
    let response;
    try {
      response = await this.client.redeem(request);
      const grant = response?.grant;
      if (!grant || grant.id !== id || grant.clientId !== "bittrees-mcp" || grant.ownerId !== expectedOwnerId ||
          JSON.stringify(grant.actor) !== JSON.stringify(request.actor) || grant.redeemed !== true || grant.revoked !== false ||
          ![grant.permissionId, grant.deviceId, grant.templateId].every((v) => typeof v === "string" && uuid.test(v)) ||
          !Number.isSafeInteger(grant.templateRevision) || grant.templateRevision < 1 ||
          !Number.isSafeInteger(grant.maxRuns) || grant.maxRuns < 1 || grant.maxRuns > 20 ||
          !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= this.clock()) throw fail();
      return await this.store.transaction((state) => {
        const row = this.owned(state, credential, id);
        if (row.status !== "redeeming" || row.expiresAt <= this.clock()) throw fail();
        row.sealed = this.secrets.seal(binding(row, "granted"), { credential: response.credential });
        row.grant = { ownerId: grant.ownerId, permissionId: grant.permissionId, deviceId: grant.deviceId, templateId: grant.templateId,
          templateRevision: grant.templateRevision, maxRuns: grant.maxRuns, expiresAt: grant.expiresAt };
        row.expiresAt = grant.expiresAt;
        row.status = "connected";
        return visible(row);
      });
    } catch {
      // If a credential reached this process but local commit failed, revoke it
      // at source. Failure remains honest and requires AI-owner review/revocation.
      if (response?.credential) await this.client.disconnect({ id, actor: request.actor }, response.credential).catch(() => {});
      await this.store.transaction((state) => {
        const row = connections(state)[id];
        if (row?.status === "redeeming") { row.status = "review_required"; delete row.sealed; }
      });
      throw fail();
    }
  }
  async credentialForDispatch(credential, intent) {
    return this.store.transaction((state) => {
      const row = this.owned(state, credential, intent.grantId);
      const grant = row.grant;
      if (row.status !== "connected" || row.expiresAt <= this.clock() || !grant ||
          row.actor.tenant !== intent.tenant || row.actor.subject !== intent.subject || row.actor.actorId !== intent.actorId ||
          grant.permissionId !== intent.permissionId || grant.deviceId !== intent.command?.deviceId ||
          grant.templateId !== intent.command?.templateId || grant.templateRevision !== intent.command?.templateRevision)
        throw fail();
      return this.secrets.open(binding(row, "granted"), row.sealed).credential;
    });
  }
  async disconnect(credential, id) {
    const claim = await this.store.transaction((state) => {
      const row = this.owned(state, credential, id);
      if (!["connected", "disconnecting"].includes(row.status)) throw fail();
      row.status = "disconnecting"; // Immediately excludes further local dispatch.
      return { actor: row.actor, credential: this.secrets.open(binding(row, "granted"), row.sealed).credential };
    });
    const result = await this.client.disconnect({ id, actor: claim.actor }, claim.credential);
    if (result?.revoked !== true) throw fail();
    return this.store.transaction((state) => {
      const row = this.owned(state, credential, id);
      if (row.status !== "disconnecting") throw fail();
      row.status = "disconnected"; delete row.sealed;
      return visible(row);
    });
  }
}
