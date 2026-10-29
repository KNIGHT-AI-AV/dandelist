import { execFileSync } from "node:child_process";

/**
 * The Meta key for an eval script: MODEL_API_KEY, or VAULT_GET naming a vault reader script that prints one secret and
 * VAULT_ENTRY the entry it reads. The key stays in memory; it is never printed or written.
 */
export function apiKey(): string {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY;
  const reader = process.env.VAULT_GET;
  const entry = process.env.VAULT_ENTRY;
  if (!reader || !entry) throw new Error("Set MODEL_API_KEY, or VAULT_GET to a vault reader script and VAULT_ENTRY to the entry it reads.");
  return execFileSync(process.execPath, [reader, entry], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
