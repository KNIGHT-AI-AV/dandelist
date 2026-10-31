import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AgentDeps } from "./agent/routes";
import { posthog } from "./analytics";
import { requireAuth, type AuthVars } from "./auth";
import { listWishes } from "./wishes";

/**
 * POST /help: what someone sees when something looks wrong, in one tap (owner, 2026-10-31: "a help icon so that it
 * takes a direct state of everything on the application and loads it somewhere where you can and Codex can always
 * reach to see issues; however, that data needs to be protected ... if I see an issue, I can just press a button and
 * then immediately go to this chat and talk to you and you could literally see it with pictures").
 *
 * The app sends its own state and a picture of the screen; the server adds what it knows (the latest conversation,
 * the list, the last hunts) and keeps the report with the account (help_reports) and, with its picture, in the
 * private media bucket under help/<id>/, which /media never serves and the team reads with its own AWS access
 * (infra/aws/help.ts). The answer is a short code to quote. Only the person's own data goes in, only when they send it.
 */

/** The request: the app's state as JSON and a JPEG of the screen in base64. */
export const HELP_MAX_BYTES = 3_000_000;
const SCREEN_MAX_BYTES = 2_000_000;
/** Reports one person can send in a day. */
export const HELP_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const helpBody = z.object({
  state: z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= 100_000, "Too much."),
  screenshot: z.string().max(2_800_000).optional(),
  /** The PostHog session the report came from, so the replay is one click away. */
  replay: z.string().max(120).optional(),
});

type ChatRow = { id: string; transcript: unknown; state: unknown; updated_at: unknown };
type RunRow = { id: string; status: string; error: string | null; title: string | null; created_at: unknown; updated_at: unknown };
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function helpRoutes(deps: AgentDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  app.use("*", requireAuth(deps));

  app.post("/", bodyLimit({ maxSize: HELP_MAX_BYTES, onError: (c) => c.json({ error: "That's too much to send in one report." }, 413) }), async (c) => {
    const body = helpBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "That report couldn't be read." }, 400);
    const userId = c.get("userId");
    const now = deps.now();
    const sent = await db.query<{ n: string | number }>("select count(*) as n from help_reports where user_id = $1 and created_at > $2", [userId, new Date(now.getTime() - DAY_MS).toISOString()]);
    if (Number(sent.rows[0]?.n ?? 0) >= HELP_PER_DAY) return c.json({ error: "That's a lot of reports for one day. Try again tomorrow." }, 429);

    // What the server knows, so the report holds the whole picture.
    const chat = (await db.query<ChatRow>("select id, transcript, state, updated_at from dream_sessions where user_id = $1 order by updated_at desc limit 1", [userId])).rows[0];
    const chatState = chat ? ((parse(chat.state) ?? {}) as { widgets?: Record<string, { kind?: string }> }) : null;
    const runs = (
      await db.query<RunRow>("select id, status, error, draft->>'title' as title, created_at, updated_at from agent_runs where user_id = $1 order by created_at desc limit 10", [userId])
    ).rows;
    const list = await listWishes(db, userId);

    let screen: Uint8Array | null = null;
    if (body.data.screenshot) {
      const bytes = Buffer.from(body.data.screenshot, "base64");
      if (bytes.length <= SCREEN_MAX_BYTES && isJpeg(bytes)) screen = bytes;
    }
    const id = randomUUID();
    const report = {
      id,
      at: now.toISOString(),
      user: userId,
      replay: body.data.replay ?? null,
      app: body.data.state,
      chat: chat
        ? {
            id: chat.id,
            updatedAt: chat.updated_at,
            transcript: parse(chat.transcript),
            widgets: Object.entries(chatState?.widgets ?? {}).map(([wid, w]) => ({ id: wid, kind: w.kind ?? null })),
          }
        : null,
      list,
      runs,
    };
    await db.query("insert into help_reports (id, user_id, report, has_screen, created_at) values ($1, $2, $3::jsonb, $4, $5)", [id, userId, JSON.stringify(report), !!screen, now.toISOString()]);
    const store = deps.media?.store;
    if (store?.putPrivate) {
      await store.putPrivate(`${id}/report.json`, new TextEncoder().encode(JSON.stringify(report, null, 1)), "application/json");
      if (screen) await store.putPrivate(`${id}/screen.jpg`, screen, "image/jpeg");
    }
    posthog?.capture({
      distinctId: userId,
      event: "help_requested",
      properties: { report_id: id, screen: !!screen, route: typeof body.data.state.route === "string" ? body.data.state.route : null, ...(body.data.replay ? { $session_id: body.data.replay } : {}) },
    });
    return c.json({ id, code: id.slice(0, 6).toUpperCase() }, 201);
  });

  return app;
}
