import { createHash, randomUUID } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const opaque = /^[a-zA-Z0-9_-]{1,128}$/;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Deterministic idempotency identity, not an authorization token. Reconstructing
// a run after restoring an older snapshot must never create a new target effect.
export function aiCommandId({ tenant, subject, actorId, grantId, runId }) {
  const hex = createHash("sha256").update(JSON.stringify([
    "bittrees-mcp-ai-command-v1", tenant, subject, actorId, grantId, runId,
  ])).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join("-");
}
const fail = (message) => Object.assign(new Error(message), { statusCode: 409 });
const strict = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw fail("Invalid dispatch metadata");
};
function intent(raw, now) {
  strict(raw, ["runId", "automationId", "tenant", "subject", "actorId", "grantId", "permissionId", "command"]);
  for (const key of ["runId", "automationId", "actorId"])
    if (typeof raw[key] !== "string" || !opaque.test(raw[key])) throw fail("Invalid dispatch identity");
  for (const key of ["tenant", "subject"])
    if (typeof raw[key] !== "string" || !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(raw[key])) throw fail("Invalid dispatch owner");
  for (const key of ["grantId", "permissionId"])
    if (typeof raw[key] !== "string" || !uuid.test(raw[key])) throw fail("Invalid dispatch grant");
  strict(raw.command, ["id", "deviceId", "templateId", "templateRevision", "issuedAt", "expiresAt"]);
  for (const key of ["id", "deviceId", "templateId"])
    if (typeof raw.command[key] !== "string" || !uuid.test(raw.command[key])) throw fail("Invalid dispatch command");
  if (raw.command.id !== aiCommandId(raw)) throw fail("Dispatch command must retain its run identity");
  if (!Number.isSafeInteger(raw.command.templateRevision) || raw.command.templateRevision < 1)
    throw fail("Invalid template revision");
  for (const key of ["issuedAt", "expiresAt"])
    if (typeof raw.command[key] !== "string" || raw.command[key].length > 32) throw fail("Invalid command time");
  const issued = Date.parse(raw.command.issuedAt), expires = Date.parse(raw.command.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || expires <= now || expires <= issued)
    throw fail("Expired dispatch intent");
  // Fixed property order makes exact retries independent of caller JSON key order.
  return Object.fromEntries(["runId", "automationId", "tenant", "subject", "actorId", "grantId", "permissionId"].map((key) => [key, raw[key]])
    .concat([["command", Object.fromEntries(["id", "deviceId", "templateId", "templateRevision", "issuedAt", "expiresAt"].map((key) => [key, raw.command[key]]))]]));
}
function rows(state) {
  // Migration/integration must explicitly provision this format. Old state cannot
  // silently acquire dispatch authority just because a module was imported.
  if (state.aiDispatchVersion !== 1 || !state.aiDispatchOutbox)
    throw fail("AI dispatch storage unavailable");
  return state.aiDispatchOutbox;
}
function receipt(raw, entry) {
  strict(raw, ["id", "grantId", "permissionId", "state"]);
  if (raw.id !== entry.intent.command.id || raw.grantId !== entry.intent.grantId ||
      raw.permissionId !== entry.intent.permissionId || !["accepted", "not_found"].includes(raw.state))
    throw fail("Dispatch receipt does not match intent");
  return { id: raw.id, grantId: raw.grantId, permissionId: raw.permissionId, state: raw.state };
}

/** Internal outbox, deliberately not mounted in runtime until two-sided consent,
 * target enforcement and the versioned storage migration are integrated.
 * authorize is a synchronous trusted state/actor/rule/grant validator, never a
 * model/caller callback. Transport is an injected fixed-origin AI adapter. */
export class AiDispatchOutbox {
  constructor(store, { authorize, transport, clock = Date.now, leaseMs = 30000 }) {
    if (typeof authorize !== "function" || typeof transport?.submit !== "function" || typeof transport?.inspect !== "function" ||
        !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000)
      throw fail("Invalid dispatch configuration");
    this.store = store;
    this.authorize = authorize;
    this.transport = transport;
    this.clock = clock;
    this.leaseMs = leaseMs;
  }
  check(state, entry, operation = "dispatch") {
    if (this.authorize(state, structuredClone(entry.intent), operation) !== true)
      throw fail("Dispatch authority is not current");
  }
  enqueueInState(state, raw) {
    const input = intent(raw, this.clock()), hash = digest(input);
      const outbox = rows(state), previous = outbox[input.runId];
      const entry = { intent: input, hash, state: "queued", attempts: 0, lease: null, receipt: null, cancelRequested: false };
      this.check(state, entry);
      if (previous) {
        if (previous.hash !== hash) throw fail("Dispatch retry changed intent");
        return structuredClone(previous);
      }
      if (Object.keys(outbox).length >= 10000) throw fail("Dispatch capacity reached");
      if (Object.values(outbox).some((row) => row.intent.command.id === input.command.id))
        throw fail("Dispatch command already belongs to another run");
      outbox[input.runId] = entry;
      return structuredClone(entry);
  }
  async enqueue(raw) {
    return this.store.transaction((state) => this.enqueueInState(state, raw));
  }
  async cancel(runId) {
    return this.store.transaction((state) => {
      const entry = rows(state)[runId];
      if (!entry) throw fail("Dispatch not found");
      this.check(state, entry, "manage");
      entry.cancelRequested = true;
      // Accepted or in-flight effects cannot honestly be called cancelled here.
      if (["queued", "awaiting_retry"].includes(entry.state)) entry.state = "cancelled";
      return structuredClone(entry);
    });
  }
  retryInState(state, runId) {
      const entry = rows(state)[runId];
      if (!entry || entry.state !== "awaiting_retry" || entry.cancelRequested)
        throw fail("Dispatch is not ready for an explicit retry");
      this.check(state, entry);
      intent(entry.intent, this.clock());
      entry.state = "queued";
      return structuredClone(entry);
  }
  async retry(runId) {
    return this.store.transaction((state) => this.retryInState(state, runId));
  }
  async process(runId) {
    const claim = await this.store.transaction((state) => {
      const entry = rows(state)[runId];
      if (!entry || !["queued", "uncertain", "dispatching"].includes(entry.state)) return null;
      const now = this.clock();
      if (entry.lease && entry.lease.expiresAt > now) return null;
      const mode = entry.state === "queued" ? "submit" : "inspect";
      this.check(state, entry, mode === "inspect" ? "inspect" : "dispatch");
      if (mode === "submit") {
        if (entry.cancelRequested) { entry.state = "cancelled"; return null; }
        if (Date.parse(entry.intent.command.expiresAt) <= now) { entry.state = "expired"; return null; }
      }
      entry.attempts++;
      entry.state = "dispatching";
      entry.lease = { id: randomUUID(), expiresAt: now + this.leaseMs };
      return { ...structuredClone(entry), mode };
    });
    if (!claim) return null;
    let result = null;
    // No store transaction remains open across transport or its timeout. Timeout
    // means uncertain delivery, not proof of cancellation or failed acceptance.
    const abort = new AbortController();
    let timer;
    try {
      result = receipt(await Promise.race([
        Promise.resolve().then(() => this.transport[claim.mode](structuredClone(claim.intent), abort.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(fail("Dispatch response unavailable")); }, this.leaseMs); }),
      ]), claim);
      if (claim.mode === "submit" && result.state !== "accepted") result = null;
    } catch {
      // Never persist transport messages: they can contain credentials or content.
    } finally { clearTimeout(timer); }
    return this.store.transaction((state) => {
      const entry = rows(state)[runId];
      if (!entry || entry.lease?.id !== claim.lease.id || entry.hash !== claim.hash) return null;
      entry.lease = null;
      entry.receipt = result;
      entry.state = !result ? "uncertain" : result.state === "accepted" ? "accepted" : entry.cancelRequested ? "cancelled" : "awaiting_retry";
      return structuredClone(entry);
    });
  }
}
