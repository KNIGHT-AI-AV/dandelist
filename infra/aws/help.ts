import { GetObjectCommand, ListObjectsV2Command, S3Client, type _Object } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { credentials, region } from "./creds";
import { parseHelpArgs } from "./help-args";

/**
 * The help reports people sent from the app (apps/api/src/help.ts), for the team (Claude and Codex): the newest first,
 * each one's report and screen downloaded to _scratch/help/<id>/ to read and look at. They live in the private media
 * bucket under help/, which the API never serves; this reads them with the deploy user's own AWS access.
 *
 *   npx tsx infra/aws/help.ts               the newest five
 *   npx tsx infra/aws/help.ts --count 20    the newest twenty (1 to 50)
 *   npx tsx infra/aws/help.ts 3F9A2C        the report with that code (its id's first six characters; 123456 too)
 */
const args = parseHelpArgs(process.argv.slice(2));
if ("error" in args) {
  console.error(args.error);
  process.exit(2);
}
const { code } = args;
const count = code ? 200 : args.count;

const ACCOUNT = (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Account!;
const BUCKET = `dandelist-media-${ACCOUNT}`;
const s3 = new S3Client({ region, credentials });

const all: _Object[] = [];
let token: string | undefined;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "help/", ContinuationToken: token }));
  all.push(...(page.Contents ?? []));
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

const reports = all
  .filter((o) => o.Key?.endsWith("/report.json"))
  .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))
  .filter((o) => !code || o.Key!.split("/")[1]!.startsWith(code))
  .slice(0, count);
if (!reports.length) {
  console.log(code ? `No report with code ${code.toUpperCase()}.` : "No help reports yet.");
  process.exit(0);
}

const out = resolve(import.meta.dirname, "../../../_scratch/help");
for (const r of reports) {
  const id = r.Key!.split("/")[1]!;
  const dir = join(out, id);
  await mkdir(dir, { recursive: true });
  for (const name of ["report.json", "screen.jpg"]) {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `help/${id}/${name}` }));
      await writeFile(join(dir, name), await obj.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name !== "NoSuchKey") throw e;
    }
  }
  const report = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "report.json"), "utf8")) as {
    at: string;
    app?: { route?: string; platform?: string; version?: string };
    chat?: { transcript?: { role: string; text: string }[] } | null;
  };
  const last = report.chat?.transcript?.filter((e) => e.role === "user").at(-1)?.text ?? "";
  console.log(`${id.slice(0, 6).toUpperCase()}  ${report.at}  ${report.app?.platform ?? "?"} ${report.app?.version ?? ""}  ${report.app?.route ?? ""}  last said: ${last.slice(0, 80)}\n  ${dir}`);
}
