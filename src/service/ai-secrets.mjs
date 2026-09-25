import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
const denied = () => Object.assign(new Error("AI connection secrets unavailable"), { statusCode: 409 });
const identity = /^[^\s\x00-\x1f\x7f]{1,128}$/;
const opaque = /^[A-Za-z0-9_-]{43}$/;
function context(binding) {
  if (!binding || !identity.test(binding.tenant ?? "") || !identity.test(binding.subject ?? "") ||
      !/^[a-f0-9]{64}$/.test(binding.actorId ?? "") ||
      !/^[a-f0-9-]{36}$/i.test(binding.id ?? "") || !["pending", "granted"].includes(binding.phase)) throw denied();
  return Buffer.from(JSON.stringify(["bittrees-mcp-ai-secret-v1", binding.tenant, binding.subject, binding.actorId, binding.id, binding.phase]));
}
function payload(value, phase) {
  const keys = phase === "pending" ? ["verifier", "approvalCode"] : ["credential"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => typeof value[key] !== "string" || !opaque.test(value[key]))) throw denied();
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
/** Operator-managed key, separate from the state database. No plaintext secret
 * or inferred owner identity belongs in a connection row, export or response. */
export class AiSecrets {
  #key;
  constructor(encodedKey) {
    if (typeof encodedKey !== "string" || !opaque.test(encodedKey)) throw denied();
    this.#key = Buffer.from(encodedKey, "base64url");
    if (this.#key.length !== 32 || this.#key.toString("base64url") !== encodedKey) throw denied();
  }
  seal(binding, value) {
    const aad = context(binding), plain = Buffer.from(JSON.stringify(payload(value, binding.phase)));
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(aad);
    try {
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      return { version: 1, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
    } finally { plain.fill(0); }
  }
  open(binding, sealed) {
    let plain;
    try {
      const aad = context(binding);
      if (!sealed || sealed.version !== 1 || Object.keys(sealed).sort().join(",") !== "ciphertext,nonce,tag,version" ||
          typeof sealed.nonce !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(sealed.nonce) ||
          typeof sealed.tag !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(sealed.tag) ||
          typeof sealed.ciphertext !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(sealed.ciphertext)) throw denied();
      const cipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(sealed.nonce, "base64url"));
      cipher.setAAD(aad);
      cipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
      plain = Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext, "base64url")), cipher.final()]);
      return payload(JSON.parse(plain.toString("utf8")), binding.phase);
    } catch { throw denied(); }
    finally { plain?.fill(0); }
  }
}

// Called only with the server's authenticated credential record. Rotating the
// bearer invalidates its old actor binding even if tenant/subject stay the same.
export function aiActor(credential) {
  if (!credential || !identity.test(credential.tenant ?? "") || !identity.test(credential.subject ?? "") ||
      !/^[a-f0-9]{64}$/.test(credential.tokenHash ?? "")) throw denied();
  return {
    tenant: credential.tenant,
    subject: credential.subject,
    actorId: createHash("sha256").update(JSON.stringify(["bittrees-mcp-ai-actor-v1", credential.tenant, credential.subject, credential.tokenHash])).digest("hex"),
  };
}
