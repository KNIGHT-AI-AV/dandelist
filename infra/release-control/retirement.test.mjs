import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseControl } from "./control.mjs";
import { ReleaseControl as LegacyControl } from "./fixtures/legacy-v1-control.mjs";

const SHA = "a".repeat(40), MAIN = "b".repeat(40), PREVIOUS = "c".repeat(40);
const CONFIG = "d".repeat(64), PLAN = "e".repeat(64);
const DIGEST = `sha256:${"f".repeat(64)}`;
const BUILD_REQUEST = "1".repeat(64), DEPLOY_REQUEST = "2".repeat(64);
const OWNER = "fixture-owner", PEER = "fixture-peer";
const options = { timeout: 15_000 };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "dandelist-retirement-test-")));
  const root = join(sandbox, "control");
  mkdirSync(root);
  const inbox = join(sandbox, "INBOX.md"), outbox = join(sandbox, "OUTBOX.md");
  writeFileSync(inbox, "reviewed fixture inbox\n");
  writeFileSync(outbox, "reviewed fixture outbox\n");
  const config = { root, service: "fixture-account:fixture-region:retirement-service", inbox, outbox };
  const control = new ReleaseControl(config);
  const workers = [];
  t.after(async () => {
    for (const worker of workers) {
      if (!worker.closed) worker.child.kill();
      await worker.exit;
    }
    // Never recursively remove anything but this exact freshly created temporary sandbox.
    assert.equal(realpathSync(sandbox), sandbox);
    assert.ok(basename(sandbox).startsWith("dandelist-retirement-test-"));
    rmSync(sandbox, { recursive: true, force: true });
  });
  await control.initialize({ owner: OWNER });
  return { sandbox, config, control, workers };
}
const begin = (control, sha = SHA, owner = OWNER) => control.begin({ sha, owner, configurationHash: CONFIG, planHash: PLAN });
const phaseInput = (attempt, phase = "build", owner = OWNER) => ({
  attemptId: attempt.id, owner, phase, requestHash: phase === "build" ? BUILD_REQUEST : DEPLOY_REQUEST,
});
const grant = (control, attempt, phase = "build") => control.grant({ ...phaseInput(attempt, phase), fingerprints: control.fingerprints() });
async function built(control, attempt) {
  await grant(control, attempt);
  await control.submit(phaseInput(attempt), async () => ({ id: `fixture-build-${attempt.sha}` }));
  await control.observeBuild({ attemptId: attempt.id, owner: OWNER }, async (id) => ({ id, sha: attempt.sha, status: "SUCCEEDED", digest: DIGEST }));
}
async function completed(control, attempt) {
  await built(control, attempt);
  await grant(control, attempt, "deploy");
  await control.submit(phaseInput(attempt, "deploy"), async () => ({ id: "fixture-completed-operation" }));
  await control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async (id) => ({ id, sha: attempt.sha, status: "SUCCEEDED", digest: DIGEST, configurationHash: CONFIG }));
}
async function retirementInput(control) {
  const state = await control.inspect(), a = state.active;
  return {
    attemptId: a.id, owner: a.owner, sha: a.sha,
    buildId: a.build?.id ?? `fixture-build-${a.sha}`, digest: a.build?.digest ?? DIGEST,
    configurationHash: a.configurationHash, planHash: a.planHash,
    expectedSeq: state.seq, expectedRevision: state.revision,
    fingerprints: control.fingerprints(), observedMainSha: MAIN,
    reason: "Reviewed main advanced after the known build; do not deploy this attempt.",
    evidence: "fixture-review.md#successful-build-without-deploy",
  };
}
const bytes = (control) => ({ journal: readFileSync(control.journal), registration: readFileSync(control.registration) });
function unchanged(control, before) {
  assert.deepEqual(readFileSync(control.journal), before.journal);
  assert.deepEqual(readFileSync(control.registration), before.registration);
}
async function rejectsWithoutWrite(control, input) {
  const before = bytes(control);
  await assert.rejects(control.retireUndeployed(input));
  unchanged(control, before);
}

// Only corrupt temporary fixture state. Appending a checksummed synthetic row lets semantic
// validation be tested independently of the already-covered broken-hash detector.
function appendFixtureState(control, change) {
  const rows = readFileSync(control.journal, "utf8").trimEnd().split("\n").map(JSON.parse);
  const previous = rows.at(-1), state = structuredClone(previous.entry.state);
  change(state);
  state.seq++;
  const entry = { at: new Date().toISOString(), event: "synthetic_test_state", state };
  const hash = sha256(JSON.stringify(entry));
  appendFileSync(control.journal, JSON.stringify({ previous: previous.hash, hash, entry }) + "\n");
  writeFileSync(control.registration, JSON.stringify({ service: control.service, seq: state.seq, hash }));
}

function worker(f, name) {
  const cwd = join(f.sandbox, name);
  mkdirSync(cwd);
  const ready = deferred(), starting = deferred(), entered = deferred(), outcome = deferred(), exited = deferred();
  const child = fork(fileURLToPath(new URL("./fixtures/retirement-worker.mjs", import.meta.url)), [], {
    cwd, execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const result = { child, closed: false, ready: ready.promise, starting: starting.promise, entered: entered.promise, outcome: outcome.promise, exit: exited.promise };
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  child.on("message", (message) => {
    if (message.type === "ready") ready.resolve(true);
    if (message.type === "starting") starting.resolve(message);
    if (message.type === "entered") entered.resolve(true);
    if (message.type === "result") outcome.resolve(message);
  });
  child.on("error", (error) => {
    ready.resolve(false); starting.resolve(false);
    outcome.resolve({ ok: false, message: error.message });
  });
  child.on("close", (code, signal) => {
    result.closed = true;
    ready.resolve(false); starting.resolve(false);
    outcome.resolve({ ok: false, message: `Worker exited ${code ?? signal}: ${stderr}` });
    exited.resolve();
  });
  f.workers.push(result);
  return result;
}

// The real previous coordinator is frozen as a test-only fixture, not a simulated version check.
test("retirement upgrades intact v1 history, archives the exact attempt and makes the old writer reject it", options, async (t) => {
  assert.equal(sha256(readFileSync(new URL("./fixtures/legacy-v1-control.mjs", import.meta.url))), "85726aee33ad238cd6edb9fa8822f7604877681e01b8fcda056924c8d4f19f92");
  const f = await fixture(t);
  const older = await begin(f.control, PREVIOUS);
  await completed(f.control, older);
  const attempt = await begin(f.control);
  await built(f.control, attempt);
  await grant(f.control, attempt, "deploy");
  const input = await retirementInput(f.control), before = await f.control.inspect(), beforeBytes = bytes(f.control);
  assert.equal(before.version, 1);
  assert.deepEqual(await new LegacyControl(f.config).inspect(), before);
  await f.control.retireUndeployed(input);
  const reopened = new ReleaseControl(f.config), after = await reopened.inspect();
  assert.equal(after.version, 2);
  assert.equal(after.seq, before.seq + 1);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.active, null);
  assert.deepEqual(after.completed, before.completed);
  assert.deepEqual(after.holds, before.holds);
  const archived = after.retired[SHA];
  assert.deepEqual(archived.attempt, before.active);
  assert.equal(archived.attempt.deploy, null);
  assert.equal(archived.reason, input.reason);
  assert.equal(archived.evidence, input.evidence);
  assert.equal(archived.observedMainSha, MAIN);
  assert.ok(Number.isFinite(Date.parse(archived.retiredAt)));
  assert.deepEqual(archived.reviewed, { seq: before.seq, revision: before.revision, fingerprints: input.fingerprints });
  assert.deepEqual(readFileSync(reopened.journal).subarray(0, beforeBytes.journal.length), beforeBytes.journal);
  const event = JSON.parse(readFileSync(reopened.journal, "utf8").trimEnd().split("\n").at(-1)).entry.event;
  assert.equal(typeof event === "string" ? event : event.type, "attempt_retired_undeployed");
  const afterBytes = bytes(reopened), legacy = new LegacyControl(f.config);
  let providerCalls = 0;
  await assert.rejects(legacy.inspect());
  await assert.rejects(legacy.begin({ sha: MAIN, owner: OWNER, configurationHash: CONFIG, planHash: PLAN }));
  await assert.rejects(legacy.submit(phaseInput(attempt, "deploy"), async () => { providerCalls++; return { id: "never" }; }));
  assert.equal(providerCalls, 0);
  unchanged(reopened, afterBytes);
  await rejectsWithoutWrite(reopened, input);
  await assert.rejects(begin(reopened, SHA));
  let alreadyDeployedReads = 0;
  await assert.rejects(reopened.alreadyDeployed({ sha: SHA }, async () => { alreadyDeployedReads++; return { sha: SHA, digest: DIGEST, configurationHash: CONFIG, status: "RUNNING" }; }));
  assert.equal(alreadyDeployedReads, 0);
  const next = await begin(reopened, MAIN);
  assert.equal(next.sha, MAIN);
  assert.deepEqual((await reopened.inspect()).retired[SHA], archived);
});

test("a subsequent retirement preserves the earlier version2 archive", options, async (t) => {
  const f = await fixture(t), first = await begin(f.control);
  await built(f.control, first);
  await f.control.retireUndeployed(await retirementInput(f.control));
  const archived = (await f.control.inspect()).retired[SHA];
  const second = await begin(f.control, MAIN);
  await built(f.control, second);
  const input = { ...await retirementInput(f.control), observedMainSha: PREVIOUS };
  await f.control.retireUndeployed(input);
  const reopened = await new ReleaseControl(f.config).inspect();
  assert.equal(reopened.version, 2);
  assert.equal(reopened.active, null);
  assert.deepEqual(reopened.retired[SHA], archived);
  assert.equal(reopened.retired[MAIN].attempt.id, second.id);
  assert.deepEqual(Object.keys(reopened.retired).sort(), [SHA, MAIN].sort());
});

test("retirement preserves review holds and does not authorize the next release", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  const holdId = await f.control.hold({ owner: PEER, reason: "Independent fixture review still open" });
  const before = await f.control.inspect();
  await f.control.retireUndeployed(await retirementInput(f.control));
  const after = await f.control.inspect();
  assert.deepEqual(after.holds, before.holds);
  assert.equal(after.holds[0].id, holdId);
  await assert.rejects(begin(f.control, MAIN));
  await f.control.resolveHold({ id: holdId, owner: PEER, resolution: "Separate fixture evidence resolves this hold" });
  assert.equal((await begin(f.control, MAIN)).sha, MAIN);
});

test("every retirement identity and review field is required, exact and valid", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  const input = await retirementInput(f.control);
  for (const key of Object.keys(input)) {
    const missing = { ...input }; delete missing[key];
    await rejectsWithoutWrite(f.control, missing);
  }
  for (const mismatch of [
    { attemptId: "different-attempt" }, { owner: PEER }, { sha: PREVIOUS }, { sha: "bad-sha" },
    { buildId: "different-build" }, { digest: `sha256:${"0".repeat(64)}` }, { digest: "bad-digest" },
    { configurationHash: "0".repeat(64) }, { planHash: "0".repeat(64) },
    { expectedSeq: input.expectedSeq - 1 }, { expectedRevision: input.expectedRevision + 1 },
    { expectedSeq: 1.5 }, { expectedRevision: -1 },
    { observedMainSha: SHA }, { observedMainSha: "main" }, { reason: " " }, { evidence: "" },
    { fingerprints: {} }, { fingerprints: { ...input.fingerprints, inbox: "0".repeat(64) } },
  ]) await rejectsWithoutWrite(f.control, { ...input, ...mismatch });
  assert.equal((await f.control.inspect()).active.id, attempt.id);
});

for (const mailbox of ["inbox", "outbox"]) {
  test(`same-length ${mailbox} edits reject retirement without refreshing the reviewed snapshot`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    await built(f.control, attempt);
    const input = await retirementInput(f.control), path = f.config[mailbox];
    writeFileSync(path, "x".repeat(readFileSync(path).length));
    await rejectsWithoutWrite(f.control, input);
    await f.control.retireUndeployed(await retirementInput(f.control));
    assert.equal((await f.control.inspect()).active, null);
  });
}

test("a fresh observation invalidates an older exact-state retirement review", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  const input = await retirementInput(f.control);
  await f.control.observeBuild({ attemptId: attempt.id, owner: OWNER }, async (id) => ({ id, sha: SHA, status: "SUCCEEDED", digest: DIGEST }));
  await rejectsWithoutWrite(f.control, input);
  await f.control.retireUndeployed(await retirementInput(f.control));
});

test("a pending transfer blocks both actors; acknowledgement permits only the new owner", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  await f.control.transfer({ attemptId: attempt.id, owner: OWNER, to: PEER });
  const pending = await retirementInput(f.control);
  await rejectsWithoutWrite(f.control, pending);
  await rejectsWithoutWrite(f.control, { ...pending, owner: PEER });
  await f.control.acceptTransfer({ attemptId: attempt.id, owner: PEER });
  const accepted = await retirementInput(f.control);
  await rejectsWithoutWrite(f.control, { ...accepted, owner: OWNER });
  await f.control.retireUndeployed(accepted);
  assert.equal((await f.control.inspect()).retired[SHA].attempt.owner, PEER);
});

for (const buildState of ["absent", "intent", "running", "failed"]) {
  test(`a ${buildState} build cannot be retired by the successful-build path`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    if (buildState !== "absent") {
      await grant(f.control, attempt);
      if (buildState === "intent") {
        await assert.rejects(f.control.submit(phaseInput(attempt), async () => { throw new Error("Synthetic lost build response"); }));
      } else {
        await f.control.submit(phaseInput(attempt), async () => ({ id: "fixture-known-build" }));
        if (buildState === "failed") await f.control.observeBuild({ attemptId: attempt.id, owner: OWNER }, async (id) => ({ id, sha: SHA, status: "FAILED" }));
      }
    }
    await rejectsWithoutWrite(f.control, await retirementInput(f.control));
    assert.equal((await f.control.inspect()).active.id, attempt.id);
  });
}

for (const deployState of ["intent", "running", "failed"]) {
  test(`a ${deployState} deploy is never erased by no-deploy retirement`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    await built(f.control, attempt);
    await grant(f.control, attempt, "deploy");
    if (deployState === "intent") {
      await assert.rejects(f.control.submit(phaseInput(attempt, "deploy"), async () => { throw new Error("Synthetic lost UpdateService response"); }));
    } else {
      await f.control.submit(phaseInput(attempt, "deploy"), async () => ({ id: "fixture-known-operation" }));
      if (deployState === "failed") await f.control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async (id) => ({ id, status: "FAILED" }));
    }
    await rejectsWithoutWrite(f.control, await retirementInput(f.control));
    const retained = (await f.control.inspect()).active;
    assert.notEqual(retained.deploy, null);
    if (deployState === "intent") {
      assert.equal(retained.deploy.id, null);
      let calls = 0;
      await assert.rejects(f.control.submit(phaseInput(attempt, "deploy"), async () => { calls++; return { id: "replacement" }; }));
      assert.equal(calls, 0);
    } else {
      await f.control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async (id) => {
        assert.equal(id, "fixture-known-operation");
        return { id, status: deployState === "failed" ? "FAILED" : "IN_PROGRESS" };
      });
    }
  });
}

for (const malformed of ["missing-digest", "missing-deploy-field", "empty-deploy-object"]) {
  test(`checksummed but malformed ${malformed} state cannot be treated as eligible`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    await built(f.control, attempt);
    const input = await retirementInput(f.control);
    appendFixtureState(f.control, (state) => {
      if (malformed === "missing-digest") delete state.active.build.digest;
      if (malformed === "missing-deploy-field") delete state.active.deploy;
      if (malformed === "empty-deploy-object") state.active.deploy = {};
    });
    await rejectsWithoutWrite(f.control, { ...input, expectedSeq: input.expectedSeq + 1 });
  });
}

for (const corruption of ["malformed-tail", "missing-newline", "complete-line-truncation", "missing-registration"]) {
  test(`retirement does not repair ${corruption} journal evidence`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    await built(f.control, attempt);
    const input = await retirementInput(f.control);
    if (corruption === "malformed-tail") appendFileSync(f.control.journal, '{"unfinished":');
    if (corruption === "missing-newline") writeFileSync(f.control.journal, readFileSync(f.control.journal).subarray(0, -1));
    if (corruption === "complete-line-truncation") {
      const prior = readFileSync(f.control.journal);
      writeFileSync(f.control.journal, prior.subarray(0, prior.lastIndexOf(10, prior.length - 2) + 1));
    }
    if (corruption === "missing-registration") rmSync(f.control.registration);
    const prior = readFileSync(f.control.journal), checkpoint = existsSync(f.control.registration) ? readFileSync(f.control.registration) : null;
    await assert.rejects(new ReleaseControl(f.config).retireUndeployed(input));
    assert.deepEqual(readFileSync(f.control.journal), prior);
    if (checkpoint) assert.deepEqual(readFileSync(f.control.registration), checkpoint);
    else assert.equal(existsSync(f.control.registration), false);
  });
}

for (const badMap of [null, [], { [SHA]: {} }]) {
  test(`version2 retired archive rejects invalid shape ${JSON.stringify(badMap)}`, options, async (t) => {
    const f = await fixture(t), attempt = await begin(f.control);
    await built(f.control, attempt);
    const input = await retirementInput(f.control);
    appendFixtureState(f.control, (state) => { state.version = 2; state.retired = badMap; });
    const before = bytes(f.control), reopened = new ReleaseControl(f.config);
    await assert.rejects(reopened.inspect());
    await assert.rejects(reopened.retireUndeployed({ ...input, expectedSeq: input.expectedSeq + 1 }));
    await assert.rejects(begin(reopened, MAIN));
    unchanged(reopened, before);
  });
}

test("a checksummed v1 row cannot silently carry a retired map", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  appendFixtureState(f.control, (state) => {
    assert.equal(state.version, 1);
    state.retired = {};
  });
  const before = bytes(f.control), reopened = new ReleaseControl(f.config);
  await assert.rejects(reopened.inspect());
  await assert.rejects(begin(reopened, MAIN));
  unchanged(reopened, before);
});

test("a checksummed v2 to v1 downgrade cannot erase retired-source protection", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  await f.control.retireUndeployed(await retirementInput(f.control));
  appendFixtureState(f.control, (state) => {
    assert.equal(state.version, 2);
    state.version = 1;
    // Remove the map as well: this must fail because history already upgraded,
    // not merely because a v1 record happens to contain a new-format field.
    delete state.retired;
  });
  const before = bytes(f.control), reopened = new ReleaseControl(f.config);
  await assert.rejects(reopened.inspect());
  await assert.rejects(begin(reopened, SHA));
  await assert.rejects(begin(reopened, MAIN));
  unchanged(reopened, before);
});

test("retirement never steals an existing stale-looking lock", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  const input = await retirementInput(f.control), before = bytes(f.control);
  const lock = '{"pid":999999,"at":"2000-01-01T00:00:00Z","token":"fixture-stale-lock"}';
  writeFileSync(f.control.lock, lock, { flag: "wx" });
  await assert.rejects(f.control.retireUndeployed(input));
  unchanged(f.control, before);
  assert.equal(readFileSync(f.control.lock, "utf8"), lock);
});

test("two independent processes retire a shared attempt at most once", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  const input = await retirementInput(f.control), before = await f.control.inspect();
  const a = worker(f, "retire-copy-a"), b = worker(f, "retire-copy-b");
  assert.deepEqual(await Promise.all([a.ready, b.ready]), [true, true]);
  for (const w of [a, b]) w.child.send({ config: f.config, action: "retire", input });
  const results = await Promise.all([a.outcome, b.outcome]);
  await Promise.all([a.exit, b.exit]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  const after = await f.control.inspect();
  assert.equal(after.seq, before.seq + 1);
  assert.equal(after.active, null);
  assert.deepEqual(after.retired[SHA].attempt, before.active);
});

test("competing retirement and deploy submission cannot both proceed", options, async (t) => {
  const f = await fixture(t), attempt = await begin(f.control);
  await built(f.control, attempt);
  await grant(f.control, attempt, "deploy");
  const input = await retirementInput(f.control);
  const trace = join(f.sandbox, "fake-submissions.jsonl");
  const retiring = worker(f, "retirement-copy"), submitting = worker(f, "submission-copy");
  assert.deepEqual(await Promise.all([retiring.ready, submitting.ready]), [true, true]);
  retiring.child.send({ config: f.config, action: "retire", input });
  submitting.child.send({ config: f.config, action: "submit", input: phaseInput(attempt, "deploy"), trace });
  await Promise.all([retiring.starting, submitting.starting]);
  await Promise.race([retiring.outcome, submitting.entered, submitting.outcome]);
  if (submitting.child.connected) submitting.child.send({ type: "release" });
  const [retired, submitted] = await Promise.all([retiring.outcome, submitting.outcome]);
  await Promise.all([retiring.exit, submitting.exit]);
  assert.equal(Number(retired.ok) + Number(submitted.ok), 1, JSON.stringify({ retired, submitted }));
  const state = await f.control.inspect();
  const calls = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [];
  if (retired.ok) {
    assert.equal(calls.length, 0);
    assert.equal(state.active, null);
    assert.equal(state.retired[SHA].attempt.deploy, null);
  } else {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sha, SHA);
    assert.equal(calls[0].digest, DIGEST);
    assert.equal(state.active.deploy.id, "fixture-deploy-race");
    assert.equal(state.retired?.[SHA], undefined);
    await rejectsWithoutWrite(f.control, await retirementInput(f.control));
  }
});
