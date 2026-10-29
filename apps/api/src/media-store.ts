import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where the agent keeps images it makes (SAM cutouts, Muse Image pictures). Objects are named by the sha256 of their
 * bytes, so a key can't be guessed from anything but the image itself, and the API serves them at GET /media/:key.
 * Production uses the private S3 bucket made by infra/aws/up.ts; the API reads it with its instance role.
 */
export interface MediaStore {
  put(bytes: Uint8Array, type: MediaType): Promise<string>;
  get(key: string): Promise<{ bytes: Uint8Array; type: MediaType } | null>;
  /** Removes an object nobody uses any more (a replaced profile photo, a deleted account's). */
  delete?(key: string): Promise<void>;
}

export type MediaType = "image/png" | "image/jpeg" | "image/webp";
const EXT: Record<MediaType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MEDIA_KEY = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
export const typeOfKey = (key: string): MediaType => (key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg");

export const keyFor = (bytes: Uint8Array, type: MediaType) => `${createHash("sha256").update(bytes).digest("hex")}.${EXT[type]}`;
const urlFor = (publicBase: string, key: string) => `${publicBase.replace(/\/+$/, "")}/media/${key}`;

export function memoryMediaStore(publicBase: string): MediaStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(bytes, type) {
      const key = keyFor(bytes, type);
      objects.set(key, bytes);
      return urlFor(publicBase, key);
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { bytes, type: typeOfKey(key) } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

/** For local runs and the live check: files in a folder. */
export function fileMediaStore(dir: string, publicBase: string): MediaStore {
  return {
    async put(bytes, type) {
      const key = keyFor(bytes, type);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, key), bytes);
      return urlFor(publicBase, key);
    },
    async get(key) {
      if (!MEDIA_KEY.test(key)) return null;
      try {
        return { bytes: await readFile(join(dir, key)), type: typeOfKey(key) };
      } catch {
        return null;
      }
    },
    async delete(key) {
      if (MEDIA_KEY.test(key)) await rm(join(dir, key), { force: true });
    },
  };
}

export async function s3MediaStore(bucket: string, region: string, publicBase: string): Promise<MediaStore> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region });
  return {
    async put(bytes, type) {
      const key = keyFor(bytes, type);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `agent/${key}`, Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
      return urlFor(publicBase, key);
    },
    async get(key) {
      if (!MEDIA_KEY.test(key)) return null;
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `agent/${key}` }));
        const bytes = await out.Body?.transformToByteArray();
        return bytes ? { bytes, type: typeOfKey(key) } : null;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
    async delete(key) {
      if (MEDIA_KEY.test(key)) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `agent/${key}` }));
    },
  };
}
