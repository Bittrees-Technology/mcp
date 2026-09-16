import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
const exec = promisify(execFile);
const target = new URL(process.env.MCP_TARGET_DEPLOYMENT);
const commit = process.env.MCP_EXPECTED_COMMIT;
if (
  target.protocol !== "https:" ||
  !target.hostname.endsWith(".vercel.app") ||
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash ||
  !/^[a-f0-9]{40}$/.test(commit ?? "") ||
  !process.env.MCP_VERCEL_PROJECT_ID
)
  throw new Error(
    "Expected immutable Vercel target, full commit and separate MCP project ID",
  );
async function vercel(args) {
  return (
    await exec(
      "vercel",
      [
        ...args,
        "--scope",
        "bittrees-tech",
        ...(process.env.VERCEL_TOKEN
          ? ["--token", process.env.VERCEL_TOKEN]
          : []),
      ],
      {
        maxBuffer: 2 * 1024 * 1024,
      },
    )
  ).stdout;
}
const raw = await vercel(["api", `/v13/deployments/${target.hostname}`]);
const deployed = JSON.parse(raw.slice(raw.indexOf("{")));
if (
  deployed.name !== "bittrees-mcp" ||
  deployed.projectId !== process.env.MCP_VERCEL_PROJECT_ID ||
  deployed.readyState !== "READY" ||
  deployed.target !== "production" ||
  deployed.meta?.gitCommitSha !== commit ||
  deployed.meta?.gitDirty !== "0"
)
  throw new Error("Target identity or release metadata failed verification");
async function verify(base) {
  const headers = process.env.MCP_PREVIEW_BYPASS
    ? { "x-vercel-protection-bypass": process.env.MCP_PREVIEW_BYPASS }
    : {};
  const request = async (path, options = {}) => {
    if (new URL(base).hostname.endsWith('.vercel.app') && !process.env.MCP_PREVIEW_BYPASS) {
      const args=['curl',path,'--deployment',new URL(base).hostname,'--','--silent','--show-error','--fail'];
      if(options.method)args.push('--request',options.method);
      for(const [key,value] of Object.entries(options.headers??{}))args.push('--header',`${key}: ${value}`);
      if(options.body)args.push('--data',options.body);
      return JSON.parse(await vercel(args));
    }
    const response = await fetch(new URL(path, base), {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Release verification failed: ${path} (${response.status})`,
      );
    return response.json();
  };
  const health = await request("/health");
  if (
    health.service !== "bittrees-mcp" ||
    health.release !== commit ||
    health.storage !== "ready"
  )
    throw new Error("Service identity, storage or commit failed");
  const result = await request("/mcp?mode=selected&projects=agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
  });
  if (
    result.result?.resources?.length !== 2 ||
    !result.result.resources.every((r) =>
      r.uri.startsWith("https://mcp.bittrees.org/"),
    )
  )
    throw new Error("Scoped MCP verification failed");
  return health;
}
const preflight = await verify(target);
const apply = process.argv.includes("--apply");
if (apply) {
  await vercel(["alias", "set", target.hostname, "mcp.bittrees.org"]);
  await verify("https://mcp.bittrees.org");
}
await mkdir("output/mcp-release", { recursive: true });
await writeFile(
  "output/mcp-release/evidence.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      target: target.origin,
      commit,
      alias: "mcp.bittrees.org",
      applied: apply,
      preflight,
    },
    null,
    2,
  ),
);
console.log(
  apply
    ? "MCP alias assigned and verified"
    : "MCP release verified; no alias changed",
);
