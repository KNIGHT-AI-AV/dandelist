/**
 * Uploads curated images to the media bucket under the same content-hash keys the API uses, so they are served at
 * https://api.dandelist.knightaiav.com/media/<sha256>.<ext>. Reads a manifest { id: { file, type, cutout?: { file, type } } }
 * and writes it back with a `url` on each entry. The images stay out of git.
 * Usage: pnpm --filter @dandelist/infra-aws exec tsx upload-media.ts <manifest.json>
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { credentials, region } from "./creds";

type File = { file: string; type: "image/jpeg" | "image/png"; url?: string };
const EXT = { "image/jpeg": "jpg", "image/png": "png" } as const;
const PUBLIC = "https://api.dandelist.knightaiav.com";

const path = process.argv[2];
if (!path) throw new Error("Pass the manifest path");
const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, File & { cutout?: File }>;
const account = (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Account!;
const bucket = `dandelist-media-${account}`;
const s3 = new S3Client({ region, credentials });

async function upload(f: File): Promise<string> {
  const bytes = await readFile(f.file);
  const key = `${createHash("sha256").update(bytes).digest("hex")}.${EXT[f.type]}`;
  const exists = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `agent/${key}` })).then(() => true, () => false);
  if (!exists) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `agent/${key}`, Body: bytes, ContentType: f.type, CacheControl: "public, max-age=31536000, immutable" }));
  return `${PUBLIC}/media/${key}`;
}

for (const [id, entry] of Object.entries(manifest)) {
  entry.url = await upload(entry);
  if (entry.cutout) entry.cutout.url = await upload(entry.cutout);
  console.log(`${id}  ${entry.url}${entry.cutout ? "  +cutout" : ""}`);
}
await writeFile(path, JSON.stringify(manifest, null, 1));
