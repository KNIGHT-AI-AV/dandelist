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
  /** Stores a profile photo under its own key (see avatarKeyFor). */
  putAvatar(key: string, bytes: Uint8Array, type: MediaType): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; type: MediaType } | null>;
  /** A help report's file under help/ (help.ts): kept private, never served by /media. */
  putPrivate?(key: string, bytes: Uint8Array, type: string): Promise<void>;
  /**
   * Removes a profile photo. Only avatar keys can be deleted: the agent's pictures are shared between everyone whose
   * wish shows them, so nothing a person does can remove one.
   */
  delete(key: string): Promise<void>;
}

export type MediaType = "image/png" | "image/jpeg" | "image/webp";
const EXT: Record<MediaType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MEDIA_KEY = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
/** Profile photos live in their own namespace (avatars/ in the bucket), never sharing a key with the agent's pictures. */
export const AVATAR_KEY = /^av-[a-f0-9]{64}\.(png|jpg|webp)$/;
/** A help report's files: help/<report id>/report.json or screen.jpg. Never matches isStoredKey, so /media never serves one. */
export const HELP_KEY = /^[0-9a-f-]{36}\/(report\.json|screen\.jpg)$/;
export const isStoredKey = (key: string) => MEDIA_KEY.test(key) || AVATAR_KEY.test(key);
export const typeOfKey = (key: string): MediaType => (key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg");

export const keyFor = (bytes: Uint8Array, type: MediaType) => `${createHash("sha256").update(bytes).digest("hex")}.${EXT[type]}`;
/**
 * A profile photo's key: the sha256 of its owner's id and its bytes, so no two people ever share one. Removing a
 * photo can then never take someone else's, and no reference counting (with its races) is needed.
 */
export const avatarKeyFor = (owner: string, bytes: Uint8Array, type: MediaType) => `av-${createHash("sha256").update(`${owner}\0`).update(bytes).digest("hex")}.${EXT[type]}`;
/** Where a key lives in the bucket. */
const s3Path = (key: string) => (AVATAR_KEY.test(key) ? `avatars/${key}` : `agent/${key}`);
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
    async putAvatar(key, bytes) {
      if (AVATAR_KEY.test(key)) objects.set(key, bytes);
    },
    async putPrivate(key, bytes) {
      if (HELP_KEY.test(key)) objects.set(`help/${key}`, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { bytes, type: typeOfKey(key) } : null;
    },
    async delete(key) {
      if (AVATAR_KEY.test(key)) objects.delete(key);
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
    async putAvatar(key, bytes) {
      if (!AVATAR_KEY.test(key)) return;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, key), bytes);
    },
    async putPrivate(key, bytes) {
      if (!HELP_KEY.test(key)) return;
      await mkdir(join(dir, "help", key.split("/")[0]!), { recursive: true });
      await writeFile(join(dir, "help", key), bytes);
    },
    async get(key) {
      if (!isStoredKey(key)) return null;
      try {
        return { bytes: await readFile(join(dir, key)), type: typeOfKey(key) };
      } catch {
        return null;
      }
    },
    async delete(key) {
      if (AVATAR_KEY.test(key)) await rm(join(dir, key), { force: true });
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
    async putAvatar(key, bytes, type) {
      if (!AVATAR_KEY.test(key)) return;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Path(key), Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
    },
    async putPrivate(key, bytes, type) {
      if (!HELP_KEY.test(key)) return;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `help/${key}`, Body: bytes, ContentType: type, CacheControl: "private, no-store" }));
    },
    async get(key) {
      if (!isStoredKey(key)) return null;
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Path(key) }));
        const bytes = await out.Body?.transformToByteArray();
        return bytes ? { bytes, type: typeOfKey(key) } : null;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
    async delete(key) {
      if (AVATAR_KEY.test(key)) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Path(key) }));
    },
  };
}
