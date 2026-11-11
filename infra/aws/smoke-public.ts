import { publicSmoke } from "./smoke-checks";

const base = process.env.API_URL;
if (!base) throw new Error("Set API_URL to the API origin");
const checks = await publicSmoke(base);
for (const result of checks) {
  console.log(`${result.ok ? "pass" : "FAIL"}  ${result.label}${result.detail ? `  (${result.detail})` : ""}`);
}
if (checks.some((result) => !result.ok)) process.exitCode = 1;
