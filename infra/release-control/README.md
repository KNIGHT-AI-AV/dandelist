# Shared release control

The coordinator prevents cooperating runners on this Windows host from creating
separate release histories when a runner is copied to a different directory. It
also makes a recorded review hold or changed mailbox invalidate mutation clearance.
It adds no SDK, credential, resource, account or billing configuration.

**Status: integration component. Existing standalone deployment scripts do not
automatically use it. Both lanes must adopt the common control location and adapter
before claiming coordinated releases.** Do not alter a runner during an active
release, or use the legacy provisioning helper to integrate this component.

## First adoption

1. Finish and reconcile existing release attempts. Retain their receipts and known
   build/operation IDs. Confirm both lanes have yielded any legacy release claim.
2. Agree one service identifier, normally the existing App Runner service ARN.
   The supported CLI uses the host user's `Desktop/Dandelist Design/master/release-control`
   independent of the current directory. Different users, machines or roots do not
   share this protection. The library's root injection is for fixtures and an
   explicitly agreed integration, never an automatic fallback.
3. Explicitly initialize the new service with `cli.mjs init SERVICE owner.json`.
   The JSON file contains `{"owner":"Codex"}` or the corresponding actor. Do not
   initialize over lost state or use a new service identifier to evade an attempt.
4. Integrate the existing, independently reviewed configuration-preserving runner
   using the callbacks below. Preserve its exact-source/buildspec/digest checks,
   protected configuration verification, resource gate and permission boundaries.
   Do not change live credentials, IAM or provision infrastructure.
5. Both lanes register holds here as well as in the mailbox. Before each mutation,
   actually read the mailbox and board, then record the exact reviewed fingerprints.
   A fingerprint proves the snapshot is unchanged, not that anyone understood it.

## Runner contract

Import `ReleaseControl` from `control.mjs`. Its default root is the same as the CLI.
Construct it with the service and the actual shared `inbox`/`outbox` paths. The root
must exist; missing registration/journal/checkpoint state fails closed.

- `begin({sha, owner, configurationHash})` reserves an exact 40-character source and
  hash of the protected preflight configuration. It returns an attempt with `id`.
  The same owner/source/configuration resumes that attempt; another one is blocked.
- `fingerprints()` reads both files. Pass the hashes from the snapshot actually
  reviewed to `grant({attemptId, owner, phase, requestHash, fingerprints})`.
  `phase` is `build` or `deploy`; `requestHash` is the SHA-256 of the canonical,
  validated planned request, excluding the generated idempotency token. Never put
  raw environment values or credentials in this journal.
- `submit({attemptId, owner, phase, requestHash}, send)` rechecks ownership, holds,
  phase, request hash, snapshot and ten-minute expiry under the service lock. It
  durably writes an intent **before** invoking `send({token, sha, digest})`. The
  adapter uses that token for CodeBuild, submits exactly the reviewed request, and
  returns `{id}`. It must not contain its own mutation retry loop. Repeated submits
  reject even if an ID was saved; use status mode instead. An exception or missing
  ID leaves an ambiguous intent; reconcile it without automatically resubmitting.
- `observeBuild({attemptId, owner}, read)` passes the known build ID to a read-only
  adapter. Return `{id, sha, status, digest}` after checking actual resolved source,
  build specification and image provenance. Status is `IN_PROGRESS`, `SUCCEEDED`
  or `FAILED`; successful build proof requires an immutable `sha256:` digest.
- Grant a fresh, separately reviewed deployment clearance after build verification.
  The deployment adapter uses the verified digest and preserves live configuration.
  `observeDeployment` passes the saved operation ID to a read-only adapter. Return
  `{id, status, sha, digest, configurationHash}`. Success requires the expected
  source, digest and protected configuration hash. It completes that attempt.
- `alreadyDeployed({sha}, read)` requires a completed record and no newer active
  attempt. Its read-only adapter verifies the current source/digest/configuration
  and returns `{sha, digest, configurationHash, status:"RUNNING"}`. A match returns
  a no-op without invoking any build/update callback. A mismatch requires explicit
  reconciliation, not a silent rebuild or rollback.

The callbacks must return real provider evidence; this library cannot authenticate
an adapter's assertions. An HTTP 200 is not source, digest, configuration or product
acceptance evidence. Known-ID status reads remain allowed during a review hold.
They must preserve failed or ambiguous outcomes rather than inventing success.

## Holds, handovers and recovery

`hold({owner, reason})` returns a hold ID, invalidates clearance and blocks new
mutations across sources. The recorded hold owner uses
`resolveHold({id, owner, resolution})` after checking the corrective evidence.
Elapsed time, a fresh timestamp or a new merge SHA never clears a hold. Actor names
are cooperating-writer identities, not an authentication/security boundary.
A lock-busy error means the hold was **not recorded or queued**. Keep the mailbox
hold visible and retry registration; only a returned hold ID establishes delivery.

`transfer({attemptId, owner, to})` offers a handover and invalidates clearance.
`acceptTransfer({attemptId, owner})` explicitly acknowledges it before the new owner
can continue. Provider IDs and ambiguous intents survive that handover.

The append-only journal is fsynced before each provider mutation. A checkpoint
detects partial writes and complete-line truncation. A crash between writes can
leave a mismatch; that intentionally requires reconciliation. Locks are exclusive
per service, held through each mutation submission, and never automatically stolen
or expired. A process crash may leave a lock; inspect its process, token and journal
before any manual recovery. Do not delete unknown locks or reset the journal.

A hold registered under the shared lock before submission blocks that submission.
A hold arriving after the provider has accepted it cannot undo it; it blocks the
next mutation. Uncoordinated mailbox writers can race the snapshot check, so both
lanes must also register structured holds. Old scripts, direct cloud operations,
another machine, deliberate tampering and filesystem loss are outside this local
cooperating-writer guarantee. No global absence-of-builds claim is made.

## Offline validation

`node --test infra/release-control/control.test.mjs` uses temporary directories,
separate processes and stubbed callbacks. No cloud call, installed dependency,
credential or real release state is needed. Run under the local board/RAM gate.
Integration and adoption must be independently reviewed before real mutations.
