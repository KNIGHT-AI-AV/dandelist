import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { API_URL, useAuth, type LinkedIdentity, type ProviderId } from "./auth";
import type { PersonaId } from "./persona-state";

/**
 * The signed-in person as settings and the top bar show them: name, picture, the Dandy's facts, the numbers behind
 * their list, and the sign-in accounts linked to them (API: apps/api/src/me.ts). The profile is kept in one place so
 * the avatar in the top bar changes the moment settings saves a new picture.
 */

export interface Profile {
  email: string;
  name: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Stats {
  wishes: number;
  /** In US cents. */
  totalCents: number;
  pricesChecked: number;
  conversations: number;
  daysSinceJoining: number;
  biggest: { name: string; cents: number } | null;
  places: number;
  things: number;
  experiences: number;
}

export interface Facts {
  lines: string[];
  generatedAt: string | null;
}

export type Home = { country: string; city?: string; region?: string; label: string };
export type Api = (path: string, init?: RequestInit) => Promise<Response>;

/** The API's limits, mirrored so the app can say so before uploading. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const NAME_MAX = 60;
/** Pictures are cropped square and scaled to this on the web before upload; phones crop in the picker. */
const AVATAR_EDGE = 640;

/** Where a picture is served, from its media key. */
export const avatarUri = (key: string | null | undefined) => (key ? `${API_URL}/media/${key}` : null);

/** The first letter to show when there is no picture: the name's, else the email's. */
export const initialOf = (p: { name?: string | null; email?: string | null } | null | undefined) =>
  ((p?.name ?? "").trim().charAt(0) || (p?.email ?? "").trim().charAt(0) || "·").toUpperCase();

async function message(res: Response | null, fallback: string): Promise<string> {
  if (!res) return "Can't reach Dandelist. Check your connection.";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return fallback;
}

/** Reads a JSON answer, or throws the API's own words. */
async function read<T>(res: Response | null, fallback: string): Promise<T> {
  if (!res?.ok) throw new Error(await message(res, fallback));
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ the shared profile

type Snapshot = { userId: string | null; profile: Profile | null };
let snapshot: Snapshot = { userId: null, profile: null };
const listeners = new Set<() => void>();
let loading: { userId: string; promise: Promise<void> } | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const current = () => snapshot;

function load(api: Api, userId: string): Promise<void> {
  if (loading?.userId === userId) return loading.promise;
  const promise = api("/me/profile")
    .then((r) => read<{ profile: Profile }>(r, "Couldn't load your profile."))
    .then(({ profile }) => publish({ userId, profile }))
    .catch(() => {})
    .finally(() => {
      if (loading?.promise === promise) loading = null;
    });
  loading = { userId, promise };
  return promise;
}

export interface ProfileStore {
  profile: Profile | null;
  reload(): Promise<void>;
  saveName(name: string): Promise<void>;
  uploadAvatar(image: PickedImage): Promise<void>;
  removeAvatar(): Promise<void>;
}

/** The signed-in person's profile, shared by every screen that shows it. Loads once per account. */
export function useProfile(): ProfileStore {
  const { status, user, api } = useAuth();
  const userId = status === "signedIn" ? (user?.id ?? null) : null;
  const snap = useSyncExternalStore(subscribe, current, current);
  const profile = userId && snap.userId === userId ? snap.profile : null;

  useEffect(() => {
    if (!userId) return;
    if (snapshot.userId !== userId || !snapshot.profile) void load(api, userId);
  }, [userId, api]);

  const keep = useCallback((p: Profile) => userId && publish({ userId, profile: p }), [userId]);

  const reload = useCallback(async () => {
    if (userId) await load(api, userId);
  }, [api, userId]);

  const saveName = useCallback(
    async (name: string) => {
      const res = await api("/me/profile", json("PATCH", { name: name.trim() || null })).catch(() => null);
      keep((await read<{ profile: Profile }>(res, "Couldn't save your name.")).profile);
    },
    [api, keep],
  );

  const uploadAvatar = useCallback(
    async (image: PickedImage) => {
      if (image.size > MAX_AVATAR_BYTES) throw new Error("Choose a photo under 2 MB.");
      const res = await api("/me/avatar", { method: "POST", headers: { "Content-Type": image.type }, body: image.body }).catch(() => null);
      keep((await read<{ profile: Profile }>(res, "Couldn't save that photo.")).profile);
    },
    [api, keep],
  );

  const removeAvatar = useCallback(async () => {
    const res = await api("/me/avatar", { method: "DELETE" }).catch(() => null);
    keep((await read<{ profile: Profile }>(res, "Couldn't remove the photo.")).profile);
  }, [api, keep]);

  return { profile, reload, saveName, uploadAvatar, removeAvatar };
}

// ------------------------------------------------------------------ choosing a picture

export type AvatarType = "image/jpeg" | "image/png" | "image/webp";
export interface PickedImage {
  body: Blob;
  type: AvatarType;
  size: number;
}

const TYPES: AvatarType[] = ["image/jpeg", "image/png", "image/webp"];
const typeOf = (mime: string | null | undefined, uri = ""): AvatarType | null => {
  const m = (mime ?? "").toLowerCase();
  if ((TYPES as string[]).includes(m)) return m as AvatarType;
  if (m === "image/jpg") return "image/jpeg";
  if (m) return null;
  if (/\.jpe?g$/i.test(uri)) return "image/jpeg";
  if (/\.png$/i.test(uri)) return "image/png";
  if (/\.webp$/i.test(uri)) return "image/webp";
  return null;
};

/** The web's own file chooser, resolving null when the person closes it without choosing. */
function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Crops the middle square of a picture and scales it to AVATAR_EDGE as a JPEG, in the browser. */
async function squareJpeg(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.min(AVATAR_EDGE, side);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88));
}

/**
 * Lets the person choose a picture: the browser's file chooser on the web (cropped square and scaled down before it
 * goes up), the photo library on a phone with a square crop. Null when they back out.
 */
export async function pickAvatarImage(): Promise<PickedImage | null> {
  if (Platform.OS === "web") {
    const file = await chooseFile(TYPES.join(","));
    if (!file) return null;
    const square = await squareJpeg(file).catch(() => null);
    if (square) return { body: square, type: "image/jpeg", size: square.size };
    const type = typeOf(file.type, file.name);
    if (!type) throw new Error("Choose a JPEG, PNG or WebP photo.");
    return { body: file, type, size: file.size };
  }
  // Loaded only when asked for: a build made before the photo picker was added has no native module for it, and
  // importing it up front would stop the whole app from starting there.
  let ImagePicker: typeof import("expo-image-picker");
  try {
    ImagePicker = await import("expo-image-picker");
  } catch {
    throw new Error("Choosing a photo needs the newest Dandelist. Update the app, or add your photo on the web.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  const type = typeOf(asset.mimeType, asset.uri);
  if (!type) throw new Error("Choose a JPEG, PNG or WebP photo.");
  const body = await (await fetch(asset.uri)).blob();
  return { body, type, size: body.size || asset.fileSize || 0 };
}

// ------------------------------------------------------------------ the rest of settings

export const fetchStats = async (api: Api) => (await read<{ stats: Stats }>(await api("/me/stats").catch(() => null), "Couldn't load your numbers.")).stats;

export const fetchFacts = async (api: Api) => (await read<{ facts: Facts | null }>(await api("/me/facts").catch(() => null), "Couldn't load the facts.")).facts;

export const newFacts = async (api: Api, persona?: PersonaId) =>
  (await read<{ facts: Facts }>(await api("/me/facts", json("POST", persona ? { persona } : {})).catch(() => null), "Nothing came to mind just now. Try again.")).facts;

export const fetchIdentities = async (api: Api) =>
  (await read<{ identities: LinkedIdentity[] }>(await api("/me/identities").catch(() => null), "Couldn't load your sign-in accounts.")).identities;

export const unlinkProvider = async (api: Api, provider: ProviderId) =>
  (await read<{ identities: LinkedIdentity[] }>(await api(`/me/identities/${provider}`, { method: "DELETE" }).catch(() => null), "Couldn't unlink that account.")).identities;

export const fetchHome = async (api: Api) =>
  (await read<{ life: { home: Home | null; currency: string } }>(await api("/me/life").catch(() => null), "Couldn't load where you live.")).life;

/** Saves where they want to live. The currency goes with it, so moving country never changes it behind their back. */
export const saveHome = async (api: Api, home: Home | null, currency: string) =>
  (await read<{ life: { home: Home | null; currency: string } }>(await api("/me/life", json("PUT", { home, currency })).catch(() => null), "Couldn't save that place.")).life;

/** Deletes the account and everything on it. Resolves once the server has done it. */
export async function deleteAccount(api: Api): Promise<void> {
  const res = await api("/me", { method: "DELETE" }).catch(() => null);
  if (!res || (!res.ok && res.status !== 204)) throw new Error(await message(res, "Couldn't delete the account. Try again."));
}
