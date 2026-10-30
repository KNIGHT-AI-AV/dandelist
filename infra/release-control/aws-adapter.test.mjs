import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ReleaseControl } from "./control.mjs";
import { AwsReleaseAdapter } from "./aws-adapter.mjs";

// Actual coordinator and adapter; only source verification and the raw AWS boundary are synthetic.
// No credentials, SDK, real service, installed dependency or provider transport belongs in this fixture.
const SHA = "a".repeat(40), OTHER_SHA = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`, OLD_DIGEST = `sha256:${"d".repeat(64)}`;
const OWNER = "fixture-owner", CANARY = "SYNTHETIC_ENV_VALUE_MUST_NOT_ENTER_A_PLAN";
const BUILD_ID = "fixture-image:11111111-1111-4111-8111-111111111111";
const OP_ID = "22222222-2222-4222-8222-222222222222";
const clone = (value) => structuredClone(value);
const canonical = (value) => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
const requestHash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const options = { timeout: 15_000 };

async function fixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "dandelist-aws-adapter-test-")));
  const unexpected = [], originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    assert.equal(realpathSync(sandbox), sandbox);
    assert.ok(basename(sandbox).startsWith("dandelist-aws-adapter-test-"));
    rmSync(sandbox, { recursive: true, force: true });
    assert.deepEqual(unexpected, []);
  });
  globalThis.fetch = async () => { unexpected.push("global fetch"); throw new Error("No network transport in adapter fixtures"); };
  const root = join(sandbox, "control");
  mkdirSync(root);
  const inbox = join(sandbox, "INBOX.md"), outbox = join(sandbox, "OUTBOX.md");
  writeFileSync(inbox, "Reviewed synthetic source.\n");
  writeFileSync(outbox, "Synthetic release claim.\n");
  const account = "123456789012", region = "us-east-1", project = "fixture-image", repository = "fixture-api";
  const repoURI = `${account}.dkr.ecr.${region}.amazonaws.com/${repository}`;
  const spec = {
    account, region, project, repository,
    serviceArn: `arn:aws:apprunner:${region}:${account}:service/fixture-api/${"1".repeat(32)}`,
    sourceUrl: "https://github.com/fixture-owner/fixture-api",
    buildspec: "infra/aws/buildspec.yml",
    blobs: { "infra/aws/buildspec.yml": "e".repeat(40), "apps/api/Dockerfile": "f".repeat(40) },
    port: "8080", computeType: "BUILD_GENERAL1_SMALL", timeoutMinutes: 20,
  };
  const source = { type: "GITHUB", location: spec.sourceUrl, buildspec: spec.buildspec };
  const state = {
    project: {
      name: project, arn: `arn:aws:codebuild:${region}:${account}:project/${project}`,
      source, environment: { computeType: spec.computeType, privilegedMode: true,
        environmentVariables: [{ name: "REPO_URI", value: repoURI, type: "PLAINTEXT" }] },
      timeoutInMinutes: 20, autoRetryLimit: 0,
    },
    repository: { repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${repository}`, registryId: account, repositoryUri: repoURI, repositoryName: repository },
    service: {
      ServiceArn: spec.serviceArn, ServiceName: "fixture-api", Status: "RUNNING",
      SourceConfiguration: {
        AutoDeploymentsEnabled: false,
        AuthenticationConfiguration: { AccessRoleArn: `arn:aws:iam::${account}:role/fixture-pull` },
        ImageRepository: { ImageRepositoryType: "ECR", ImageIdentifier: `${repoURI}@${OLD_DIGEST}`,
          ImageConfiguration: { Port: "8080", StartCommand: "node dist/main.js",
            RuntimeEnvironmentVariables: { SPEND_DAILY_USD: "2", SPEND_TOTAL_USD: "5", FIXTURE_ONLY: CANARY },
            RuntimeEnvironmentSecrets: { FIXTURE_REFERENCE: `arn:aws:ssm:${region}:${account}:parameter/fixture` } } },
      },
      InstanceConfiguration: { Cpu: "1024", Memory: "2048", InstanceRoleArn: `arn:aws:iam::${account}:role/fixture-app` },
      HealthCheckConfiguration: { Protocol: "HTTP", Path: "/healthz", Interval: 5, Timeout: 2, HealthyThreshold: 1, UnhealthyThreshold: 5 },
      NetworkConfiguration: { EgressConfiguration: { EgressType: "DEFAULT" }, IngressConfiguration: { IsPubliclyAccessible: true }, IpAddressType: "IPV4" },
      AutoScalingConfigurationSummary: { AutoScalingConfigurationArn: `arn:aws:apprunner:${region}:${account}:autoscalingconfiguration/fixture/1/${"2".repeat(32)}` },
      EncryptionConfiguration: { KmsKey: `arn:aws:kms:${region}:${account}:key/fixture` },
    },
    build: { id: BUILD_ID, projectName: project, sourceVersion: SHA, resolvedSourceVersion: SHA, source, buildStatus: "IN_PROGRESS" },
    operations: [], operationPages: null, imageDigest: DIGEST, sourceError: null, startError: null, updateError: null, hook: null,
  };
  const calls = [], sourceChecks = [], intents = [];
  let now = Date.parse("2026-10-30T15:00:00Z");
  const config = { root, service: spec.serviceArn, inbox, outbox, clock: () => now };
  const control = new ReleaseControl(config);
  await control.initialize({ owner: OWNER });
  const provider = {
    async call(service, operation, input) {
      calls.push({ service, operation, input: clone(input) });
      if (state.hook) await state.hook({ service, operation, input });
      const key = `${service}/${operation}`;
      const inputIs = (condition) => {
        if (condition) return;
        unexpected.push(`Wrong synthetic request target: ${key}`);
        throw new Error(`Wrong synthetic request target: ${key}`);
      };
      if (key === "sts/GetCallerIdentity") return { Account: account };
      if (key === "codebuild/BatchGetProjects") {
        inputIs(input.names?.length === 1 && input.names[0] === project);
        return { projects: [clone(state.project)], projectsNotFound: [] };
      }
      if (key === "ecr/DescribeRepositories") {
        inputIs(input.repositoryNames?.length === 1 && input.repositoryNames[0] === repository);
        return { repositories: [clone(state.repository)] };
      }
      if (key === "apprunner/DescribeService" || key === "apprunner/ListOperations") {
        inputIs(input.ServiceArn === spec.serviceArn);
        if (operation === "DescribeService") return { Service: clone(state.service) };
        if (!state.operationPages) return { OperationSummaryList: clone(state.operations) };
        const page = state.operationPages[input.NextToken ?? "first"];
        inputIs(Boolean(page));
        return clone(page);
      }
      if (key === "codebuild/BatchGetBuilds") {
        inputIs(input.ids?.length === 1 && input.ids[0] === BUILD_ID);
        return { builds: [clone(state.build)], buildsNotFound: [] };
      }
      if (key === "ecr/DescribeImages") {
        inputIs(input.repositoryName === repository && input.imageIds?.length === 1);
        const id = input.imageIds[0];
        inputIs([OLD_DIGEST, DIGEST].includes(id.imageDigest) || ["latest", SHA.slice(0, 12)].includes(id.imageTag));
        const old = id.imageDigest === OLD_DIGEST || id.imageTag === "latest";
        return { imageDetails: [{ registryId: account, repositoryName: repository,
          imageDigest: old ? OLD_DIGEST : state.imageDigest, imageTags: old ? ["latest"] : [SHA.slice(0, 12)] }] };
      }
      if (key === "codebuild/StartBuild" || key === "apprunner/UpdateService") {
        const saved = JSON.parse(readFileSync(control.journal, "utf8").trimEnd().split("\n").at(-1)).entry.state;
        intents.push({ operation, active: clone(saved.active) });
        if (key === "codebuild/StartBuild") {
          inputIs(input.projectName === project && input.sourceVersion === SHA);
          if (state.startError) throw state.startError;
          return { build: clone(state.build) };
        }
        inputIs(input.ServiceArn === spec.serviceArn);
        if (state.updateError) throw state.updateError;
        state.service.SourceConfiguration = clone(input.SourceConfiguration);
        state.service.Status = "OPERATION_IN_PROGRESS";
        state.operations = [{ Id: OP_ID, Type: "UPDATE_SERVICE", TargetArn: spec.serviceArn, Status: "IN_PROGRESS" }];
        return { OperationId: OP_ID, Service: clone(state.service) };
      }
      unexpected.push(key);
      throw new Error(`Unexpected synthetic provider operation: ${key}`);
    },
  };
  const verifySource = async (input) => {
    sourceChecks.push(clone(input));
    if (state.sourceError) throw state.sourceError;
  };
  const adapterOf = (coordinator = control, expected = spec) => new AwsReleaseAdapter({ control: coordinator, provider, verifySource, spec: expected, clock: () => now });
  const adapter = adapterOf();
  return { sandbox, root, config, spec, repoURI, state, calls, sourceChecks, intents, control, adapter, adapterOf,
    advance: (ms) => { now += ms; }, mutations: () => calls.filter((c) => ["StartBuild", "UpdateService"].includes(c.operation)) };
}

async function prepared(f) {
  const attempt = await f.adapter.prepare({ sha: SHA, owner: OWNER });
  return { attempt, identity: { attemptId: attempt.id, owner: OWNER } };
}
async function cleared(f, identity, phase, adapter = f.adapter, control = f.control) {
  const plan = await adapter[phase === "build" ? "buildPlan" : "deployPlan"](identity);
  await control.grant({ ...identity, phase, requestHash: plan.requestHash, fingerprints: control.fingerprints() });
  return { ...identity, phase, requestHash: plan.requestHash };
}
async function built(f) {
  const p = await prepared(f);
  await f.adapter.submit(await cleared(f, p.identity, "build"));
  f.state.build.buildStatus = "SUCCEEDED";
  await f.adapter.status({ ...p.identity, phase: "build" });
  return p;
}

test("a reviewed exact-source build persists intent before the single raw SDK call, without leaking environment into plans", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  const input = await cleared(f, identity, "build");
  assert.equal(await f.adapter.submit(input), BUILD_ID);
  const sent = f.mutations();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].operation, "StartBuild");
  assert.equal(sent[0].input.projectName, f.spec.project);
  assert.equal(sent[0].input.sourceVersion, SHA);
  assert.equal(typeof sent[0].input.idempotencyToken, "string");
  assert.equal(f.intents[0].active.build.status, "INTENT");
  assert.equal(f.intents[0].active.build.id, null);
  assert.equal(f.intents[0].active.build.token, sent[0].input.idempotencyToken);
  assert.equal(f.intents[0].active.build.requestHash, input.requestHash);
  const actualRequest = clone(sent[0].input);
  delete actualRequest.idempotencyToken;
  assert.equal(requestHash(actualRequest), input.requestHash, "Hash the actual raw SDK input, not a separately reconstructed description");
  assert.ok(f.sourceChecks.length > 0);
  assert.ok(f.sourceChecks.every((c) => c.sha === SHA && c.sourceUrl === f.spec.sourceUrl));
  const plans = readdirSync(f.root).filter((name) => /^aws-plan-.*\.json$/.test(name));
  assert.ok(plans.length > 0);
  for (const name of plans) assert.equal(readFileSync(join(f.root, name), "utf8").includes(CANARY), false);
});

test("caller mutation cannot replace the adapter's declared source, resource or nested blob selection", options, async (t) => {
  const f = await fixture(t), selected = clone(f.spec);
  f.spec.project = "unreviewed-project";
  f.spec.sourceUrl = "https://github.com/fixture-owner/unreviewed-source";
  f.spec.blobs["infra/aws/buildspec.yml"] = "0".repeat(40);
  const { identity } = await prepared(f);
  await f.adapter.submit(await cleared(f, identity, "build"));
  assert.equal(f.mutations()[0].input.projectName, selected.project);
  assert.ok(f.sourceChecks.every((input) => input.sourceUrl === selected.sourceUrl));
  assert.ok(f.sourceChecks.every((input) => input.blobs["infra/aws/buildspec.yml"] === selected.blobs["infra/aws/buildspec.yml"]));
});

for (const drift of ["source", "buildspec", "auto-retry", "protected-environment"]) {
  test(`drift after preparation blocks mutation: ${drift}`, options, async (t) => {
    const f = await fixture(t), { identity } = await prepared(f);
    const input = await cleared(f, identity, "build");
    if (drift === "source") f.state.sourceError = new Error("Synthetic source proof changed");
    if (drift === "buildspec") f.state.project.source.buildspec = "unreviewed.yml";
    if (drift === "auto-retry") f.state.project.autoRetryLimit = 2;
    if (drift === "protected-environment") f.state.service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.SPEND_DAILY_USD = "200";
    await assert.rejects(f.adapter.submit(input));
    assert.equal(f.mutations().length, 0);
    assert.equal((await f.control.inspect()).active.build, null, "A known preflight rejection must not record ambiguous provider intent");
  });
}

test("an environment change during the build cannot be silently adopted for deployment", options, async (t) => {
  const f = await fixture(t), { identity } = await built(f);
  f.state.service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.SPEND_TOTAL_USD = "500";
  await assert.rejects(f.adapter.deployPlan(identity));
  assert.equal(f.mutations().filter((c) => c.operation === "UpdateService").length, 0);
});

test("a mailbox change during the last asynchronous preflight prevents submission", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  const input = await cleared(f, identity, "build");
  let changed = false;
  f.state.hook = async ({ operation }) => {
    if (!changed && operation === "DescribeService") {
      changed = true;
      await Promise.resolve();
      writeFileSync(f.config.inbox, "A new synthetic review hold arrived.\n");
    }
  };
  await assert.rejects(f.adapter.submit(input));
  assert.equal(changed, true, "Exercise an actual asynchronous preflight boundary");
  assert.equal(f.mutations().length, 0);
  assert.equal((await f.control.inspect()).active.build, null);
});

test("a failed preflight read permits fresh review and exactly one subsequent provider mutation", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  const input = await cleared(f, identity, "build");
  let interrupted = false;
  f.state.hook = async ({ operation }) => {
    if (!interrupted && operation === "DescribeService") {
      interrupted = true;
      await Promise.resolve();
      throw new Error("Synthetic read timeout before any mutation");
    }
  };
  await assert.rejects(f.adapter.submit(input));
  assert.equal(interrupted, true);
  assert.equal(f.mutations().length, 0);
  assert.equal((await f.control.inspect()).active.build, null);
  f.state.hook = null;
  const reviewed = await cleared(f, identity, "build");
  assert.equal(await f.adapter.submit(reviewed), BUILD_ID);
  assert.equal(f.mutations().length, 1);
  assert.equal(f.intents.length, 1);
});

test("a structured hold can register during asynchronous preflight and prevents any mutation intent", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  const input = await cleared(f, identity, "build");
  let holdId;
  f.state.hook = async ({ operation }) => {
    if (!holdId && operation === "DescribeService") {
      holdId = await f.control.hold({ owner: "fixture-reviewer", reason: "Synthetic review arrived during the provider read" });
    }
  };
  await assert.rejects(f.adapter.submit(input));
  assert.equal(typeof holdId, "string", "The hold must actually register while preflight is running");
  const state = await f.control.inspect();
  assert.ok(state.holds.some((hold) => hold.id === holdId));
  assert.equal(state.active.build, null);
  assert.equal(f.mutations().length, 0);
});

test("an ambiguous build response stays blocked after reopening and fresh clearance beyond provider token lifetime", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  const input = await cleared(f, identity, "build");
  f.state.startError = new Error("Synthetic response lost after possible acceptance");
  await assert.rejects(f.adapter.submit(input));
  assert.equal(f.mutations().length, 1);
  assert.equal((await f.control.inspect()).active.build.id, null);
  f.advance(24 * 60 * 60 * 1000);
  f.state.startError = null;
  const reopened = new ReleaseControl(f.config), other = f.adapterOf(reopened);
  await reopened.grant({ ...input, fingerprints: reopened.fingerprints() });
  await assert.rejects(other.submit(input));
  assert.equal(f.mutations().length, 1);
});

test("a known build resumes through the shared plan from another working directory without another StartBuild", options, async (t) => {
  const f = await fixture(t);
  const priorCwd = process.cwd(), a = join(f.sandbox, "runner-a"), b = join(f.sandbox, "runner-b");
  mkdirSync(a); mkdirSync(b);
  try {
    process.chdir(a);
    const { attempt, identity } = await prepared(f);
    await f.adapter.submit(await cleared(f, identity, "build"));
    process.chdir(b);
    const other = f.adapterOf(new ReleaseControl(f.config));
    assert.equal((await other.prepare({ sha: SHA, owner: OWNER })).id, attempt.id);
    f.state.build.buildStatus = "SUCCEEDED";
    await other.status({ ...identity, phase: "build" });
    assert.equal(f.mutations().length, 1);
    assert.ok(f.calls.filter((c) => c.operation === "BatchGetBuilds").every((c) => c.input.ids.length === 1 && c.input.ids[0] === BUILD_ID));
  } finally { process.chdir(priorCwd); }
});

for (const mode of ["missing", "modified"]) {
  test(`a ${mode} immutable shared plan cannot be regenerated on resume`, options, async (t) => {
    const f = await fixture(t), { attempt } = await prepared(f);
    const path = join(f.root, `aws-plan-${attempt.planHash}.json`);
    if (mode === "missing") rmSync(path);
    else {
      const changed = JSON.parse(readFileSync(path, "utf8"));
      changed.spec.sourceUrl = "https://github.com/fixture-owner/unreviewed-source";
      writeFileSync(path, JSON.stringify(changed));
    }
    const other = f.adapterOf(new ReleaseControl(f.config));
    await assert.rejects(other.prepare({ sha: SHA, owner: OWNER }));
    assert.equal(f.mutations().length, 0);
    assert.equal((await f.control.inspect()).active.id, attempt.id);
  });
}

test("unresolved checkout stays pending; a different resolved SHA never becomes verified", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  await f.adapter.submit(await cleared(f, identity, "build"));
  delete f.state.build.resolvedSourceVersion;
  const pending = await f.adapter.status({ ...identity, phase: "build" });
  assert.equal(pending.sourcePending, true);
  assert.equal((await f.control.inspect()).active.build.digest, undefined);
  f.state.build.buildStatus = "SUCCEEDED";
  f.state.build.resolvedSourceVersion = OTHER_SHA;
  await assert.rejects(f.adapter.status({ ...identity, phase: "build" }));
  assert.equal((await f.control.inspect()).active.build.digest, undefined);
  assert.equal(f.mutations().length, 1);
});

test("a terminal build before checkout is reported failed without fabricating a resolved SHA", options, async (t) => {
  const f = await fixture(t), { identity } = await prepared(f);
  await f.adapter.submit(await cleared(f, identity, "build"));
  delete f.state.build.resolvedSourceVersion;
  for (const providerStatus of ["FAILED", "FAULT", "STOPPED", "TIMED_OUT"]) {
    f.state.build.buildStatus = providerStatus;
    const result = await f.adapter.status({ ...identity, phase: "build" });
    assert.equal(result.status, "FAILED");
    assert.equal(result.providerStatus, providerStatus);
    assert.equal(result.sha, undefined);
    assert.equal(result.digest, undefined);
    assert.notEqual(result.sourcePending, true);
    assert.equal((await f.control.inspect()).active.build.digest, undefined);
  }
  assert.equal(f.mutations().length, 1);
});

test("deployment changes only the immutable image while retaining protected settings, then verifies a no-op", options, async (t) => {
  const f = await fixture(t), { identity } = await built(f);
  const before = clone(f.state.service);
  const input = await cleared(f, identity, "deploy");
  assert.equal(await f.adapter.submit(input), OP_ID);
  const calls = f.mutations();
  assert.equal(calls.length, 2);
  const request = calls[1].input;
  assert.equal(requestHash(request), input.requestHash);
  assert.equal(request.ServiceArn, f.spec.serviceArn);
  const expected = clone(before.SourceConfiguration);
  expected.ImageRepository.ImageIdentifier = `${f.repoURI}@${DIGEST}`;
  assert.deepEqual(request.SourceConfiguration, expected);
  assert.equal(request.EncryptionConfiguration, undefined, "Encryption is protected evidence, not an UpdateService field");
  for (const field of ["InstanceConfiguration", "HealthCheckConfiguration", "NetworkConfiguration"]) {
    if (request[field] !== undefined) assert.deepEqual(request[field], before[field]);
  }
  assert.equal(f.intents[1].active.deploy.status, "INTENT");
  f.state.service.Status = "RUNNING";
  f.state.operations[0].Status = "SUCCEEDED";
  f.state.operationPages = {
    first: { OperationSummaryList: [{ Id: "another-completed-operation", Type: "UPDATE_SERVICE", TargetArn: f.spec.serviceArn, Status: "SUCCEEDED" }], NextToken: "recorded-operation-page" },
    "recorded-operation-page": { OperationSummaryList: clone(f.state.operations) },
  };
  await f.adapter.status({ ...identity, phase: "deploy" });
  assert.ok(f.calls.some((call) => call.operation === "ListOperations" && call.input.NextToken === "recorded-operation-page"));
  assert.equal((await f.control.inspect()).active, null);
  assert.equal((await f.adapter.alreadyDeployed({ sha: SHA })).alreadyDeployed, true);
  assert.equal(f.mutations().length, 2);
});

test("a lost UpdateService response never produces another update after reopening and fresh clearance", options, async (t) => {
  const f = await fixture(t), { identity } = await built(f);
  const input = await cleared(f, identity, "deploy");
  f.state.updateError = new Error("Synthetic response lost after possible update acceptance");
  await assert.rejects(f.adapter.submit(input));
  assert.equal(f.mutations().length, 2);
  assert.equal((await f.control.inspect()).active.deploy.id, null);
  f.advance(24 * 60 * 60 * 1000);
  f.state.updateError = null;
  const reopened = new ReleaseControl(f.config), other = f.adapterOf(reopened);
  await reopened.grant({ ...input, fingerprints: reopened.fingerprints() });
  await assert.rejects(other.submit(input));
  assert.equal(f.mutations().length, 2);
});

for (const mode of ["wrong-target", "wrong-type", "duplicate-id", "rollback-success", "config-drift"]) {
  test(`an operation cannot become a successful release on ${mode}`, options, async (t) => {
    const f = await fixture(t), { identity } = await built(f);
    await f.adapter.submit(await cleared(f, identity, "deploy"));
    f.state.service.Status = "RUNNING";
    f.state.operations[0].Status = "SUCCEEDED";
    if (mode === "wrong-target") f.state.operations[0].TargetArn += "-other";
    if (mode === "wrong-type") f.state.operations[0].Type = "START_DEPLOYMENT";
    if (mode === "duplicate-id") f.state.operationPages = {
      first: { OperationSummaryList: clone(f.state.operations), NextToken: "duplicate-operation-page" },
      "duplicate-operation-page": { OperationSummaryList: clone(f.state.operations) },
    };
    if (mode === "rollback-success") f.state.operations[0].Status = "ROLLBACK_SUCCEEDED";
    if (mode === "config-drift") f.state.service.InstanceConfiguration.Memory = "4096";
    let failure;
    try { await f.adapter.status({ ...identity, phase: "deploy" }); } catch (error) { failure = error; }
    const saved = await f.control.inspect();
    assert.equal(saved.completed[SHA], undefined);
    assert.ok(saved.active);
    assert.ok(failure || saved.active.deploy.status === "FAILED");
    assert.equal(f.mutations().length, 2);
  });
}
