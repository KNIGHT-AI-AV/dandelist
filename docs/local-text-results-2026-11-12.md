# Local text evaluation, 2026-11-12 UTC

Internal engineering evidence. No production model switch. Code commit: `f7b681a627ef9d239036df2228589a7973782326`.

## Paired five-case probe

Same frozen case IDs and order, seed17/temperature0, one local slot, context8192, 30-second timeout. Fixture passes include the original fixture latency budget; the stricter product targets are scored separately. These are single samples, not a p95 acceptance run.

| Case | Glimmer fixture / seconds | Qwen fixture / seconds |
|---|---:|---:|
| worth-01 | fail / 17.67 | pass / 5.04 |
| interpret-01 | pass / 8.36 | pass / 4.04 |
| questions-01 | fail / 30.00 | pass / 7.15 |
| research-01 | pass / 16.27 | pass / 4.90 |
| dream-chat-01 | pass / 9.39 | pass / 2.99 |

Glimmer: 3/5 automated fixture passes; 3/5 product latency passes. Qwen: 5/5 and 5/5. The earlier Glimmer compatibility failure is retained in scratch and excluded from this corrected comparison.

## Qwen frozen text matrix

97/97 responses, 85/97 automated fixture passes and 95/97 product latency passes. All selected cases remain in the denominator. No external tools ran. Original v1 is unchanged. A separate execution of the original frozen runner reproduced all 97 request hashes and pass/fail decisions from the captured answers. The model inference happened before that offline replay; replay alone is not a quality benchmark.

| Kind | Fixture passes | Product latency passes | p50 seconds | p95 seconds |
|---|---:|---:|---:|---:|
| dream-chat | 11/12 | 12/12 | 2.46 | 5.81 |
| estimate | 10/10 | 10/10 | 3.40 | 3.61 |
| interpret | 10/10 | 9/10 | 4.98 | 11.50 |
| pairs | 5/10 | 9/10 | 7.49 | 10.75 |
| questions | 7/10 | 10/10 | 5.68 | 7.23 |
| quick-find | 9/10 | 10/10 | 2.50 | 2.77 |
| research | 13/15 | 15/15 | 4.56 | 6.70 |
| suggest | 10/10 | 10/10 | 3.62 | 4.22 |
| worth | 10/10 | 10/10 | 4.26 | 5.80 |

## Limits and next gate

The text matrix covers frozen synthetic prompts and supplied evidence. It excludes the 30 vision/preview cases and does not establish live seller accuracy, current Meta/AWS comparison, real device support, first-token latency, blinded usefulness or production cost. Historical local photo/research failures remain unresolved. All captures report `promotionReady:false`. Do not replace the provider or advertise device support from these results.

Provider inference charge: $0. Electricity/hardware/hosting costs are unmeasured. Published weight checksums match; file sizes and runtime/startup provenance are in the adjacent JSON. GPU readings include the desktop and are observations, not measured peaks. Cold startup is reported separately from warmed request latency.

Raw synthetic outputs, per-run receipts and batch journal remain in the private Dandelist handoff scratch directory; the JSON carries their hashes. See [the runbook](local-model-evaluation.md) for source links, immutable-manifest checks, constraints and the next promotion gates.

## Decision and engineering validation

Do not promote Qwen for price research. In `research-12`, the only supplied offer was explicitly expired and unusable; the expected result was no price options. The model instead invented three manufacturer prices and high-confidence source/evidence claims. No live seller pages were fetched and no user received these synthetic answers. `quick-find-07` also failed line-format/currency/evidence checks. Missed clarification, incomplete comparison pairs and question-cap failures are recorded per case in the JSON. App repairs and fallbacks were not used to turn these into passes.

Engineering CI [43145462927](https://github.com/KNIGHT-AI-AV/dandelist/actions/runs/43145462927) passed on exact code commit `f7b681a627ef9d239036df2228589a7973782326`: API880, mobile843, cost14, Meta40, frozen install and all workspace types. The separate store branch has its own gates and is not included in these counts.
