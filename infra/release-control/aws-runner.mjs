import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ReleaseControl, defaultControlRoot } from "./control.mjs";
import { AwsReleaseAdapter } from "./aws-adapter.mjs";
import { loadAwsProvider } from "./aws-provider.mjs";
import { createSourceVerifier } from "./source-proof.mjs";

const modes = new Set(["prepare", "build-plan", "deploy-plan", "submit-build", "submit-deploy", "build-status", "deployment-status", "already-deployed"]);
const flags = new Set(["--mode", "--spec", "--sdk-root", "--source-worktree", "--owner", "--sha", "--attempt", "--request-hash"]);
const modeArguments = {
  prepare: ["owner", "sha", "source-worktree"],
  "build-plan": ["owner", "attempt", "source-worktree"],
  "deploy-plan": ["owner", "attempt", "source-worktree"],
  "submit-build": ["owner", "attempt", "source-worktree", "request-hash"],
  "submit-deploy": ["owner", "attempt", "source-worktree", "request-hash"],
  "build-status": ["owner", "attempt"],
  "deployment-status": ["owner", "attempt"],
  "already-deployed": ["sha"],
};
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = argv.slice(i, i + 2);
    if (!flags.has(flag) || typeof value !== "string" || !value || value.startsWith("--") || Object.hasOwn(args, flag.slice(2))) throw new Error("Invalid, missing or duplicate launcher argument");
    args[flag.slice(2)] = value;
  }
  if (!modes.has(args.mode) || !args.spec || !args["sdk-root"]) throw new Error("Mode, reviewed spec and installed SDK root are required");
  if (Object.keys(args).some((name) => !["mode", "spec", "sdk-root", ...modeArguments[args.mode]].includes(name))) throw new Error("Argument is unused by this mode; use only its exact attempt or source identity");
  if (args.mode === "prepare" || args.mode === "already-deployed") {
    if (!/^[a-f0-9]{40}$/.test(args.sha ?? "")) throw new Error("Exact source SHA required");
  } else if (!args.attempt) throw new Error("Known attempt ID required");
  if (args.mode !== "already-deployed" && !args.owner?.trim()) throw new Error("Named owner required");
  if (["prepare", "build-plan", "deploy-plan", "submit-build", "submit-deploy"].includes(args.mode) && !args["source-worktree"]) throw new Error("Source worktree required for mutation planning");
  if (args.mode.startsWith("submit-") && !/^[a-f0-9]{64}$/.test(args["request-hash"] ?? "")) throw new Error("Reviewed request hash required");
  return args;
}

/** Dependency injection is for offline tests; the supported CLI fixes the shared root/mailboxes. */
export async function runRelease(argv, dependencies = {}) {
  const args = parseArgs(argv);
  let spec;
  try { spec = JSON.parse((dependencies.readSpec ?? ((path) => readFileSync(path, "utf8")))(args.spec)); }
  catch { throw new Error("Reviewed nonsecret specification could not be read"); }
  if (!spec || typeof spec.serviceArn !== "string" || typeof spec.region !== "string") throw new Error("Reviewed service and region are required");
  const root = defaultControlRoot();
  const master = join(root, "..");
  const control = (dependencies.createControl ?? ((options) => new ReleaseControl(options)))({ root, service: spec.serviceArn, inbox: join(master, "INBOX.md"), outbox: join(master, "OUTBOX.md") });
  // Check registration before loading credentials; never auto-initialize production history.
  await control.inspect();
  let provider;
  const verifySource = (dependencies.sourceVerifier ?? createSourceVerifier)({ worktree: args["source-worktree"] });
  // Constructor validation must finish before the existing credential provider is loaded.
  const transport = { call: (...input) => provider.call(...input) };
  const adapter = (dependencies.createAdapter ?? ((options) => new AwsReleaseAdapter(options)))({ control, provider: transport, verifySource, spec });
  provider = await (dependencies.loadProvider ?? loadAwsProvider)({ sdkRoot: args["sdk-root"], region: spec.region });
  try {
    const identity = { attemptId: args.attempt, owner: args.owner };
    switch (args.mode) {
      case "prepare": return await adapter.prepare({ sha: args.sha, owner: args.owner });
      case "build-plan": return await adapter.buildPlan(identity);
      case "deploy-plan": return await adapter.deployPlan(identity);
      case "submit-build": return { buildId: await adapter.submit({ ...identity, phase: "build", requestHash: args["request-hash"] }) };
      case "submit-deploy": return { operationId: await adapter.submit({ ...identity, phase: "deploy", requestHash: args["request-hash"] }) };
      case "build-status": return await adapter.status({ ...identity, phase: "build" });
      case "deployment-status": return await adapter.status({ ...identity, phase: "deploy" });
      case "already-deployed": return await adapter.alreadyDeployed({ sha: args.sha });
    }
  } finally { provider.destroy?.(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runRelease(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2))).catch(() => {
    // Even local/SDK exception messages can contain credentials, environment values or raw paths.
    console.error("Release action stopped. Preserve its shared journal and inspect the recorded phase; no automatic retry or replacement was attempted.");
    process.exitCode = 1;
  });
}
