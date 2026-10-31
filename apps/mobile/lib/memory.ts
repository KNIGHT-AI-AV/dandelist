import type { Api } from "./profile";

/** One line the Dandy remembers about the person between conversations (api memory.ts). */
export interface Memory {
  id: string;
  text: string;
  createdAt: string;
}

const FAILED = "Couldn't do that just now. Try again.";

async function read(res: Response | null): Promise<Memory[]> {
  if (!res?.ok) throw new Error(FAILED);
  const body = (await res.json().catch(() => null)) as { memories?: Memory[] } | null;
  if (!Array.isArray(body?.memories)) throw new Error(FAILED);
  return body.memories;
}

/** What the Dandy remembers, newest first. */
export const fetchMemories = async (api: Api) => read(await api("/me/memories").catch(() => null));
/** Removes one line; answers with what is left. */
export const forgetMemory = async (api: Api, id: string) => read(await api(`/me/memories/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null));
/** Removes every line. */
export const forgetAllMemories = async (api: Api) => read(await api("/me/memories", { method: "DELETE" }).catch(() => null));
