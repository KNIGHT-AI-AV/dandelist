# Existing-resource API release launcher

`aws-runner.mjs` combines the shared coordinator with the reviewed CodeBuild,
ECR and App Runner checks. It does not import the provisioning helper, create
resources, install packages, rotate credentials, update IAM, change spend limits,
or start a native/web build. It uses the already-installed SDKs and existing
`infra/aws/creds.ts` provider. Run it through that checkout's installed `tsx`
loader; do not use `npx` or install another loader to bypass package safeguards.

## Adoption is separate from source completion

Before initializing the real service journal, both lanes must reconcile their
legacy receipts and known build/operation IDs, yield any active release claim,
and acknowledge the same service ARN, shared root and launcher. Do not run
`prepare` simply to demonstrate the tool: it reserves a real attempt. No real
service journal or deployment was created by the offline test suite.

Legacy successful releases are not automatically imported into this new history.
Never rebuild a previously released SHA merely because the new journal has no
record of it. Retain the old receipts and reconcile that source explicitly.
Likewise, a lost journal, failed attempt or ambiguous mutation is not permission
to initialize a new history. This launcher intentionally has no automatic retry,
rollback, cancellation, lock deletion or historical-completion fabrication path.

The coordinator covers cooperating launchers on one host/user. Old scripts,
console actions and other hosts remain outside it. A board gate reporting clear
does not mean no other release exists: read the current mailbox and deployment
claims as well as the board before each mutation. The local resource gate and
LIGHT ACTIVE/RELEASED protocol remain separate requirements.

## Nonsecret specification

Create a reviewed JSON specification outside source control. Use the exact
existing account, region, project, repository and service ARN. Do not include
credentials, environment values or secret references. The example values below
are fictional and cannot identify the production service.

```json
{
  "account": "123456789012",
  "region": "us-east-1",
  "project": "example-api-image",
  "repository": "example-api",
  "serviceArn": "arn:aws:apprunner:us-east-1:123456789012:service/example-api/11111111111111111111111111111111",
  "sourceUrl": "https://github.com/example-owner/example-repository",
  "buildspec": "infra/aws/buildspec.yml",
  "blobs": {
    "infra/aws/buildspec.yml": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "apps/api/Dockerfile": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "port": "8080",
  "computeType": "BUILD_GENERAL1_SMALL",
  "timeoutMinutes": 20
}
```

Obtain the two blob IDs from the exact independently reviewed main revision.
Changes to either file require review of the build/image proof. The source
worktree must be clean, have the expected GitHub origin, and have both HEAD and
origin/main at the reviewed full SHA. A fresh public-main check must match too.
Known-ID status and already-deployed checks do not require main to stay pinned.

The adapter requires the existing manual ECR service, expected build settings,
port and roles, a unique matching build destination and valid configured spend
limits. An enabled CodeBuild auto-retry limit is a hold, not something this
launcher silently repairs. Source fields, environment, secret references,
instance, health, network, scaling, observability and encryption settings are
hashed and retained without printing their values. The journal also binds a
nonsecret, content-addressed `aws-plan-<hash>.json` in its shared root; a copied
launcher cannot invent a replacement baseline beside itself.

## One phase at a time

Invoke the installed loader using absolute quoted paths. For example:

```text
node "<sdk-root>/infra/aws/node_modules/tsx/dist/cli.mjs" "<reviewed-checkout>/infra/release-control/aws-runner.mjs" --mode prepare --spec "<reviewed-spec.json>" --sdk-root "<sdk-root>" --source-worktree "<clean-release-checkout>" --owner Codex --sha <full-reviewed-sha>
```

The SDK root is the existing dependency/credential checkout; the clean source
checkout is a separate explicit argument. Neither is inferred from the current
directory. All commands use the canonical shared root described in README.md.

| Mode | Additional arguments | Effect |
|---|---|---|
| `prepare` | `--owner`, `--sha`, `--source-worktree` | Read source/resources; reserve or resume the hash-bound attempt. |
| `build-plan` | `--owner`, `--attempt`, `--source-worktree` | Recheck source/resources; return the proposed build request hash. |
| `submit-build` | Same as build-plan, plus `--request-hash` | Require a fresh matching grant; submit StartBuild once. |
| `build-status` | `--owner`, `--attempt` | Read the saved build ID; verify source and image proof when available. |
| `deploy-plan` | `--owner`, `--attempt`, `--source-worktree` | Verify successful build/digest/configuration; return the image update hash. |
| `submit-deploy` | Same as deploy-plan, plus `--request-hash` | Require a separate fresh grant; submit UpdateService once. |
| `deployment-status` | `--owner`, `--attempt` | Read the exact saved operation and verify completion. |
| `already-deployed` | `--sha` | Verify a completed journal record against current provider evidence; no mutation. |

Every mode also requires `--spec` and `--sdk-root`. Unused arguments are rejected:
for example, a submit/status command cannot silently ignore a different `--sha`.
The selected attempt supplies its source identity.

Planning does not grant clearance. Read the actual board, both mailboxes, source
review and exact-head green CI, check the current deployment claim, then use the
coordination CLI's `snapshot` and `review` commands from README.md. The review JSON
contains `attemptId`, `owner`, `phase`, the returned `requestHash`, and the exact
reviewed `fingerprints`. Do not silently regenerate fingerprints or grants until
a changed mailbox has been read and reconciled. Build and deploy need separate
grants. The ten-minute grant lifetime is an expiry limit, not permission to ignore
new instructions during that interval.

The adapter reconstructs a frozen request from fresh verified resources, checks
its canonical hash, and performs preflight before the coordinator records intent.
The coordinator checks the grant under its lock; the adapter repeats a synchronous
fingerprint/expiry check immediately before the provider call. A failed preflight
that never reached submission can be reviewed and retried. Once intent exists,
a timeout or missing ID remains ambiguous and must not be resubmitted, including
after a new grant. A mailbox change during the narrow intent-write/final-check
interval can also leave a held intent; no automatic claim of zero-send recovery
is made for that case.

## Evidence and limits

SDK clients use `maxAttempts: 1` and a 60-second call deadline. The CodeBuild token
is generated by the coordinator and cannot replace durable history: AWS documents
only a five-minute token lifetime. Provider-side automatic build retries are a
separate setting and are explicitly checked. [StartBuild reference](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html).

Build completion requires the recorded ID, requested full SHA, actual resolved
SHA, expected project/source/buildspec and an ECR image selected by the reviewed
short-SHA tagging convention. Missing source resolution never becomes an invented
SHA. Terminal failures before checkout remain visibly failed with unverified
source. The retained source/tag/digest chain is not a cryptographic image-build
attestation. [Build fields](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html).

App Runner's update has no idempotency-token parameter. It changes only the cloned
live SourceConfiguration's immutable image identifier; encryption is protected
in the fingerprint, not sent as an unsupported update field. Completion requires
the exact operation ID, target ARN and UPDATE_SERVICE type, successful operation,
RUNNING service, correct digest and preserved configuration. A successful rollback
is failure of the requested release. [UpdateService](https://docs.aws.amazon.com/apprunner/latest/api/API_UpdateService.html), [operation states](https://docs.aws.amazon.com/apprunner/latest/api/API_OperationSummary.html).

An operation can appear on a later page; pagination is bounded and duplicate IDs
or repeated tokens fail closed. Known IDs remain resumable through transient read
failures. If an already-completed source no longer matches live configuration,
the no-op check fails rather than rebuilding. [ListOperations](https://docs.aws.amazon.com/apprunner/latest/api/API_ListOperations.html).

Successful source/CI and provider-configuration checks are not direct inspection
of a running container, product behavior, exact credit settlement, external beta
review or physical-device acceptance. Record those separately. Do not deploy
simply to claim the launcher was exercised.
