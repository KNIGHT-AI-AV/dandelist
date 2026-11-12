# Local text model evaluation

Internal engineering receipt and runbook, 2026-11-12 UTC. This is a development-only evaluation path. It does not select or deploy a replacement provider.

## Current agent and provider

Dandelist owns its agent orchestration: `apps/api/src/agent/agent.ts` clarifies wishes and coordinates research, source verification and presentation; `apps/api/src/dream/agent.ts` runs Dandy's conversation/tool loop. The deterministic cost package calculates amounts and timelines. A model answer is not proof that a seller price was checked.

The main text model remains `muse-spark-1.3` through the Meta Model API (`packages/meta/src/client.ts`). The optional fallback implementation is `claude-opus-5-5` (`packages/meta/src/claude.ts`), enabled only when the server has its deployment-owned configuration. Current fallback configuration has not been inspected by this evaluation. `under.ts` still selects Meta first; provider-neutral history is groundwork, not a provider migration. Image generation, transcription and segmentation have separate Meta dependencies.

The earlier local Glimmer/Qwen experiments do not establish a replacement. Glimmer is itself a Meta model. Running its weights locally changes the hosting dependency, not the model vendor. There is no selected AWS fallback and no verified phone/browser inference path.

## Adapter boundary

`apps/api/src/local-model.ts` implements the existing text adapter contract without any production server import. Construction and dispatch refuse `NODE_ENV=production` and require `evaluationOnly: true`.

- Only fixed HTTP loopback endpoints at an explicit port and `/v1` are accepted. DNS names, cloud hosts, credentials, redirects and other paths are refused. No authorization header is attached.
- Requests are text only. JSON Schema and descriptions are preserved, function calls/history are mapped, and usage is marked measured only when the runtime returns both counters. Tool execution is absent. Vision, built-in web search, streaming and provider response IDs are refused.
- One request, a bounded timeout and response body, cancellation propagation, capped output and tool calls. No retry, cloud fallback, paid call or database connection. Invalid, refused, truncated or inconsistent responses fail closed.
- Sampling is fixed at seed 17 and temperature 0. Reasoning budgets are explicit; output caps include reasoning. This does not promise bit-for-bit reproducibility across runtimes/hardware.
- The frozen question builder explicitly names `muse-spark-1.3`. This legacy text alias maps to the configured local model, preserving the original request for replay hashing. Image/unknown model overrides are refused. The initial compatibility probe exposed this adapter gap; its failed case is preserved separately from the corrected run.
- Zero provider charge is recorded for local requests; electricity, hardware cost and production hosting cost are not measured or assumed free.

## Reuse the completed evaluation packet

Use a clean checkout of `codex/dandelist-phase1-20261110` at `1c3efc8309a8a58719618464c7f8d542962c88ff`. Do not regenerate or edit its v1 manifest, builders, grader, captured app source or cases.

`apps/api/scripts/local-eval.ts` verifies the original manifest byte hash `3530d5aac01672223252d8c93ab48e6264e1a7f035e8115cc3362255e68a794a` and all 96 listed files before importing its code. The canonical replay manifest is `3d0f641450a83eb07474b949fca3d3c2aafb122d49c0e1e11dedfd2ba3fa5014`. There are 127 frozen synthetic cases. Original request hashes, schema checks and price expectations are reused.

Start an independently owned, existing local runtime bound to `127.0.0.1:8191`, then run from this worktree. Set `$phaseOneSuite` to that completed checkout's `evals/backend/v1` directory and `$newReceipt` to a new JSON file outside it:

```powershell
corepack pnpm --filter @dandelist/api exec tsx scripts/local-eval.ts `
  --execute-local --suite $phaseOneSuite `
  --endpoint http://127.0.0.1:8191/v1 --model your-explicit-local-alias `
  --ids worth-01,interpret-01,questions-01,research-01,dream-chat-01 `
  --timeout-ms 30000 --out $newReceipt
```

Each invocation accepts one to five distinct cases, writes only a new file and refuses vision/deterministic preview cases. Frozen evidence is supplied in the prompt; no live search, page fetch or application tool runs. Returned tool calls are recorded for grading, never executed. This isolates model output from external actions.

Every selected case remains in the denominator. Missing/refused/invalid/timed-out responses are failures, even if an unusually permissive grader accepts an empty answer. Product latency checks require a received response and retain the proposed 10-second short-output / 30-second research limits independently of older fixture budgets. The recorder is non-streaming and cannot measure first-token latency. A five-case compatibility probe cannot establish p95 quality, device support, full-suite acceptance or a production baseline comparison. Artifacts always say `promotionReady: false`.

## Runtime and provenance

The initial workstation probe uses the already installed llama.cpp 0.8.0-dev build12096, commit7071ba378, RTX3090 24GiB, context8192, one slot and four CPU threads. Text only, no projector or speculative draft; each owned runtime is stopped afterwards. A workstation is an evaluation host and must never serve public user traffic.

Meta's [official model documentation](https://dev.meta.ai/docs/muse-glimmer/get-the-model) identifies the 17GB Q4_K_M artifact. Its [published repository](https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/tree/main) lists Apache2.0. The installed file's SHA256 matches the publisher's LFS object: `4cc57c0f51040a226e5a72cc47b7613f7772950e460a665f7083de89f183f60e`, 16,756,683,904bytes. This checks that specific artifact; it is not a complete distribution/compliance review.

Qwen's [upstream model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) also lists Apache2.0. The existing quantization is published by [Unsloth](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF). Verify its checksum independently before evaluation. Being loadable on a desktop does not show it fits a supported phone.

## Promotion gates

Keep the main provider unchanged until the full frozen comparisons, source accuracy, deterministic finance, consent/isolation, error recovery, device-class performance and actual deployment-cost gates pass. Test vision, speech, segmentation and image generation separately. Existing historical failures remain evidence; a small successful text probe cannot erase them.

Any AWS evaluation needs verified eligible credits and an overrun hard stop before paid calls. Any processor change needs accurate consent. Production routing, billing, pricing and customer releases retain their separate release approval. The local adapter and recorder provide no bypass around these gates.
