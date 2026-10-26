/**
 * Runs the API's migrations against the RDS database. The connection string is built from the
 * dandelist/db secret and passed to the child process only, so the password never reaches the terminal.
 */
import { spawnSync } from "node:child_process";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { credentials, region } from "./creds";

const db = (await new RDSClient({ region, credentials }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "dandelist-db" }))).DBInstances?.[0];
if (db?.DBInstanceStatus !== "available" || !db.Endpoint?.Address) throw new Error(`dandelist-db is ${db?.DBInstanceStatus ?? "missing"}`);
const { SecretString } = await new SecretsManagerClient({ region, credentials }).send(new GetSecretValueCommand({ SecretId: "dandelist/db" }));
const { username, password } = JSON.parse(SecretString!) as { username: string; password: string };
const url = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${db.Endpoint.Address}:${db.Endpoint.Port ?? 5432}/dandelist`;

const r = spawnSync("corepack", ["pnpm", "--filter", "@dandelist/api", "run", "migrate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: url, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
});
process.exit(r.status ?? 1);
