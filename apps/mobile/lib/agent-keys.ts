import { API_URL } from "./auth";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/** A key a person made for an agent; the key itself is shown only once, when it is made. */
export interface AgentKey {
  id: string;
  name: string;
  /** The key's first characters, to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The address an agent connects to (Dandelist's MCP server). */
export const MCP_URL = `${API_URL.replace(/\/+$/, "")}/mcp`;

async function read<T>(res: Response | null, fallback: string): Promise<T> {
  if (res?.ok) return (res.status === 204 ? null : await res.json()) as T;
  const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
  throw new Error(body?.error ?? fallback);
}

export async function listAgentKeys(api: Api): Promise<AgentKey[]> {
  return (await read<{ keys: AgentKey[] }>(await api("/me/agent-keys").catch(() => null), "Couldn't load your agent keys.")).keys;
}

export async function makeAgentKey(api: Api, name: string): Promise<{ key: string; record: AgentKey }> {
  return read(await api("/me/agent-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).catch(() => null), "Couldn't make a key.");
}

export async function revokeAgentKey(api: Api, id: string): Promise<void> {
  await read(await api(`/me/agent-keys/${id}`, { method: "DELETE" }).catch(() => null), "Couldn't revoke the key.");
}

/** When a key was last used, in a few words: "Never used", "Used today", "Used yesterday" or "Used 3 Oct". */
export function lastUsedLine(lastUsedAt: string | null, now = new Date()): string {
  if (!lastUsedAt) return "Never used";
  const at = new Date(lastUsedAt);
  const day = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const ago = day(now) - day(at);
  if (ago <= 0) return "Used today";
  if (ago === 1) return "Used yesterday";
  return `Used ${at.getDate()} ${at.toLocaleString("en-GB", { month: "short" })}`;
}
