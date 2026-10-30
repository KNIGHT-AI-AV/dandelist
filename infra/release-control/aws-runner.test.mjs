import test from "node:test";
import assert from "node:assert/strict";
import { createAwsProvider, loadAwsProvider } from "./aws-provider.mjs";
import { createSourceVerifier } from "./source-proof.mjs";
import { parseArgs, runRelease } from "./aws-runner.mjs";

const SHA = "a".repeat(40), BLOB = "b".repeat(40), HASH = "c".repeat(64);
const CANARY = "SYNTHETIC_PRIVATE_VALUE_DO_NOT_LOG";
const definitions = {
  sts: ["STSClient", "GetCallerIdentity"],
  codebuild: ["CodeBuildClient", "BatchGetProjects", "BatchGetBuilds", "StartBuild"],
  ecr: ["ECRClient", "DescribeRepositories", "DescribeImages"],
  apprunner: ["AppRunnerClient", "DescribeService", "ListOperations", "UpdateService"],
};
function fakeSdk() {
  const configurations = [], calls = [], destroyed = [], sdk = {};
  let failure;
  for (const [service, [client, ...operations]] of Object.entries(definitions)) {
    sdk[service] = {
      [client]: class {
        constructor(config) { configurations.push({ service, config }); }
        async send(command, options) {
          calls.push({ service, command, options });
          if (failure) throw failure;
          command.input.nested.value = "SDK mutation";
          return { recorded: true };
        }
        destroy() { destroyed.push(service); }
      },
    };
    for (const op of operations) sdk[service][`${op}Command`] = class { constructor(input) { this.operation = op; this.input = input; } };
  }
  const provider = createAwsProvider({ sdk, credentials: { fixture: true }, region: "us-east-1" });
  return { provider, configurations, calls, destroyed, fail: (error) => { failure = error; } };
}

test("SDK bridge fixes one attempt, bounds calls, clones input and destroys all clients", async () => {
  const f = fakeSdk(), input = { nested: { value: "reviewed" } };
  assert.equal(f.configurations.length, 4);
  assert.ok(f.configurations.every(({ config }) => config.maxAttempts === 1 && config.region === "us-east-1" && config.credentials.fixture));
  await f.provider.call("codebuild", "StartBuild", input);
  assert.equal(input.nested.value, "reviewed");
  assert.equal(f.calls[0].command.operation, "StartBuild");
  assert.ok(f.calls[0].options.abortSignal instanceof AbortSignal);
  f.provider.destroy();
  assert.equal(f.destroyed.length, 4);
});

test("SDK bridge refuses provisioning, alternative mutations and inherited names", async () => {
  const f = fakeSdk();
  for (const [service, operation] of [["codebuild", "CreateProject"], ["apprunner", "StartDeployment"], ["ecr", "PutImage"], ["constructor", "GetCallerIdentity"], ["sts", "toString"]]) {
    await assert.rejects(f.provider.call(service, operation, {}), /not allowed/);
  }
  assert.equal(f.calls.length, 0);
  f.provider.destroy();
});

test("SDK failures never leak raw messages, arbitrary names or retry mutations", async () => {
  const f = fakeSdk();
  f.fail(Object.assign(new Error(CANARY), { name: CANARY, $response: { body: CANARY } }));
  await assert.rejects(f.provider.call("apprunner", "UpdateService", {}), (error) => /ProviderError/.test(error.message) && !error.message.includes(CANARY));
  assert.equal(f.calls.length, 1);
  f.fail(Object.assign(new Error(CANARY), { name: "AccessDeniedException" }));
  await assert.rejects(f.provider.call("codebuild", "StartBuild", {}), /AccessDeniedException/);
  assert.equal(f.calls.length, 2);
  f.provider.destroy();
});

test("invalid credentials/region and absent SDK root cannot fall back to another provider", async () => {
  assert.throws(() => createAwsProvider({ sdk: {}, region: "us-east-1" }), /Existing credentials/);
  assert.throws(() => createAwsProvider({ sdk: {}, credentials: {}, region: CANARY }), /explicit valid region/);
  await assert.rejects(loadAwsProvider({ sdkRoot: "\u0000", region: "us-east-1" }), (error) => /no creation, installation or fallback/.test(error.message) && !error.message.includes(CANARY));
});

const source = { sha: SHA, sourceUrl: "https://github.com/fixture-owner/fixture-api", buildspec: "infra/aws/buildspec.yml", blobs: { "infra/aws/buildspec.yml": BLOB, "apps/api/Dockerfile": BLOB } };
function sourceFixture() {
  const calls = [], reads = [];
  const values = new Map([
    ["remote get-url origin", "git@github.com:fixture-owner/fixture-api.git"],
    ["status --porcelain", ""], ["rev-parse HEAD", SHA], ["rev-parse origin/main", SHA],
    [`rev-parse ${SHA}:infra/aws/buildspec.yml`, BLOB], [`rev-parse ${SHA}:apps/api/Dockerfile`, BLOB],
  ]);
  let remote = SHA, failure = false;
  const verifier = createSourceVerifier({ worktree: "fixture-checkout", git: (...args) => { reads.push(args); return values.get(args.join(" ")); }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (failure) throw new Error(CANARY);
    return { ok: true, json: async () => ({ object: { sha: remote } }) };
  } });
  return { verifier, values, calls, reads, moveMain: () => { remote = "d".repeat(40); }, fail: () => { failure = true; } };
}

test("source proof checks clean exact local/remote SHA and both reviewed build blobs", async () => {
  const f = sourceFixture();
  await f.verifier(source);
  assert.equal(f.reads.length, 6);
  assert.equal(f.calls[0].url, "https://api.github.com/repos/fixture-owner/fixture-api/git/ref/heads/main");
  assert.equal(Object.keys(f.calls[0].options.headers).length, 1);
});

test("dirty, moved, wrong-origin and altered-build-file sources stop before mutation", async () => {
  for (const [key, value] of [["status --porcelain", " M changed"], ["rev-parse HEAD", "d".repeat(40)], ["rev-parse origin/main", "d".repeat(40)], ["remote get-url origin", "https://github.com/other/repo.git"], [`rev-parse ${SHA}:apps/api/Dockerfile`, "d".repeat(40)]]) {
    const f = sourceFixture(); f.values.set(key, value);
    await assert.rejects(f.verifier(source));
    assert.equal(f.calls.length, 0);
  }
});

test("public-main changes and unavailable source proof fail without raw output", async () => {
  const f = sourceFixture(); f.moveMain();
  await assert.rejects(f.verifier(source), /Public main moved/);
  f.fail();
  await assert.rejects(f.verifier(source), (error) => /raw response withheld/.test(error.message) && !error.message.includes(CANARY));
});

test("source proof rejects non-GitHub, credential-bearing and incomplete specifications", async () => {
  const f = sourceFixture();
  for (const url of ["http://localhost/private", "https://user:password@github.com/a/b", "https://github.com/a/b?token=fixture", "https://example.com/a/b"]) {
    await assert.rejects(f.verifier({ ...source, sourceUrl: url }));
  }
  await assert.rejects(f.verifier({ ...source, blobs: { "infra/aws/buildspec.yml": BLOB } }));
  assert.equal(f.calls.length, 0);
});

const common = ["--spec", "fixture.json", "--sdk-root", "fixture-sdk"];
const argsFor = (mode) => ["--mode", mode, ...common, ...(mode !== "already-deployed" ? ["--owner", "alice"] : []), ...(["prepare", "already-deployed"].includes(mode) ? ["--sha", SHA] : ["--attempt", "fixture-attempt"]), ...(["prepare", "build-plan", "deploy-plan", "submit-build", "submit-deploy"].includes(mode) ? ["--source-worktree", "fixture-checkout"] : []), ...(mode.startsWith("submit-") ? ["--request-hash", HASH] : [])];
function runnerFixture() {
  const events = [], observed = [];
  const adapter = Object.fromEntries(["prepare", "buildPlan", "deployPlan", "submit", "status", "alreadyDeployed"].map((name) => [name, async (input) => { observed.push({ name, input }); return name === "submit" ? "known-id" : { method: name }; }]));
  const deps = {
    readSpec: () => JSON.stringify({ serviceArn: "fixture-service", region: "us-east-1" }),
    createControl: (options) => { observed.push({ controlOptions: options }); return { inspect: async () => { events.push("inspect"); } }; },
    loadProvider: async () => { events.push("credentials"); return { destroy: () => { events.push("destroy"); } }; },
    sourceVerifier: () => { events.push("source-factory"); return async () => {}; },
    createAdapter: () => adapter,
  };
  return { deps, events, observed, adapter };
}

test("launcher validates modes/arguments before reading spec or loading credentials", async () => {
  for (const args of [[], ["--mode", "toString", ...common], [...argsFor("prepare"), "--sha", SHA], [...argsFor("prepare"), "--unexpected", "value"], ["--mode", "prepare", ...common]]) {
    const f = runnerFixture();
    f.deps.readSpec = () => { throw new Error("Spec must not be read"); };
    await assert.rejects(runRelease(args, f.deps));
    assert.equal(f.events.length, 0);
  }
  assert.throws(() => parseArgs(["--mode", "submit-deploy", ...common, "--owner", "alice", "--attempt", "known", "--source-worktree", "fixture"]), /request hash/);
  for (const mode of ["submit-build", "submit-deploy", "build-status", "deployment-status"]) {
    assert.throws(() => parseArgs([...argsFor(mode), "--sha", "d".repeat(40)]), /unused by this mode/);
  }
  assert.throws(() => parseArgs([...argsFor("prepare"), "--attempt", "ignored"]), /unused by this mode/);
  assert.throws(() => parseArgs([...argsFor("already-deployed"), "--owner", "ignored"]), /unused by this mode/);
});

test("launcher checks shared registration before credentials and never initializes implicitly", async () => {
  const f = runnerFixture();
  f.deps.createControl = () => ({ inspect: async () => { throw new Error("Missing registration"); } });
  await assert.rejects(runRelease(argsFor("prepare"), f.deps), /Missing registration/);
  assert.equal(f.events.length, 0);
});

test("invalid adapter specification stops before existing credentials are loaded", async () => {
  const f = runnerFixture();
  f.deps.createAdapter = () => { throw new Error("Invalid adapter specification"); };
  await assert.rejects(runRelease(argsFor("prepare"), f.deps), /Invalid adapter specification/);
  assert.deepEqual(f.events, ["inspect", "source-factory"]);
});

test("launcher dispatches only the selected phase and closes provider resources", async () => {
  const expected = { prepare: "prepare", "build-plan": "buildPlan", "deploy-plan": "deployPlan", "submit-build": "submit", "submit-deploy": "submit", "build-status": "status", "deployment-status": "status", "already-deployed": "alreadyDeployed" };
  for (const [mode, method] of Object.entries(expected)) {
    const f = runnerFixture();
    await runRelease(argsFor(mode), f.deps);
    assert.deepEqual(f.events, ["inspect", "source-factory", "credentials", "destroy"]);
    const call = f.observed.find((entry) => entry.name);
    assert.equal(call.name, method);
    if (["submit", "status"].includes(method)) assert.equal(call.input.phase, mode.includes("build") ? "build" : "deploy");
    if (method === "submit") assert.equal(call.input.requestHash, HASH);
    const controlOptions = f.observed[0].controlOptions;
    assert.ok(controlOptions.root.endsWith("release-control"));
    assert.ok(controlOptions.inbox.endsWith("INBOX.md") && controlOptions.outbox.endsWith("OUTBOX.md"));
  }
});

test("known-ID status needs no source checkout and failed adapter actions still close clients", async () => {
  const f = runnerFixture();
  f.adapter.status = async () => { throw new Error("Status temporarily unavailable"); };
  await assert.rejects(runRelease(argsFor("build-status"), f.deps), /temporarily unavailable/);
  assert.equal(f.events.at(-1), "destroy");
  assert.equal(parseArgs(argsFor("build-status"))["source-worktree"], undefined);
});
