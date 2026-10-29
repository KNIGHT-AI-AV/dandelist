import { createHmac, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { checkPhoto } from "./agent/photos";
import { publicFetch } from "./agent/tools";
import { requireAuth, type AuthDeps, type AuthVars } from "./auth";
import type { Db } from "./db";
import { RateLimiter } from "./ratelimit";
import { newRefreshToken, sameHash, signAccess } from "./tokens";
import type { AppDeps } from "./app";

/**
 * Dandelist over MCP (owner, 2026-10-29: "Build mcp for agent", "Add photo check to mcp for agent", "Needs full control
 * (secure security for each account no bleed)"). A person connects an agent to their own account with a key they make
 * in Settings. The agent gets full control of that one account: wishes, hunts, saving, photos and the photo check.
 *
 * No bleed by construction: a key is stored only as a keyed hash, and each key has a session of its own. A tool call
 * runs as that session through the app's own routes, which scope every query to the signed-in person, so an agent can
 * reach nothing another account holds. Revoking the key revokes its session, and every later call fails at once.
 */

export const MCP_PROTOCOL = "2025-06-18";
const PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
/** Keys one person may hold at once. */
export const MAX_AGENT_KEYS = 10;
/** Calls one key may make a minute; hunts and photos keep their own daily caps on top. */
export const MCP_CALLS_PER_MINUTE = 120;
const KEY_PREFIX = "dl_";
/** An agent key's session lasts a year unless revoked first. */
const KEY_SESSION_MS = 365 * 24 * 60 * 60 * 1000;

/** The keyed hash a key is stored and looked up by; the key itself is never kept. */
export const hashAgentKey = (pepper: string, key: string) => createHmac("sha256", pepper).update(key).digest("hex");

type Call = (path: string, init?: RequestInit) => Response | Promise<Response>;

interface KeyRow {
  id: string;
  user_id: string;
  session_id: string;
  token_hash: string;
  last_used_at: string | Date | null;
}

/** The person and session behind a key, or null for a missing, unknown or revoked one. */
export async function agentFor(db: Db, pepper: string, header: string | undefined): Promise<KeyRow | null> {
  const key = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith(KEY_PREFIX) || key.length < 20 || key.length > 200) return null;
  const hash = hashAgentKey(pepper, key);
  const { rows } = await db.query<KeyRow>(
    `select t.id, t.user_id, t.session_id, t.token_hash, t.last_used_at from agent_tokens t
       join sessions s on s.id = t.session_id
      where t.token_hash = $1 and t.revoked_at is null and s.revoked_at is null`,
    [hash],
  );
  const row = rows[0];
  return row && sameHash(row.token_hash, hash) ? row : null;
}

/* ---------- keys: made, listed and revoked by the signed-in person ---------- */

const keyBody = z.object({ name: z.string().trim().min(1).max(60) });

export function agentKeyRoutes(deps: Pick<AuthDeps, "db" | "jwtSecret" | "now" | "codePepper">) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  app.use("*", requireAuth(deps));

  app.get("/", async (c) => {
    const { rows } = await db.query<{ id: string; name: string; prefix: string; created_at: string | Date; last_used_at: string | Date | null }>(
      "select id, name, prefix, created_at, last_used_at from agent_tokens where user_id = $1 and revoked_at is null order by created_at desc",
      [c.get("userId")],
    );
    return c.json({ keys: rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null })) });
  });

  app.post("/", async (c) => {
    const body = keyBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Name the agent this key is for." }, 400);
    const userId = c.get("userId");
    const held = await db.query<{ n: string | number }>("select count(*) as n from agent_tokens where user_id = $1 and revoked_at is null", [userId]);
    if (Number(held.rows[0]?.n ?? 0) >= MAX_AGENT_KEYS) return c.json({ error: `You can keep up to ${MAX_AGENT_KEYS} agent keys. Revoke one first.` }, 409);
    const now = deps.now();
    // The key's own session: nobody holds a refresh token for it, so it can only be used through this key.
    const session = (await db.query<{ id: string }>("insert into sessions (user_id, refresh_hash, expires_at) values ($1, $2, $3) returning id", [userId, newRefreshToken().hash, new Date(now.getTime() + KEY_SESSION_MS).toISOString()])).rows[0]!;
    const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const prefix = key.slice(0, 10);
    const { rows } = await db.query<{ id: string; created_at: string | Date }>(
      "insert into agent_tokens (user_id, session_id, name, token_hash, prefix, created_at) values ($1, $2, $3, $4, $5, $6) returning id, created_at",
      [userId, session.id, body.data.name, hashAgentKey(deps.codePepper, key), prefix, now.toISOString()],
    );
    // The key itself is in this answer only; it is never shown again.
    return c.json({ key, record: { id: rows[0]!.id, name: body.data.name, prefix, createdAt: new Date(rows[0]!.created_at).toISOString(), lastUsedAt: null } }, 201);
  });

  app.delete("/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That key wasn't found." }, 404);
    const at = deps.now().toISOString();
    const { rows } = await db.query<{ session_id: string }>("update agent_tokens set revoked_at = $3 where id = $1 and user_id = $2 and revoked_at is null returning session_id", [id.data, c.get("userId"), at]);
    if (!rows[0]) return c.json({ error: "That key wasn't found." }, 404);
    await db.query("update sessions set revoked_at = $3 where id = $1 and user_id = $2 and revoked_at is null", [rows[0].session_id, c.get("userId"), at]);
    return c.body(null, 204);
  });

  return app;
}

/* ---------- the MCP server ---------- */

const KINDS = ["buy", "own", "do", "visit"] as const;
const TIERS = ["must", "nice", "dream"] as const;
const uuid = { type: "string", format: "uuid" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** Every tool an agent can call, with the JSON Schema of its input. */
export const MCP_TOOLS = [
  { name: "list_wishes", description: "List every wish on this account: name, kind, tier, price, running costs, photo and source.", inputSchema: obj({}) },
  { name: "get_wish", description: "One wish by id.", inputSchema: obj({ id: uuid }, ["id"]) },
  {
    name: "add_wish",
    description: "Add a wish with a price you already know. To find the real price, use hunt, then save_hunt.",
    inputSchema: obj(
      {
        name: { type: "string", maxLength: 200 },
        kind: { type: "string", enum: KINDS, description: "buy: a thing; own: a home or car; do: an experience or service; visit: a trip." },
        tier: { type: "string", enum: TIERS },
        upfront_cents: { type: "integer", minimum: 0 },
        photo_url: { type: "string", description: "A web address of a photo of it." },
        source_url: { type: "string", description: "The page it is sold or described on." },
      },
      ["name", "kind"],
    ),
  },
  {
    name: "update_wish",
    description: "Change a wish's name, tier or upfront price.",
    inputSchema: obj({ id: uuid, name: { type: "string", maxLength: 200 }, tier: { type: "string", enum: TIERS }, upfront_cents: { type: "integer", minimum: 0 } }, ["id"]),
  },
  { name: "remove_wish", description: "Remove a wish from the list.", inputSchema: obj({ id: uuid }, ["id"]) },
  { name: "hunt", description: "Start the price hunt for a wish described in words. Poll hunt_status with the run_id; a first card lands in about 15 s and the hunt ends within a minute.", inputSchema: obj({ text: { type: "string", minLength: 2, maxLength: 1000 } }, ["text"]) },
  { name: "hunt_status", description: "A hunt's status and the prices and photos it found so far.", inputSchema: obj({ run_id: uuid }, ["run_id"]) },
  { name: "save_hunt", description: "Save a hunt's option (the best, unless you pick another by index) as a wish.", inputSchema: obj({ run_id: uuid, option: { type: "integer", minimum: 0, maximum: 3 }, tier: { type: "string", enum: TIERS } }, ["run_id"]) },
  { name: "photo_check", description: "Check a photo before showing it: it opens, is large enough and photo-shaped, and isn't named like a logo, map, flag or diagram.", inputSchema: obj({ url: { type: "string" } }, ["url"]) },
  {
    name: "find_photo",
    description: "Have the AI find a better photo of a wish, never one it already shows. With save true, the wish keeps it.",
    inputSchema: obj({ wish_id: uuid, save: { type: "boolean" } }, ["wish_id"]),
  },
  { name: "summary", description: "What the list comes to: the count, the upfront total and the running costs a month, by tier.", inputSchema: obj({}) },
];

class ToolError extends Error {}

type ServerWish = { id: string; name: string; kind: string; tier: string; upfrontCents: number; recurring: { amountCents: number; period: string; label?: string }[]; details: { agent?: Record<string, any> } };
const PER_MONTH: Record<string, number> = { week: 52 / 12, month: 1, year: 1 / 12 };

const compact = (w: ServerWish) => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  tier: w.tier,
  upfront_cents: w.upfrontCents,
  recurring: w.recurring,
  photo_url: w.details?.agent?.imageUrl ?? null,
  source_url: w.details?.agent?.url ?? null,
  seller: w.details?.agent?.seller ?? null,
});

const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Runs one tool as the key's person, through the app's own routes (`as`), which scope everything to them. */
async function runTool(name: string, args: Record<string, unknown>, as: (method: string, path: string, body?: unknown) => Promise<any>, deps: { webFetch?: typeof publicFetch }) {
  const wishes = async () => ((await as("GET", "/wishes")).wishes as ServerWish[]) ?? [];
  const wish = async (id: string) => {
    const w = (await wishes()).find((x) => x.id === id);
    if (!w) throw new ToolError("That wish wasn't found on this account.");
    return w;
  };
  switch (name) {
    case "list_wishes":
      return { wishes: (await wishes()).map(compact) };
    case "get_wish":
      return { wish: compact(await wish(z.string().uuid().parse(args.id))) };
    case "add_wish": {
      const a = z
        .object({ name: z.string().trim().min(1).max(200), kind: z.enum(KINDS), tier: z.enum(TIERS).default("nice"), upfront_cents: z.number().int().min(0).default(0), photo_url: z.string().url().optional(), source_url: z.string().url().optional() })
        .parse(args);
      const agent = a.photo_url || a.source_url ? { agent: { seller: a.source_url ? hostOf(a.source_url) : "", url: a.source_url ?? "", status: "estimate", checkedAt: new Date().toISOString(), ...(a.photo_url ? { imageUrl: a.photo_url } : {}) } } : {};
      const { wish: w } = await as("POST", "/wishes", { name: a.name, kind: a.kind, tier: a.tier, upfrontCents: a.upfront_cents, recurring: [], details: agent });
      return { wish: compact(w) };
    }
    case "update_wish": {
      const a = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200).optional(), tier: z.enum(TIERS).optional(), upfront_cents: z.number().int().min(0).optional() }).parse(args);
      const change = { ...(a.name ? { name: a.name } : {}), ...(a.tier ? { tier: a.tier } : {}), ...(a.upfront_cents !== undefined ? { upfrontCents: a.upfront_cents } : {}) };
      if (!Object.keys(change).length) throw new ToolError("Say what to change: name, tier or upfront_cents.");
      const { wish: w } = await as("PATCH", `/wishes/${a.id}`, change);
      return { wish: compact(w) };
    }
    case "remove_wish":
      await as("DELETE", `/wishes/${z.string().uuid().parse(args.id)}`);
      return { removed: true };
    case "hunt": {
      const { run } = await as("POST", "/agent/runs", { text: z.string().trim().min(2).max(1000).parse(args.text) });
      return { run_id: run.id, status: run.status, cached: !!run.cached };
    }
    case "hunt_status": {
      const { run } = await as("GET", `/agent/runs/${z.string().uuid().parse(args.run_id)}`);
      const options = (run.result?.options ?? []) as Record<string, any>[];
      return {
        run_id: run.id,
        status: run.status,
        title: run.draft?.title ?? null,
        provisional: !!run.result?.provisional,
        error: run.error,
        options: options.map((o, i) => ({ index: i, seller: o.seller, url: o.url, upfront_cents: o.upfrontCents, status: o.status, photo_url: o.imageUrl ?? null })),
      };
    }
    case "save_hunt": {
      const a = z.object({ run_id: z.string().uuid(), option: z.number().int().min(0).max(3).default(0), tier: z.enum(TIERS).default("nice") }).parse(args);
      const { run } = await as("GET", `/agent/runs/${a.run_id}`);
      const o = run.result?.options?.[a.option];
      if (!o || !run.draft) throw new ToolError(run.status === "running" ? "The hunt hasn't found a price yet. Check hunt_status again in a few seconds." : "That hunt has no option to save.");
      const imageUrl = o.imageUrl ?? run.result.options.find((x: Record<string, any>) => x.imageUrl)?.imageUrl;
      const { wish: w } = await as("POST", "/wishes", {
        name: run.draft.title,
        kind: run.draft.kind,
        tier: a.tier,
        upfrontCents: o.upfrontCents,
        recurring: (o.recurring ?? []).map((r: Record<string, any>) => ({ amountCents: r.amountCents, period: r.period, label: String(r.label ?? "").slice(0, 60) })),
        details: { agent: { runId: run.id, seller: o.seller, url: o.url, status: o.status, checkedAt: o.checkedAt, ...(imageUrl ? { imageUrl } : {}), ...(o.media ? { media: o.media } : {}), explanation: run.result.explanation, source: o.source } },
      });
      return { wish: compact(w) };
    }
    case "photo_check": {
      const url = z.string().url().parse(args.url);
      return await checkPhoto(url, deps.webFetch ?? publicFetch);
    }
    case "find_photo": {
      const a = z.object({ wish_id: z.string().uuid(), save: z.boolean().default(false) }).parse(args);
      const w = await wish(a.wish_id);
      const shown = [w.details?.agent?.imageUrl, ...((w.details?.agent?.media?.images ?? []) as { url: string }[]).map((i) => i.url)].filter((u): u is string => !!u);
      const { photo } = await as("POST", "/agent/photo", { title: w.name, kind: w.kind, exclude: shown });
      if (a.save) {
        const old = (w.details?.agent?.media?.images ?? []) as { url: string }[];
        const media = { kind: photo.media.kind, images: [...photo.media.images, ...old.filter((i) => i.url !== photo.imageUrl)].slice(0, 6) };
        await as("PATCH", `/wishes/${w.id}`, { details: { ...w.details, agent: { ...(w.details?.agent ?? {}), imageUrl: photo.imageUrl, media } } });
      }
      return { photo_url: photo.imageUrl, source: photo.media.images[0]?.source ?? null, how: photo.how, saved: a.save };
    }
    case "summary": {
      const all = await wishes();
      const by = (list: ServerWish[]) => ({
        count: list.length,
        upfront_cents: list.reduce((s, w) => s + w.upfrontCents, 0),
        running_cents_a_month: Math.round(list.reduce((s, w) => s + w.recurring.reduce((t, r) => t + r.amountCents * (PER_MONTH[r.period] ?? 1), 0), 0)),
      });
      return { all: by(all), ...Object.fromEntries(TIERS.map((t) => [t, by(all.filter((w) => w.tier === t))])) };
    }
  }
  throw new ToolError(`There is no tool called ${name}.`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function mcpRoutes(deps: AppDeps & { call: Call }) {
  const app = new Hono();
  const { db } = deps;
  const perKey = new RateLimiter(MCP_CALLS_PER_MINUTE, 60_000);

  app.get("/", (c) => c.json({ error: "Send MCP requests with POST." }, 405, { Allow: "POST" }));
  app.delete("/", (c) => c.json({ error: "Send MCP requests with POST." }, 405, { Allow: "POST" }));

  app.post("/", async (c) => {
    // A browser page on another site may not drive an account's agent.
    const origin = c.req.header("Origin");
    if (origin && !deps.webOrigins.includes(origin)) return c.json(rpcError(null, -32000, "This origin may not call Dandelist's MCP server."), 403);
    const key = await agentFor(db, deps.codePepper, c.req.header("Authorization"));
    if (!key) return c.json(rpcError(null, -32001, "Use an agent key from Dandelist's Settings, sent as a Bearer token."), 401, { "WWW-Authenticate": 'Bearer realm="dandelist"' });
    if (!perKey.take(key.id, deps.now().getTime())) return c.json(rpcError(null, -32002, `Slow down: up to ${MCP_CALLS_PER_MINUTE} calls a minute per key.`), 429);
    const last = key.last_used_at ? new Date(key.last_used_at).getTime() : 0;
    if (deps.now().getTime() - last > 60_000) await db.query("update agent_tokens set last_used_at = $2 where id = $1", [key.id, deps.now().toISOString()]);

    // Every tool call runs as this key's own session, through the routes the app itself uses.
    const as = async (method: string, path: string, body?: unknown) => {
      const jwt = await signAccess(deps.jwtSecret, key.user_id, key.session_id, Math.floor(deps.now().getTime() / 1000));
      const res = await deps.call(path, { method, headers: { Authorization: `Bearer ${jwt}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) throw new ToolError((data as { error?: string } | null)?.error ?? `That didn't work (${res.status}).`);
      return data;
    };

    const handle = async (m: Rpc) => {
      if (!m || typeof m !== "object" || typeof m.method !== "string") return rpcError(m?.id, -32600, "Not a JSON-RPC request.");
      const notification = m.id === undefined || m.id === null;
      switch (m.method) {
        case "initialize": {
          const asked = String(m.params?.protocolVersion ?? "");
          return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: PROTOCOLS.has(asked) ? asked : MCP_PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "dandelist", title: "Dandelist", version: "1.0.0" }, instructions: "Dandelist keeps one person's wish list and what each wish really costs. Every tool acts on the account this key belongs to, and nothing else." } };
        }
        case "ping":
          return { jsonrpc: "2.0", id: m.id, result: {} };
        case "tools/list":
          return { jsonrpc: "2.0", id: m.id, result: { tools: MCP_TOOLS } };
        case "tools/call": {
          const name = String(m.params?.name ?? "");
          const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
          if (!MCP_TOOLS.some((t) => t.name === name)) return rpcError(m.id, -32602, `There is no tool called ${name}.`);
          try {
            const result = await runTool(name, args, as, { webFetch: deps.webFetch });
            return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } };
          } catch (e) {
            const message = e instanceof ToolError ? e.message : e instanceof z.ZodError ? `Check the arguments: ${e.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` : "That didn't work. Try again.";
            if (!(e instanceof ToolError || e instanceof z.ZodError)) console.error("mcp tool failed", name, e instanceof Error ? e.message : e);
            return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: message }], isError: true } };
          }
        }
        default:
          return notification ? null : rpcError(m.id, -32601, `Unknown method ${m.method}.`);
      }
    };

    const body = (await c.req.json().catch(() => undefined)) as Rpc | Rpc[] | undefined;
    if (body === undefined) return c.json(rpcError(null, -32700, "Send a JSON-RPC message."), 400);
    const batch = Array.isArray(body) ? body.slice(0, 20) : [body];
    const replies = (await Promise.all(batch.map(handle))).filter((r) => r !== null);
    if (!replies.length) return c.body(null, 202);
    return c.json(Array.isArray(body) ? replies : replies[0]);
  });

  return app;
}
