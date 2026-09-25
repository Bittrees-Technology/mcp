const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const unavailable = () => Object.assign(new Error("AI connection unavailable"), { statusCode: 503 });

/** Confidential server client. Destination and routes cannot be supplied by a
 * caller, redirect, stored rule or model. User authority is a separate bearer. */
export class AiClient {
  #clientCredential;
  #resolveCredential;
  #fetchImpl;
  constructor({ clientCredential, resolveCredential, fetchImpl = fetch }) {
    if (!credentialPattern.test(clientCredential ?? "") || typeof resolveCredential !== "function")
      throw unavailable();
    this.#clientCredential = clientCredential;
    this.#resolveCredential = resolveCredential;
    this.#fetchImpl = fetchImpl;
  }
  async request(path, body, credential, signal) {
    const routes = new Set(["delegations/begin", "delegations/redeem", "delegations/disconnect", "templates/dispatch", "templates/receipt"]);
    if (!routes.has(path) || (credential !== undefined && !credentialPattern.test(credential))) throw unavailable();
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 8192) throw unavailable();
    const timeout = AbortSignal.timeout(15000);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let reader;
    try {
      const response = await this.#fetchImpl(`https://ai.bittrees.org/mcp/${path}`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: bounded,
        headers: {
          "content-type": "application/json", "x-bittrees-mcp-client": this.#clientCredential,
          ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
        },
        body: encoded,
      });
      reader = response.body?.getReader();
      if (!response.ok || !reader || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable();
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16384) throw unavailable();
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      // Do not expose upstream bodies, URLs, credentials or runtime error text.
      throw unavailable();
    } finally {
      if (reader) await reader.cancel().catch(() => {});
    }
  }
  begin(input, signal) { return this.request("delegations/begin", input, undefined, signal); }
  redeem(input, signal) { return this.request("delegations/redeem", input, undefined, signal); }
  disconnect(input, credential, signal) { return this.request("delegations/disconnect", input, credential, signal); }
  async submit(intent, signal) {
    const credential = await this.#resolveCredential(intent);
    if (!credentialPattern.test(credential ?? "")) throw unavailable();
    return this.request("templates/dispatch", intent, credential, signal);
  }
  async inspect(intent, signal) {
    const credential = await this.#resolveCredential(intent);
    if (!credentialPattern.test(credential ?? "")) throw unavailable();
    return this.request("templates/receipt", intent, credential, signal);
  }
}
