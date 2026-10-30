import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseControl } from "./control.mjs";

const SHA = "a".repeat(40), OTHER_SHA = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`, OTHER_DIGEST = `sha256:${"d".repeat(64)}`;
const CONFIG = "e".repeat(64), BUILD_REQUEST = "f".repeat(64), DEPLOY_REQUEST = "1".repeat(64);
const OWNER = "fixture-owner", OTHER_OWNER = "fixture-peer";
const options = { timeout: 15_000 };

async function fixture(t, { initialize = true } = {}) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "dandelist-release-control-test-")));
  const root = join(sandbox, "control");
  mkdirSync(root);
  const inbox = join(sandbox, "INBOX.md"), outbox = join(sandbox, "OUTBOX.md");
  writeFileSync(inbox, "abcd\n");
  writeFileSync(outbox, "ready\n");
  const config = { root, service: "fixture-account:fixture-region:fixture-service", inbox, outbox };
  const control = new ReleaseControl(config);
  const workers = [];
  t.after(async () => {
    for (const worker of workers) {
      if (!worker.closed) worker.child.kill();
      await worker.exit;
    }
    // Every recursive deletion is confined to this exact directory created by this fixture.
    assert.equal(realpathSync(sandbox), sandbox);
    assert.ok(basename(sandbox).startsWith("dandelist-release-control-test-"));
    rmSync(sandbox, { recursive: true, force: true });
  });
  if (initialize) await control.initialize({ owner: OWNER });
  return { sandbox, config, control, workers };
}

const begin = (control, owner = OWNER, sha = SHA) => control.begin({ sha, owner, configurationHash: CONFIG });
test("adapter preflight identity cannot change or disappear on resumed attempts", options, async (t) => {
  const { control, config } = await fixture(t);
  const planHash = "9".repeat(64);
  const attempt = await control.begin({ sha: SHA, owner: OWNER, configurationHash: CONFIG, planHash });
  const reopened = new ReleaseControl(config);
  assert.equal((await reopened.begin({ sha: SHA, owner: OWNER, configurationHash: CONFIG, planHash })).id, attempt.id);
  await assert.rejects(reopened.begin({ sha: SHA, owner: OWNER, configurationHash: CONFIG }), /adapter plan/);
  await assert.rejects(reopened.begin({ sha: SHA, owner: OWNER, configurationHash: CONFIG, planHash: "8".repeat(64) }), /adapter plan/);
});
test("invalid adapter preflight hashes cannot create an attempt", options, async (t) => {
  const { control } = await fixture(t);
  await assert.rejects(control.begin({ sha: SHA, owner: OWNER, configurationHash: CONFIG, planHash: "not-a-fingerprint" }), /SHA-256/);
  assert.equal((await control.inspect()).active, null);
});
const input = (attempt, phase = "build", owner = OWNER) => ({
  attemptId: attempt.id, owner, phase, requestHash: phase === "build" ? BUILD_REQUEST : DEPLOY_REQUEST,
});
async function grant(control, attempt, phase = "build", owner = OWNER) {
  await control.grant({ ...input(attempt, phase, owner), fingerprints: control.fingerprints() });
}
async function built(control, attempt, send = async () => ({ id: "build-one" })) {
  await grant(control, attempt);
  const id = await control.submit(input(attempt), send);
  await control.observeBuild({ attemptId: attempt.id, owner: OWNER }, async (known) => {
    assert.equal(known, id);
    return { id: known, sha: SHA, status: "SUCCEEDED", digest: DIGEST };
  });
  return id;
}
async function complete(control, attempt, send) {
  await built(control, attempt, send);
  await grant(control, attempt, "deploy");
  await control.submit(input(attempt, "deploy"), send ?? (async () => ({ id: "deploy-one" })));
  await control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async (id) => ({
    id, sha: SHA, status: "SUCCEEDED", digest: DIGEST, configurationHash: CONFIG,
  }));
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function worker(f, name) {
  const cwd = join(f.sandbox, name);
  mkdirSync(cwd);
  const ready = deferred(), starting = deferred(), entered = deferred(), outcome = deferred(), exited = deferred();
  const child = fork(fileURLToPath(new URL("./fixtures/submit-worker.mjs", import.meta.url)), [], {
    cwd, execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const result = { child, closed: false, ready: ready.promise, starting: starting.promise, entered: entered.promise, outcome: outcome.promise, exit: exited.promise };
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("message", (message) => {
    if (message.type === "ready") ready.resolve(true);
    if (message.type === "starting") starting.resolve(message);
    if (message.type === "entered") entered.resolve(true);
    if (message.type === "result") outcome.resolve(message);
  });
  child.on("error", (error) => {
    ready.resolve(false);
    outcome.resolve({ ok: false, message: error.message });
  });
  // 'close' also follows a spawn error that never emits 'exit', and waits for the fixture's pipes to close.
  child.on("close", (code, signal) => {
    result.closed = true;
    ready.resolve(false);
    outcome.resolve({ ok: false, message: `Worker exited ${code ?? signal}: ${stderr}` });
    exited.resolve();
  });
  f.workers.push(result);
  return result;
}

test("initialization is explicit; a missing previously registered journal never becomes an empty release history", options, async (t) => {
  const f = await fixture(t, { initialize: false });
  await assert.rejects(f.control.inspect());
  await assert.rejects(begin(f.control));
  await f.control.initialize({ owner: OWNER });
  await begin(f.control);
  const registration = readFileSync(f.control.registration, "utf8");
  rmSync(f.control.journal);
  const reopened = new ReleaseControl(f.config);
  await assert.rejects(reopened.inspect());
  await assert.rejects(begin(reopened));
  await assert.rejects(reopened.initialize({ owner: OWNER }));
  assert.equal(readFileSync(f.control.registration, "utf8"), registration);
  assert.equal(existsSync(f.control.journal), false);
});

test("different processes and working directories can submit at most one build through one shared root", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await grant(f.control, attempt);
  const trace = join(f.sandbox, "submissions.jsonl");
  const a = worker(f, "runner-copy-a"), b = worker(f, "runner-copy-b");
  assert.deepEqual(await Promise.all([a.ready, b.ready]), [true, true]);
  for (const w of [a, b]) w.child.send({ config: f.config, action: "submit", input: input(attempt), trace });
  await Promise.all([a.starting, b.starting]);
  await Promise.race([a.entered, b.entered]);
  for (const w of [a, b]) if (w.child.connected) w.child.send({ type: "release" });
  const results = await Promise.all([a.outcome, b.outcome]);
  await Promise.all([a.exit, b.exit]);
  assert.ok(results.some((r) => r.ok && r.value === "build-shared"), JSON.stringify(results));
  const calls = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sha, SHA);
  assert.ok(calls[0].token);
  assert.equal((await f.control.inspect()).active.build.id, "build-shared");
});

test("a released process lock does not erase the active attempt, and the same owner resumes it", options, async (t) => {
  const f = await fixture(t);
  const w = worker(f, "departed-runner");
  assert.equal(await w.ready, true);
  w.child.send({ config: f.config, action: "begin", input: { sha: SHA, owner: OWNER, configurationHash: CONFIG } });
  const result = await w.outcome;
  await w.exit;
  assert.equal(result.ok, true, result.message);
  const reopened = new ReleaseControl(f.config);
  assert.equal((await begin(reopened)).id, result.value.id);
    await assert.rejects(begin(reopened, OTHER_OWNER));
  await assert.rejects(begin(reopened, OTHER_OWNER, OTHER_SHA));
  assert.equal((await reopened.inspect()).active.id, result.value.id);
});

for (const failure of ["throw", "missing-id"]) {
  test(`saved intent survives ${failure} and forbids a replacement submission`, options, async (t) => {
    const f = await fixture(t);
    const attempt = await begin(f.control);
    await grant(f.control, attempt);
    let calls = 0;
    let observed;
    await assert.rejects(f.control.submit(input(attempt), async ({ token, sha }) => {
      calls++;
      const committed = readFileSync(f.control.journal, "utf8");
      observed = { token, sha, persisted: committed.includes(token) && committed.includes(BUILD_REQUEST) };
      if (failure === "throw") throw new Error("Synthetic ambiguous response");
      return {};
    }));
    // These assertions must live outside assert.rejects, so a failed assertion cannot masquerade as the injected error.
    assert.equal(observed?.sha, SHA);
    assert.equal(typeof observed?.token, "string");
    assert.ok(observed.token.length >= 16);
    assert.equal(observed.persisted, true, "Intent must already be on disk before the mutation callback");
    const reopened = new ReleaseControl(f.config);
    // Rejecting a new grant is safe; accepting it must still never permit a second submission.
    try { await grant(reopened, attempt); } catch {}
    await assert.rejects(reopened.submit(input(attempt), async () => { calls++; return { id: "duplicate" }; }));
    assert.equal(calls, 1);
    assert.equal((await reopened.inspect()).active.id, attempt.id);
  });
}

for (const mailbox of ["inbox", "outbox"]) {
test(`same-length ${mailbox} edits invalidate a grant and stale fingerprints cannot mint a new one`, options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  const fingerprints = f.control.fingerprints();
  await f.control.grant({ ...input(attempt), fingerprints });
  const oldText = readFileSync(f.config[mailbox], "utf8");
  writeFileSync(f.config[mailbox], "x".repeat(oldText.length));
  let calls = 0;
  const send = async () => { calls++; return { id: "build-after-review" }; };
  await assert.rejects(f.control.submit(input(attempt), send));
  await assert.rejects(f.control.grant({ ...input(attempt), fingerprints }));
  assert.equal(calls, 0);
  await grant(f.control, attempt);
  assert.equal(await f.control.submit(input(attempt), send), "build-after-review");
  assert.equal(calls, 1);
});
}

test("an unresolved hold defeats both old and newly requested clearance; resolving it still requires a new grant", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await grant(f.control, attempt);
  const id = await f.control.hold({ owner: OTHER_OWNER, reason: "Synthetic source review is unresolved" });
  let calls = 0;
  const send = async () => { calls++; return { id: "build-cleared" }; };
  await assert.rejects(f.control.submit(input(attempt), send));
  await assert.rejects(grant(f.control, attempt));
  await f.control.resolveHold({ id, owner: OTHER_OWNER, resolution: "Synthetic correction independently checked" });
  await assert.rejects(f.control.submit(input(attempt), send));
  assert.equal(calls, 0);
  await grant(f.control, attempt);
  await f.control.submit(input(attempt), send);
  assert.equal(calls, 1);
});

test("clearance binds request, attempt and owner, and source proof binds the exact full SHA", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await assert.rejects(f.control.begin({ sha: SHA, owner: OWNER, configurationHash: "0".repeat(64) }));
  await grant(f.control, attempt);
  let calls = 0;
  const send = async () => { calls++; return { id: "build-bound" }; };
  for (const mismatch of [{ owner: OTHER_OWNER }, { attemptId: "wrong-attempt" }, { requestHash: "0".repeat(64) }]) {
    await assert.rejects(f.control.submit({ ...input(attempt), ...mismatch }, send));
  }
  assert.equal(calls, 0);
  await f.control.submit(input(attempt), send);
  const identity = { attemptId: attempt.id, owner: OWNER };
  await assert.rejects(f.control.observeBuild(identity, async (id) => ({ id, sha: OTHER_SHA, status: "SUCCEEDED", digest: DIGEST })));
  await assert.rejects(f.control.observeBuild(identity, async () => ({ id: "unrelated-build", sha: SHA, status: "SUCCEEDED", digest: DIGEST })));
  await assert.rejects(f.control.observeBuild(identity, async (id) => ({ id, sha: SHA, status: "SUCCEEDED" })));
  assert.equal(calls, 1);
});

test("a hold during a known build permits status reads, preserves timeout recovery and blocks deployment", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await grant(f.control, attempt);
  let mutations = 0;
  await f.control.submit(input(attempt), async () => { mutations++; return { id: "build-known" }; });
  await f.control.hold({ owner: OTHER_OWNER, reason: "Hold before deployment" });
  const identity = { attemptId: attempt.id, owner: OWNER };
  await assert.rejects(f.control.observeBuild(identity, async (id) => {
    assert.equal(id, "build-known");
    throw new Error("Synthetic status timeout");
  }));
  await f.control.observeBuild(identity, async (id) => {
    assert.equal(id, "build-known");
    return { id, sha: SHA, status: "SUCCEEDED", digest: DIGEST };
  });
  await assert.rejects(grant(f.control, attempt, "deploy"));
  await assert.rejects(f.control.submit(input(attempt, "deploy"), async () => { mutations++; return { id: "must-not-deploy" }; }));
  assert.equal(mutations, 1);
});

test("deployment completion requires its known operation and exact source, digest and protected configuration", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  let buildToken, deployToken;
  await built(f.control, attempt, async ({ token }) => { buildToken = token; return { id: "build-proof" }; });
  await grant(f.control, attempt, "deploy");
  await f.control.submit(input(attempt, "deploy"), async ({ token, sha, digest }) => {
    deployToken = token;
    assert.equal(sha, SHA);
    assert.equal(digest, DIGEST);
    assert.ok(readFileSync(f.control.journal, "utf8").includes(token));
    return { id: "deploy-proof" };
  });
  assert.notEqual(buildToken, deployToken);
  const proof = { id: "deploy-proof", sha: SHA, status: "SUCCEEDED", digest: DIGEST, configurationHash: CONFIG };
  for (const mismatch of [{ id: "other-operation" }, { sha: OTHER_SHA }, { digest: OTHER_DIGEST }, { configurationHash: "0".repeat(64) }]) {
    await assert.rejects(f.control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async () => ({ ...proof, ...mismatch })));
    assert.equal((await f.control.inspect()).active.id, attempt.id);
  }
  await f.control.observeDeployment({ attemptId: attempt.id, owner: OWNER }, async () => proof);
  assert.equal((await f.control.inspect()).active, null);
});

test("verified already-deployed is a no-op, requires matching evidence and cannot erase a newer active attempt", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  let mutations = 0;
  await complete(f.control, attempt, async () => ({ id: `mutation-${++mutations}` }));
  await assert.rejects(begin(f.control));
  const proof = { sha: SHA, digest: DIGEST, configurationHash: CONFIG, status: "RUNNING" };
  for (const mismatch of [{ sha: OTHER_SHA }, { digest: OTHER_DIGEST }, { configurationHash: "0".repeat(64) }, { status: "UPDATING" }]) {
    await assert.rejects(f.control.alreadyDeployed({ sha: SHA }, async () => ({ ...proof, ...mismatch })));
  }
  const verified = await f.control.alreadyDeployed({ sha: SHA }, async (record) => {
    assert.equal(record.sha, SHA);
    assert.equal(record.configurationHash, CONFIG);
    return proof;
  });
  assert.ok(verified);
  assert.equal(mutations, 2);
  const newer = await begin(f.control, OWNER, OTHER_SHA);
  let reads = 0;
  await assert.rejects(f.control.alreadyDeployed({ sha: SHA }, async () => { reads++; return proof; }));
  assert.equal(reads, 0);
  assert.equal((await f.control.inspect()).active.id, newer.id);
});

test("accepting an unoffered transfer without an owner leaves the journal and existing owner intact", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  const before = readFileSync(f.control.journal);
  await assert.rejects(f.control.acceptTransfer({ attemptId: attempt.id }));
  assert.deepEqual(readFileSync(f.control.journal), before);
  assert.equal((await f.control.inspect()).active.owner, OWNER);
  assert.equal((await begin(f.control)).id, attempt.id);
});

test("resolving a hold without its id or owner cannot mutate the journal or clear the real hold", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  const id = await f.control.hold({ owner: OTHER_OWNER, reason: "A real fixture review hold" });
  const before = readFileSync(f.control.journal);
  const resolution = "A proposed fixture resolution with an incomplete identity";
  for (const incomplete of [{ resolution }, { id, resolution }, { owner: OTHER_OWNER, resolution }]) {
    await assert.rejects(f.control.resolveHold(incomplete));
    assert.deepEqual(readFileSync(f.control.journal), before);
  }
  await assert.rejects(grant(f.control, attempt));
  await f.control.resolveHold({ id, owner: OTHER_OWNER, resolution: "The named reviewer explicitly resolves this hold" });
  await grant(f.control, attempt);
});

test("transfer requires the named recipient's acceptance and invalidates old-owner clearance", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await grant(f.control, attempt);
  await f.control.transfer({ attemptId: attempt.id, owner: OWNER, to: OTHER_OWNER });
  let calls = 0;
  const send = async () => { calls++; return { id: "transferred-build" }; };
  await assert.rejects(f.control.submit(input(attempt), send));
  await assert.rejects(f.control.acceptTransfer({ attemptId: attempt.id, owner: OWNER }));
  await f.control.acceptTransfer({ attemptId: attempt.id, owner: OTHER_OWNER });
  await assert.rejects(f.control.submit(input(attempt), send));
  await assert.rejects(f.control.submit(input(attempt, "build", OTHER_OWNER), send));
  await grant(f.control, attempt, "build", OTHER_OWNER);
  await f.control.submit(input(attempt, "build", OTHER_OWNER), send);
  assert.equal(calls, 1);
});

for (const corruption of ["malformed-tail", "missing-newline", "missing-registration"]) {
  test(`journal recovery fails closed for ${corruption} without overwriting evidence`, options, async (t) => {
    const f = await fixture(t);
    await begin(f.control);
    if (corruption === "malformed-tail") appendFileSync(f.control.journal, '{"unfinished":');
    if (corruption === "missing-newline") writeFileSync(f.control.journal, readFileSync(f.control.journal).subarray(0, -1));
    if (corruption === "missing-registration") rmSync(f.control.registration);
    const bytes = readFileSync(f.control.journal);
    const reopened = new ReleaseControl(f.config);
    await assert.rejects(reopened.inspect());
    await assert.rejects(begin(reopened));
    await assert.rejects(reopened.initialize({ owner: OWNER }));
    assert.deepEqual(readFileSync(f.control.journal), bytes);
  });
}

test("removing one complete final journal record is detected even when the remaining JSONL ends with a newline", options, async (t) => {
  const f = await fixture(t);
  const attempt = await begin(f.control);
  await grant(f.control, attempt);
  const before = readFileSync(f.control.journal);
  const checkpoint = readFileSync(f.control.registration);
  assert.equal(before.at(-1), 10);
  const precedingNewline = before.lastIndexOf(10, before.length - 2);
  assert.ok(precedingNewline >= 0);
  const truncated = before.subarray(0, precedingNewline + 1);
  assert.ok(truncated.length < before.length);
  assert.equal(truncated.at(-1), 10);
  for (const row of truncated.toString("utf8").trimEnd().split("\n")) JSON.parse(row);
  writeFileSync(f.control.journal, truncated);

  const reopened = new ReleaseControl(f.config);
  await assert.rejects(reopened.inspect());
  await assert.rejects(begin(reopened, OWNER, OTHER_SHA));
  await assert.rejects(grant(reopened, attempt));
  let mutations = 0;
  await assert.rejects(reopened.submit(input(attempt), async () => {
    mutations++;
    return { id: "must-not-replace-a-lost-record" };
  }));
  assert.equal(mutations, 0);
  assert.deepEqual(readFileSync(f.control.journal), truncated);
  assert.deepEqual(readFileSync(f.control.registration), checkpoint);
});

test("an existing stale-looking lock is retained rather than automatically removed", options, async (t) => {
  const f = await fixture(t);
  const lock = '{"pid":999999,"at":"2000-01-01T00:00:00Z","token":"fixture-old-lock"}\n';
  writeFileSync(f.control.lock, lock, { flag: "wx" });
  await assert.rejects(f.control.inspect());
  await assert.rejects(begin(f.control));
  assert.equal(readFileSync(f.control.lock, "utf8"), lock);
});

test("complete control-root loss is not silently recreated", options, async (t) => {
  const f = await fixture(t);
  await begin(f.control);
  const target = realpathSync(f.config.root);
  assert.equal(target, join(f.sandbox, "control"));
  rmSync(target, { recursive: true });
  assert.throws(() => new ReleaseControl(f.config));
  assert.equal(existsSync(target), false);
});

test("successful operations append evidence rather than rewriting earlier journal records", options, async (t) => {
  const f = await fixture(t);
  const original = readFileSync(f.control.journal);
  const attempt = await begin(f.control);
  const afterBegin = readFileSync(f.control.journal);
  assert.deepEqual(afterBegin.subarray(0, original.length), original);
  await complete(f.control, attempt);
  const completed = readFileSync(f.control.journal);
  assert.ok(completed.length > afterBegin.length);
  assert.deepEqual(completed.subarray(0, afterBegin.length), afterBegin);
});
