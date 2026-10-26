import { execFileSync } from "node:child_process";

/** Reads the deploy user's key from the vault at run time; it is never written to disk or printed. */
const VAULT_GET = "C:/Users/Copper Mile/KNIGHT AI+AV/knight-aiav-backend/tools/vault-get.mjs";
const read = (entry: string) => execFileSync("node", [VAULT_GET, entry], { encoding: "utf8" }).trim();

export const region = "us-east-1";
export const credentials = {
  accessKeyId: read("accounting/aws-dandelist-deploy-key-id"),
  secretAccessKey: read("accounting/aws-dandelist-deploy-secret"),
};
