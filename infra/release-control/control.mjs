import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => structuredClone(value);
const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const sourceSha = (value) => typeof value === "string" && shaPattern.test(value);
const fingerprint = (value) => typeof value === "string" && hashPattern.test(value);
const imageDigest = (value) => typeof value === "string" && digestPattern.test(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 512;

// The supported launcher resolves one host-local control root, never its own directory.
export const defaultControlRoot = () => join(homedir(), "Desktop", "Dandelist Design", "master", "release-control");

/** Cooperating local writers only. Provider verification remains the adapter's responsibility. */
export class ReleaseControl {
  constructor({ root = defaultControlRoot(), service, inbox, outbox, clock = Date.now }) {
    need(text(service) && text(inbox) && text(outbox), "Service and mailbox paths are required");
    this.root = realpathSync(root);
    this.service = service;
    this.inbox = inbox;
    this.outbox = outbox;
    this.clock = clock;
    const key = hash(service);
    this.journal = join(this.root, `${key}.jsonl`);
    this.lock = join(this.root, `${key}.lock`);
    this.registration = join(this.root, `${key}.registered`);
  }

  fingerprints() {
    // Missing/unreadable mailboxes cannot silently become empty reviewed snapshots.
    return { inbox: hash(readFileSync(this.inbox)), outbox: hash(readFileSync(this.outbox)) };
  }

  #load() {
    need(existsSync(this.journal) && existsSync(this.registration), "Missing control state; initialize a new service explicitly or reconcile lost state");
    const registration = JSON.parse(readFileSync(this.registration, "utf8"));
    need(registration.service === this.service, "Service registration mismatch");
    const bytes = readFileSync(this.journal, "utf8");
    need(bytes.endsWith("\n") && bytes.length > 1, "Incomplete journal; reconcile without mutation");
    let state;
    let previous = "";
    for (const [index, line] of bytes.slice(0, -1).split("\n").entries()) {
      const row = JSON.parse(line);
      need(row.previous === previous && row.hash === hash(JSON.stringify(row.entry)), "Journal integrity mismatch");
      state = row.entry.state;
      need(state?.version === 1 && state.service === this.service && state.seq === index + 1 && Number.isSafeInteger(state.revision) && Array.isArray(state.holds) && state.completed && typeof state.completed === "object", "Invalid journal state");
      previous = row.hash;
    }
    need(registration.seq === state.seq && registration.hash === previous, "Journal/checkpoint mismatch; reconcile without mutation");
    return state;
  }

  #save(state, event) {
    const lines = existsSync(this.journal) ? readFileSync(this.journal, "utf8").trimEnd().split("\n") : [];
    const previous = lines.length ? JSON.parse(lines.at(-1)).hash : "";
    state.seq++;
    const entry = { at: new Date(this.clock()).toISOString(), event, state };
    const row = { previous, hash: hash(JSON.stringify(entry)), entry };
    const fd = openSync(this.journal, "a", 0o600);
    try { appendFileSync(fd, JSON.stringify(row) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); }
    // A complete-line truncation must not restore an older apparently valid intent state.
    const temporary = this.registration + "." + randomUUID() + ".tmp";
    const checkpoint = openSync(temporary, "wx", 0o600);
    try { writeFileSync(checkpoint, JSON.stringify({ service: this.service, seq: state.seq, hash: row.hash })); fsyncSync(checkpoint); }
    finally { closeSync(checkpoint); }
    renameSync(temporary, this.registration);
  }

  async #locked(work, initialize = false) {
    let fd;
    try { fd = openSync(this.lock, "wx", 0o600); }
    catch { throw new Error("Service lock unavailable; inspect its owner, never automatically delete it"); }
    const token = randomUUID();
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date(this.clock()).toISOString() }));
      fsyncSync(fd);
      const uninitialized = !existsSync(this.journal) && !existsSync(this.registration);
      return await work(initialize && uninitialized ? null : this.#load());
    } finally {
      closeSync(fd);
      // Do not remove a lock replaced by another actor, even on error.
      try { if (JSON.parse(readFileSync(this.lock, "utf8")).token === token) unlinkSync(this.lock); }
      catch { /* A missing or damaged lock needs explicit reconciliation. */ }
    }
  }

  async initialize({ owner }) {
    need(text(owner), "Initialization owner required");
    return this.#locked((existing) => {
      if (existing) return clone(existing);
      const fd = openSync(this.registration, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ service: this.service, seq: 0, hash: "" })); fsyncSync(fd); } finally { closeSync(fd); }
      const state = { version: 1, service: this.service, seq: 0, revision: 0, holds: [], active: null, completed: {} };
      this.#save(state, { type: "initialized", owner });
      return clone(state);
    }, true);
  }

  #active(state, { attemptId, owner }) {
    need(text(attemptId) && text(owner), "Named attempt and owner required");
    const active = state.active;
    need(active?.id === attemptId && active.owner === owner && !active.transferTo, "Attempt/owner mismatch or transfer awaiting acknowledgement");
    return active;
  }

  async inspect() { return this.#locked((state) => clone(state)); }

  async begin({ sha, owner, configurationHash, planHash }) {
    need(sourceSha(sha) && text(owner) && fingerprint(configurationHash), "Exact source, owner and configuration hash required");
    need(planHash === undefined || fingerprint(planHash), "Adapter plan hash must be a SHA-256 fingerprint");
    return this.#locked((state) => {
      if (state.active) {
        need(state.active.sha === sha && state.active.owner === owner && state.active.configurationHash === configurationHash && state.active.planHash === planHash && !state.active.transferTo, "Another attempt or adapter plan is active; reconcile or transfer it");
        return clone(state.active);
      }
      need(!state.completed[sha], "Completed source exists; verify alreadyDeployed instead of rebuilding");
      need(!state.holds.length, "Unresolved review hold");
      state.revision++;
      state.active = { id: randomUUID(), sha, owner, configurationHash, ...(planHash === undefined ? {} : { planHash }), build: null, deploy: null, clearance: null };
      this.#save(state, "attempt_started");
      return clone(state.active);
    });
  }

  async hold({ owner, reason }) {
    need(text(owner) && text(reason), "Hold owner and reason required");
    return this.#locked((state) => {
      const id = randomUUID();
      state.holds.push({ id, owner, reason });
      state.revision++;
      if (state.active) state.active.clearance = null;
      this.#save(state, "hold_added");
      return id;
    });
  }

  async resolveHold({ id, owner, resolution }) {
    need(text(id) && text(owner) && text(resolution), "Record the hold, owner and evidence resolving it");
    return this.#locked((state) => {
      const found = state.holds.find((hold) => hold.id === id);
      need(found && found.owner === owner, "Only the recorded hold owner can resolve it");
      state.holds = state.holds.filter((hold) => hold.id !== id);
      state.revision++;
      if (state.active) state.active.clearance = null;
      this.#save(state, { type: "hold_resolved", id, owner, resolution });
    });
  }

  async grant({ attemptId, owner, phase, requestHash, fingerprints }) {
    need(["build", "deploy"].includes(phase) && fingerprint(requestHash), "Mutation phase and request hash required");
    return this.#locked((state) => {
      const active = this.#active(state, { attemptId, owner });
      need(!state.holds.length, "Unresolved review hold");
      const current = this.fingerprints();
      need(fingerprints?.inbox === current.inbox && fingerprints?.outbox === current.outbox, "Reviewed mailbox snapshot changed");
      active.clearance = { phase, requestHash, fingerprints: current, revision: state.revision, at: this.clock() };
      this.#save(state, "clearance_recorded");
    });
  }

  async submit({ attemptId, owner, phase, requestHash }, send) {
    need(["build", "deploy"].includes(phase) && typeof send === "function", "Mutation phase and adapter required");
    return this.#locked(async (state) => {
      const active = this.#active(state, { attemptId, owner });
      need(!active[phase], "An intent already exists; resume its known ID or reconcile ambiguity, never resubmit");
      if (phase === "deploy") need(active.build?.status === "SUCCEEDED" && imageDigest(active.build.digest), "Verified successful build required");
      const clearance = active.clearance;
      const age = this.clock() - (clearance?.at ?? NaN);
      need(!state.holds.length && clearance?.revision === state.revision && clearance.phase === phase && clearance.requestHash === requestHash && age >= 0 && age <= 600000, "Missing, changed or expired release clearance");
      const current = this.fingerprints();
      need(current.inbox === clearance.fingerprints.inbox && current.outbox === clearance.fingerprints.outbox, "Mailbox changed after review; reconcile before mutation");
      const token = randomUUID();
      active[phase] = { token, requestHash, status: "INTENT", id: null };
      active.clearance = null;
      this.#save(state, `${phase}_intent`); // Durable before any provider mutation.
      const result = await send({ token, sha: active.sha, digest: active.build?.digest });
      need(text(result?.id), "Provider ID missing; intent retained for reconciliation");
      active[phase].id = result.id;
      active[phase].status = "IN_PROGRESS";
      this.#save(state, `${phase}_submitted`);
      return result.id;
    });
  }

  async observeBuild({ attemptId, owner }, read) {
    return this.#locked(async (state) => {
      const active = this.#active(state, { attemptId, owner });
      need(active.build?.id, "No known build ID; reconcile the saved intent");
      const result = await read(active.build.id);
      need(result?.id === active.build.id && result.sha === active.sha && ["IN_PROGRESS", "SUCCEEDED", "FAILED"].includes(result.status), "Build/source proof mismatch");
      need(active.build.status !== "FAILED" || result.status === "FAILED", "Terminal build changed");
      if (result.status === "SUCCEEDED") need(imageDigest(result.digest), "Verified digest required");
      if (active.build.digest) need(result.digest === active.build.digest && result.status === "SUCCEEDED", "Verified build changed");
      Object.assign(active.build, { status: result.status, ...(result.digest ? { digest: result.digest } : {}) });
      this.#save(state, "build_observed");
      return clone(active.build);
    });
  }

  async observeDeployment({ attemptId, owner }, read) {
    return this.#locked(async (state) => {
      const active = this.#active(state, { attemptId, owner });
      need(active.deploy?.id, "No known operation ID; reconcile the saved intent");
      const result = await read(active.deploy.id);
      need(result?.id === active.deploy.id && ["IN_PROGRESS", "SUCCEEDED", "FAILED"].includes(result.status), "Operation proof mismatch");
      need(active.deploy.status !== "FAILED" || result.status === "FAILED", "Terminal operation changed");
      if (result.status === "SUCCEEDED") {
        need(result.sha === active.sha && result.digest === active.build.digest && result.configurationHash === active.configurationHash, "Source/digest/protected configuration mismatch");
        active.deploy.status = result.status;
        state.completed[active.sha] = clone(active);
        state.active = null;
        state.revision++;
      } else active.deploy.status = result.status;
      this.#save(state, "deployment_observed");
      return clone(result);
    });
  }

  async alreadyDeployed({ sha }, read) {
    need(sourceSha(sha), "Exact source required");
    return this.#locked(async (state) => {
      need(!state.active, "A newer attempt is active; do not clear it with an older receipt");
      const completed = state.completed[sha];
      need(completed, "No completed release record");
      const result = await read(clone(completed));
      need(result?.status === "RUNNING" && result.sha === sha && result.digest === completed.build.digest && result.configurationHash === completed.configurationHash, "Live source/digest/configuration no longer matches completed release");
      return { alreadyDeployed: true, sha, digest: completed.build.digest };
    });
  }

  async transfer({ attemptId, owner, to }) {
    need(text(to) && to !== owner, "New owner required");
    return this.#locked((state) => {
      const active = this.#active(state, { attemptId, owner });
      active.transferTo = to;
      active.clearance = null;
      state.revision++;
      this.#save(state, "transfer_offered");
    });
  }

  async acceptTransfer({ attemptId, owner }) {
    need(text(attemptId) && text(owner), "Named attempt and recipient required");
    return this.#locked((state) => {
      const active = state.active;
      need(active?.id === attemptId && text(active.transferTo) && active.transferTo === owner, "No matching transfer offer");
      active.owner = owner;
      delete active.transferTo;
      state.revision++;
      this.#save(state, "transfer_accepted");
      return clone(active);
    });
  }
}
