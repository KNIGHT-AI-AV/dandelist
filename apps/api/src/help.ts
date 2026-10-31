import { randomUUID } from "node:crypto";
import { HELP_LINE_MAX, HELP_LOG_KEEP, redactDiagnostic } from "@dandelist/catalogue";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AgentDeps } from "./agent/routes";
import { posthog } from "./analytics";
import { requireAuth, type AuthVars } from "./auth";
import type { MediaStore } from "./media-store";
import { listWishes } from "./wishes";

/**
 * POST /help: what someone sees when something looks wrong, in one tap (owner, 2026-10-31: "a help icon so that it
 * takes a direct state of everything on the application and loads it somewhere where you can and Codex can always
 * reach to see issues; however, that data needs to be protected ... if I see an issue, I can just press a button and
 * then immediately go to this chat and talk to you and you could literally see it with pictures").
 *
 * The app sends a fixed list of diagnostics and a picture of the screen; the server adds what it knows (the latest
 * conversation, the list, the last hunts) and keeps the report with the account (help_reports) and, with its picture,
 * in the private media bucket under help/<id>/, which /media never serves and the team reads with its own AWS access
 * (infra/aws/help.ts). The answer is a short code to quote. Only the person's own data goes in, only when they send it.
 *
 * Review of #140: the app's state is kept to the shared diagnostics list with credential-shaped text cut out; a day's
 * reports are counted in one statement; a report is pending until both private copies are stored, retried from the row
 * if an upload fails, and sending the same sheet again is the same report; deleting the account deletes the copies too.
 */

/** The request: the app's diagnostics as JSON and a JPEG of the screen in base64. */
export const HELP_MAX_BYTES = 3_000_000;
const SCREEN_MAX_BYTES = 2_000_000;
/** Reports one person can send in a UTC day. */
export const HELP_PER_DAY = 30;
/** A pending report's copies are stored by sweepHelp once it is this old, so a request still storing them isn't raced. */
export const HELP_RETRY_AFTER_MS = 60_000;

/** The only parts of the app's state a report keeps (packages/catalogue/src/help.ts); anything else is dropped. */
const diagnostics = z.object({
  route: z.string().max(300).optional(),
  platform: z.string().max(20).optional(),
  os: z.string().max(40).optional(),
  version: z.string().max(40).nullable().optional(),
  build: z.string().max(40).nullable().optional(),
  window: z.object({ width: z.number(), height: z.number(), scale: z.number(), fontScale: z.number() }).partial().optional(),
  at: z.string().max(40).optional(),
  logs: z.array(z.object({ at: z.string().max(40), level: z.enum(["error", "warn"]), text: z.string().max(HELP_LINE_MAX) })).max(HELP_LOG_KEEP).optional(),
});

const helpBody = z.object({
  /** The help sheet's own id: sending it again after a failure is the same report, never a second one. */
  key: z.string().uuid().optional(),
  state: diagnostics,
  screenshot: z.string().max(2_800_000).optional(),
  /** The PostHog session the report came from, so the replay is one click away. */
  replay: z.string().max(120).optional(),
});

type ChatRow = { id: string; transcript: unknown; state: unknown; updated_at: unknown };
type RunRow = { id: string; status: string; error: string | null; title: string | null; created_at: unknown; updated_at: unknown };
type HelpDeps = Pick<AgentDeps, "db" | "now" | "media">;
/** What a report's sender is told: its code, and whether its private copies are stored yet. */
export type HelpAnswer = { id: string; code: string; stored: "complete" | "pending" | "gone"; screen: boolean };

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const codeOf = (id: string) => id.slice(0, 6).toUpperCase();
const warn = (what: string, e: unknown) => console.warn(what, e instanceof Error ? e.message : e);

/** The app's diagnostics with credential-shaped text cut out of the route and every log line, again, on the server. */
function cleaned(state: z.infer<typeof diagnostics>) {
  return {
    ...state,
    // A route is a path: any query or fragment on it goes whole.
    ...(state.route === undefined ? {} : { route: redactDiagnostic(state.route.split(/[?#]/)[0]!) }),
    ...(state.logs ? { logs: state.logs.map((l) => ({ ...l, text: redactDiagnostic(l.text) })) } : {}),
  };
}

/**
 * Stores a report's private copies, picture first, so its report.json (what the team's reader lists) only appears once
 * both are in; then marks it complete and lets the row's picture go. A failed upload leaves it pending for a resend or
 * sweepHelp. Whatever the uploads did, a report whose account was deleted while they were on their way has every copy
 * that landed deleted again, queued until it has (review of #140: a picture can land after the deletion even when the
 * report copy behind it fails).
 */
async function finish(deps: HelpDeps, store: MediaStore, id: string): Promise<HelpAnswer> {
  const row = (await deps.db.query<{ report: unknown; status: string; screen: Uint8Array | null; has_screen: boolean }>("select report, status, screen, has_screen from help_reports where id = $1", [id])).rows[0];
  const answer = (stored: HelpAnswer["stored"]): HelpAnswer => ({ id, code: codeOf(id), stored, screen: row?.has_screen ?? false });
  if (!row) return answer("gone");
  if (row.status === "complete") return answer("complete");
  let uploaded = true;
  try {
    if (row.screen) await store.putPrivate(`${id}/screen.jpg`, new Uint8Array(row.screen), "image/jpeg");
    await store.putPrivate(`${id}/report.json`, new TextEncoder().encode(JSON.stringify(parse(row.report), null, 1)), "application/json");
  } catch (e) {
    warn(`help report ${id}: its private copies didn't all store`, e);
    uploaded = false;
  }
  // Checked after the uploads have settled, so no copy of this request's can land after it.
  if (uploaded) {
    const done = await deps.db.query("update help_reports set status = 'complete', screen = null where id = $1 returning id", [id]);
    if (done.rows.length) return answer("complete");
  } else if ((await deps.db.query("select 1 from help_reports where id = $1", [id])).rows.length) return answer("pending");
  await dropHelpCopies(deps, [id]);
  return answer("gone");
}

/**
 * Deletes reports' private copies (report.json first, so the team's reader stops listing a report before its picture
 * goes). One that fails stays queued in help_deletions for sweepHelp to retry. Returns how many went.
 */
export async function dropHelpCopies(deps: HelpDeps, ids: string[]): Promise<number> {
  const store = deps.media?.store;
  let gone = 0;
  for (const id of ids) {
    try {
      if (!store) throw new Error("no media store");
      await store.deletePrivate(`${id}/report.json`);
      await store.deletePrivate(`${id}/screen.jpg`);
      await deps.db.query("delete from help_deletions where id = $1", [id]);
      gone++;
    } catch (e) {
      warn(`help report ${id}: its private copies stay queued for deletion`, e);
      await deps.db.query("insert into help_deletions (id, attempts) values ($1, 1) on conflict (id) do update set attempts = help_deletions.attempts + 1", [id]);
    }
  }
  return gone;
}

/**
 * The help store's upkeep (server.ts runs it at start and every few minutes): deletes the private copies still queued
 * in help_deletions, and stores the copies of reports an upload failure left pending.
 */
export async function sweepHelp(deps: HelpDeps): Promise<{ deleted: number; stored: number }> {
  const store = deps.media?.store;
  if (!store) return { deleted: 0, stored: 0 };
  const queued = (await deps.db.query<{ id: string }>("select id from help_deletions order by queued_at limit 200")).rows.map((r) => r.id);
  const deleted = await dropHelpCopies(deps, queued);
  const before = new Date(deps.now().getTime() - HELP_RETRY_AFTER_MS).toISOString();
  const pending = (await deps.db.query<{ id: string }>("select id from help_reports where status = 'pending' and created_at < $1 order by created_at limit 50", [before])).rows;
  let stored = 0;
  for (const { id } of pending) if ((await finish(deps, store, id)).stored === "complete") stored++;
  return { deleted, stored };
}

export function helpRoutes(deps: AgentDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  app.use("*", requireAuth(deps));

  app.post("/", bodyLimit({ maxSize: HELP_MAX_BYTES, onError: (c) => c.json({ error: "That's too much to send in one report." }, 413) }), async (c) => {
    const body = helpBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "That report couldn't be read." }, 400);
    const store = deps.media?.store;
    // Without the private store a report would be kept nowhere the team reads: say so instead of claiming it was sent.
    if (!store) return c.json({ error: "Something went wrong." }, 503);
    const userId = c.get("userId");
    const now = deps.now();
    const key = body.data.key?.toLowerCase();

    // The same sheet sent again (its answer was lost, or its copies didn't store): the same report, not a second one.
    const resend = async (id: string) => {
      const known = (await db.query<{ user_id: string }>("select user_id from help_reports where id = $1", [id])).rows[0];
      if (!known) return null;
      if (known.user_id !== userId) return c.json({ error: "That report couldn't be read." }, 400);
      return c.json(await finish(deps, store, id), 200);
    };
    if (key) {
      const again = await resend(key);
      if (again) return again;
    }

    // One more report today, counted in one statement: two sent at once can't both take the day's last one.
    const day = now.toISOString().slice(0, 10);
    const slot = await db.query("insert into help_quota (user_id, day, sent) values ($1, $2, 1) on conflict (user_id, day) do update set sent = help_quota.sent + 1 where help_quota.sent < $3 returning sent", [userId, day, HELP_PER_DAY]);
    if (!slot.rows.length) return c.json({ error: "That's a lot of reports for one day. Try again tomorrow." }, 429);

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
    const id = key ?? randomUUID();
    const report = {
      id,
      at: now.toISOString(),
      user: userId,
      replay: body.data.replay ?? null,
      screen: !!screen,
      app: cleaned(body.data.state),
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
    const made = await db.query("insert into help_reports (id, user_id, report, status, screen, has_screen, created_at) values ($1, $2, $3::jsonb, 'pending', $4, $5, $6) on conflict (id) do nothing returning id", [
      id,
      userId,
      JSON.stringify(report),
      screen ? Buffer.from(screen) : null,
      !!screen,
      now.toISOString(),
    ]);
    if (!made.rows.length) {
      // The same sheet arrived twice at once: this copy gives its day's slot back and answers as the first.
      await db.query("update help_quota set sent = sent - 1 where user_id = $1 and day = $2", [userId, day]);
      return (await resend(id)) ?? c.json({ error: "That report couldn't be read." }, 400);
    }
    posthog?.capture({
      distinctId: userId,
      event: "help_requested",
      properties: { report_id: id, screen: !!screen, route: report.app.route ?? null, ...(body.data.replay ? { $session_id: body.data.replay } : {}) },
    });
    const answer = await finish(deps, store, id);
    return c.json(answer, answer.stored === "pending" ? 202 : 201);
  });

  return app;
}
