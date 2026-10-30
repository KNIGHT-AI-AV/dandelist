import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultControlRoot, ReleaseControl } from "./control.mjs";

// This CLI records coordination only. It imports no credentials or cloud SDK.
const [command, service, inputFile, ...extra] = process.argv.slice(2);
const methods = { init: "initialize", status: "inspect", snapshot: "fingerprints", begin: "begin", hold: "hold", resolve: "resolveHold", review: "grant", transfer: "transfer", accept: "acceptTransfer" };
try {
  if (!Object.hasOwn(methods, command) || !service || extra.length) throw new Error("Usage: node cli.mjs init|status|snapshot|begin|hold|resolve|review|transfer|accept SERVICE [input.json]");
  const root = defaultControlRoot();
  if (command === "init") mkdirSync(root, { recursive: true });
  const master = join(root, "..");
  const control = new ReleaseControl({ service, inbox: join(master, "INBOX.md"), outbox: join(master, "OUTBOX.md") });
  const input = inputFile ? JSON.parse(readFileSync(inputFile, "utf8")) : {};
  const result = await control[methods[command]](input);
  console.log(JSON.stringify(result ?? { recorded: true }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
