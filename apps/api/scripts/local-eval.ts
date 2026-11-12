import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { localTextAdapter, localModelEndpoint } from "../src/local-model";
import type { ModelRequest } from "../src/model-adapter";

export const FROZEN_V1_MANIFEST_SHA256 = "3530d5aac01672223252d8c93ab48e6264e1a7f035e8115cc3362255e68a794a";
export interface Case { id: string; kind: string }
export interface Harness {
  manifest: string;
  loadCases(): Case[];
  buildRequest(c: Case): Promise<ModelRequest | null>;
  grade(c: Case, answer: { text: string; functionCalls?: { name: string; arguments: string }[] }, latencyMs: number, request: ModelRequest | null): { pass: boolean; checks: { name: string; pass: boolean }[] };
}
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export function evaluationOptions(args: string[]) {
  const values: Record<string, string> = {}; let execute = false;
  for (let n = 0; n < args.length; n++) {
    const key = args[n]!;
    if (key === "--execute-local" && !execute) { execute = true; continue; }
    if (!["--suite", "--endpoint", "--model", "--ids", "--out", "--timeout-ms"].includes(key) || values[key] !== undefined || !args[n + 1] || args[n + 1]!.startsWith("--")) throw new Error("Unknown, duplicated or incomplete local evaluation option");
    values[key] = args[++n]!;
  }
  if (!execute || !values["--suite"] || !values["--model"] || !values["--ids"] || !values["--out"]) throw new Error("Explicit local execution, frozen suite, model alias, case IDs and new output file are required");
  const endpoint = values["--endpoint"] ?? "http://127.0.0.1:8191/v1"; localModelEndpoint(endpoint);
  const ids = values["--ids"].split(",");
  if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]+$/.test(id))) throw new Error("Choose one to five distinct frozen cases");
  const timeoutMs = Number(values["--timeout-ms"] ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("Invalid evaluation timeout");
  const suite = resolve(values["--suite"]), out = resolve(values["--out"]);
  const location = relative(suite, out);
  if (!out.endsWith(".json") || existsSync(out) || !(isAbsolute(location) || location.startsWith(".." + sep))) throw new Error("Use a new JSON output file outside the frozen suite");
  return { suite, out, endpoint, model: values["--model"], ids, timeoutMs };
}
export type EvaluationOptions = ReturnType<typeof evaluationOptions>;

/** Verify pinned manifest and every file before importing any code from the completed Phase 1 packet. */
export async function frozenHarness(suite: string): Promise<Harness> {
  if (basename(suite) !== "v1" || basename(dirname(suite)) !== "backend" || basename(dirname(dirname(suite))) !== "evals") throw new Error("Expected the completed evals/backend/v1 packet");
  const manifestText = readFileSync(join(suite, "manifest.json"));
  if (hash(manifestText) !== FROZEN_V1_MANIFEST_SHA256) throw new Error("Frozen v1 manifest mismatch; never regenerate it to hide a change");
  const manifest = JSON.parse(manifestText.toString("utf8")) as { files: Record<string, string> };
  const root = resolve(suite, "../../..");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^(evals\/backend\/v1\/|apps\/api\/|packages\/)/.test(name) || name.includes("..") || !/\.(ts|json|jsonl)$/.test(name)) throw new Error("Unexpected frozen manifest file");
    if (hash(readFileSync(join(root, name))) !== expected) throw new Error("Frozen v1 content mismatch");
  }
  const cases = await import(pathToFileURL(join(suite, "cases.ts")).href);
  const builders = await import(pathToFileURL(join(suite, "builders.ts")).href);
  const grader = await import(pathToFileURL(join(suite, "grader.ts")).href);
  return { manifest: cases.verifyManifest(), loadCases: cases.loadCases, buildRequest: builders.buildRequest, grade: grader.grade };
}

/** No search, page, app tool, database, billing or cloud request is executed by this recorder. */
export async function recordLocalEvaluation(options: EvaluationOptions, harness: Harness, request: typeof fetch = fetch) {
  if (!options.ids.length || options.ids.length > 5 || new Set(options.ids).size !== options.ids.length) throw new Error("Choose one to five distinct frozen cases");
  const all = harness.loadCases();
  const cases = options.ids.map(id => { const found = all.find(c => c.id === id); if (!found) throw new Error("Unknown frozen case"); return found; });
  if (cases.some(c => ["photo-check", "photo-plan", "preview"].includes(c.kind))) throw new Error("This recorder measures text only; vision and deterministic preview use separate gates");
  let attempts = 0;
  const counted = localTextAdapter({ evaluationOnly: true, endpoint: options.endpoint, model: options.model, timeoutMs: options.timeoutMs, fetch: async (...args) => { attempts++; return request(...args); } });
  const records = [];
  for (const c of cases) {
    const prompt = await harness.buildRequest(c); if (!prompt) throw new Error("Text fixture did not produce a request");
    const promptHash = hash(JSON.stringify(prompt)), started = performance.now();
    let answer: { text: string; functionCalls?: { name: string; arguments: string }[] } = { text: "" };
    let received = false, usageMeasured = false;
    try {
      const response = await counted.respond(prompt); answer = { text: response.text, functionCalls: response.functionCalls.map(f => ({ name: f.name, arguments: f.arguments })) };
      received = true; usageMeasured = (response.raw as { tokenUsageMeasured: boolean }).tokenUsageMeasured;
    } catch { /* Keep failed/missing answers in the denominator; do not retain provider error bodies. */ }
    const latencyMs = performance.now() - started;
    const graded = harness.grade(c, answer, latencyMs, prompt);
    const result = { ...graded, pass: received && graded.pass, checks: [{ name: "response-received", pass: received }, ...graded.checks] };
    records.push({ id: c.id, kind: c.kind, promptHash, answer, latencyMs, costUsd: 0, responseReceived: received, tokenUsageMeasured: usageMeasured,
      result, productLatencyTargetMs: c.kind === "research" ? 30000 : 10000, meetsProductLatencyTarget: received && latencyMs <= (c.kind === "research" ? 30000 : 10000) });
  }
  return { version: 1, mode: "local-text-recording", manifest: harness.manifest, capturedAt: new Date().toISOString(), model: counted.id,
    endpoint: options.endpoint, seed: 17, temperature: 0, networkAttempts: attempts, cloudCalls: 0, externalToolsExecuted: 0, promotionReady: false,
    source: "Frozen synthetic Phase 1 v1; not a current production/device acceptance run", electricityCostMeasured: false, records };
}
export async function main(args: string[]) {
  const options = evaluationOptions(args), harness = await frozenHarness(options.suite);
  const report = await recordLocalEvaluation(options, harness);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ file: options.out, cases: report.records.length, responses: report.records.filter(r => r.responseReceived).length,
    fixturePasses: report.records.filter(r => r.result.pass).length, productLatencyPasses: report.records.filter(r => r.meetsProductLatencyTarget).length,
    networkAttempts: report.networkAttempts, cloudCalls: 0, promotionReady: false }));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error("Local evaluation stopped; check the frozen packet, explicit options and local runtime. No cloud fallback was attempted."); process.exitCode = 1; });
