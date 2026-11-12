import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluationOptions, frozenHarness, recordLocalEvaluation, type EvaluationOptions, type Harness } from "../scripts/local-eval";

const roots: string[] = [];
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "dandelist-local-eval-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const options = (patch: Partial<EvaluationOptions> = {}): EvaluationOptions => ({ suite: "not-imported", out: "not-written.json", model: "fixture-local", endpoint: "http://127.0.0.1:8191/v1", timeoutMs: 1000, ids: ["worth-01", "questions-01"], ...patch });
const harness = (patch: Partial<Harness> = {}): Harness => ({ manifest: "frozen-manifest", loadCases: () => [{ id: "worth-01", kind: "worth" }, { id: "questions-01", kind: "questions" }, { id: "photo-01", kind: "photo-check" }], buildRequest: async c => ({ input: "Synthetic fixture: " + c.id }), grade: (_c, answer) => ({ pass: !!answer.text, checks: [{ name: "nonempty", pass: !!answer.text }] }), ...patch });
const response = () => Response.json({ model: "fixture-local", choices: [{ finish_reason: "stop", message: { content: '{"answer":"synthetic"}' } }], usage: { prompt_tokens: 20, completion_tokens: 8 } });

it.each([[], ["--suite", "fixture"], ["--execute-local", "--execute-local"], ["--cloud"], ["--model", "x", "--model", "y"]].map(args => ({ args })))("requires explicit bounded execution rather than accepting partial or unknown options", ({ args }) => { expect(() => evaluationOptions(args)).toThrow(); });
it("keeps the original suite untouched and refuses existing or disguised in-suite output files", () => {
  const root = temporary(), suite = join(root, "evals", "backend", "v1"); mkdirSync(suite, { recursive: true });
  const argv = ["--execute-local", "--suite", suite, "--model", "fixture-local", "--ids", "worth-01", "--out"];
  expect(() => evaluationOptions([...argv, join(suite, "..results.json")])).toThrow("outside the frozen suite");
  const output = join(root, "result.json"); writeFileSync(output, "existing evidence"); expect(() => evaluationOptions([...argv, output])).toThrow();
  const valid = evaluationOptions([...argv, join(root, "new.json")]); expect(valid.ids).toEqual(["worth-01"]); expect(valid.timeoutMs).toBe(30000);
  expect(() => evaluationOptions([...argv, join(root, "next.json"), "--endpoint", "https://api.meta.ai/v1"])).toThrow();
});
it("rejects a modified frozen manifest before importing its executable code", async () => {
  const suite = join(temporary(), "evals", "backend", "v1"); mkdirSync(suite, { recursive: true });
  writeFileSync(join(suite, "manifest.json"), '{"files":{}}');
  writeFileSync(join(suite, "cases.ts"), 'throw new Error("must never import this")');
  await expect(frozenHarness(suite)).rejects.toThrow("manifest mismatch");
});
it("records only selected synthetic answers with stable hashes and explicit non-promotion status", async () => {
  const request = vi.fn(async () => response()); const grade = vi.fn(harness().grade);
  const report = await recordLocalEvaluation(options(), harness({ grade }), request);
  expect(report).toMatchObject({ manifest: "frozen-manifest", networkAttempts: 2, cloudCalls: 0, externalToolsExecuted: 0, promotionReady: false, electricityCostMeasured: false });
  expect(report.records).toHaveLength(2); expect(grade).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledTimes(2);
  for (const row of report.records) { expect(row.promptHash).toMatch(/^[a-f0-9]{64}$/); expect(row).toMatchObject({ responseReceived: true, tokenUsageMeasured: true, result: { pass: true }, costUsd: 0, productLatencyTargetMs: 10000 }); expect(row).not.toHaveProperty("prompt"); }
  const again = await recordLocalEvaluation(options({ ids: ["worth-01"] }), harness(), request); expect(again.records[0]!.promptHash).toBe(report.records[0]!.promptHash);
});
it("keeps failed responses in the denominator even if a loose grader accepts an empty answer", async () => {
  let n = 0; const request = vi.fn(async () => { if (n++ === 0) throw new Error("sensitive backend detail"); return response(); });
  const report = await recordLocalEvaluation(options(), harness({ grade: () => ({ pass: true, checks: [] }) }), request);
  expect(report.records).toHaveLength(2); expect(report.networkAttempts).toBe(2);
  expect(report.records[0]).toMatchObject({ answer: { text: "" }, responseReceived: false, tokenUsageMeasured: false, result: { pass: false, checks: [{ name: "response-received", pass: false }] }, meetsProductLatencyTarget: false });
  expect(report.records[1]!.result.pass).toBe(true); expect(JSON.stringify(report)).not.toContain("sensitive backend detail");
});
it.each([["worth-01", "worth-01"], ["missing-01"], ["photo-01"], [], ["a", "b", "c", "d", "e", "f"]].map(ids => ({ ids })))("rejects duplicate, unknown, unsupported or unbounded case selections before any call", async ({ ids }) => {
  const request = vi.fn(async () => response()); await expect(recordLocalEvaluation(options({ ids }), harness(), request)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
});
it("records an offered function call for grading without running the application tool", async () => {
  const request = vi.fn(async () => Response.json({ model: "fixture-local", choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "one", type: "function", function: { name: "read_plan", arguments: "{}" } }] } }] }));
  const report = await recordLocalEvaluation(options({ ids: ["worth-01"] }), harness({ buildRequest: async () => ({ input: "Synthetic tool request", tools: [{ type: "function", name: "read_plan", parameters: { type: "object" } }] }) }), request);
  expect(report.externalToolsExecuted).toBe(0); expect(request).toHaveBeenCalledTimes(1); expect(report.records[0]).toMatchObject({ responseReceived: true, tokenUsageMeasured: false, answer: { text: "", functionCalls: [{ name: "read_plan", arguments: "{}" }] } });
});
