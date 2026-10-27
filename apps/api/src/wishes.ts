import { Hono } from "hono";
import { z } from "zod";
import { mediaSchema } from "./agent/media";
import { requireAuth, type AuthDeps, type AuthVars } from "./auth";

/** A wish's source and image links are opened and shown by the app, so only http(s) addresses are stored. */
export function webLinksOnly(details: Record<string, unknown>): boolean {
  const agent = details.agent as { url?: unknown; imageUrl?: unknown } | undefined;
  if (!agent) return true;
  return [agent.url, agent.imageUrl].every((u) => u === undefined || u === "" || (typeof u === "string" && /^https?:\/\//i.test(u) && URL.canParse(u)));
}

export const MAX_WISHES_PER_USER = 500;
const MAX_CENTS = 1_000_000_000_000; // ten billion dollars; anything bigger is a typo

const recurring = z
  .array(
    z.object({
      amountCents: z.number().int().min(0).max(MAX_CENTS),
      period: z.enum(["week", "month", "year"]),
      label: z.string().trim().max(60).optional(),
    }),
  )
  .max(10);

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["buy", "own", "do", "visit"]),
  tier: z.enum(["must", "nice", "dream"]).default("nice"),
  upfrontCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  recurring: recurring.default([]),
  resaleCents: z.number().int().min(0).max(MAX_CENTS).nullable().optional(),
  // What the agent found: chosen price option, sources, explanation. Kept small so a row stays cheap to read.
  details: z
    .record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 20_000, "Too much detail.")
    .refine(webLinksOnly, "Links must be web addresses.")
    // Saved media is shown in image views and a 3D player, so only web images and Sketchfab embeds get in.
    .refine((d) => {
      const media = (d.agent as { media?: unknown } | undefined)?.media;
      return media === undefined || mediaSchema.safeParse(media).success;
    }, "Check the pictures.")
    .optional(),
});

const patchBody = createBody.partial().refine((b) => Object.keys(b).length > 0, "Nothing to change.");
const idParam = z.string().uuid();

type Row = {
  id: string;
  name: string;
  kind: string;
  tier: string;
  upfront_cents: string | number;
  recurring: unknown;
  resale_cents: string | number | null;
  details: unknown;
  image_key: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const COLUMNS = "id, name, kind, tier, upfront_cents, recurring, resale_cents, details, image_key, created_at, updated_at";

export function toWish(r: Row) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    upfrontCents: Number(r.upfront_cents),
    recurring: (typeof r.recurring === "string" ? JSON.parse(r.recurring) : r.recurring) as z.infer<typeof recurring>,
    resaleCents: r.resale_cents === null ? null : Number(r.resale_cents),
    details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
    imageKey: r.image_key,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Every query is scoped to the signed-in user, so one person can never read or change another's wishes. */
export function wishRoutes(deps: AuthDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  app.use("*", requireAuth(deps));

  app.get("/", async (c) => {
    const { rows } = await db.query<Row>(`select ${COLUMNS} from wishes where user_id = $1 order by created_at desc`, [c.get("userId")]);
    return c.json({ wishes: rows.map(toWish) });
  });

  app.post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Check the wish: it needs a name, a type and amounts in whole cents." }, 400);
    const userId = c.get("userId");
    const count = await db.query<{ n: string | number }>("select count(*) as n from wishes where user_id = $1", [userId]);
    if (Number(count.rows[0]?.n ?? 0) >= MAX_WISHES_PER_USER) return c.json({ error: `You can keep up to ${MAX_WISHES_PER_USER} wishes.` }, 409);
    const w = parsed.data;
    const now = deps.now().toISOString();
    const { rows } = await db.query<Row>(
      `insert into wishes (user_id, name, kind, tier, upfront_cents, recurring, resale_cents, details, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $9) returning ${COLUMNS}`,
      [userId, w.name, w.kind, w.tier, w.upfrontCents, JSON.stringify(w.recurring), w.resaleCents ?? null, JSON.stringify(w.details ?? {}), now],
    );
    return c.json({ wish: toWish(rows[0]!) }, 201);
  });

  app.patch("/:id", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !parsed.success) return c.json({ error: "Check the changes and try again." }, 400);
    const p = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown, cast = "") => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if (p.name !== undefined) set("name", p.name);
    if (p.kind !== undefined) set("kind", p.kind);
    if (p.tier !== undefined) set("tier", p.tier);
    if (p.upfrontCents !== undefined) set("upfront_cents", p.upfrontCents);
    if (p.recurring !== undefined) set("recurring", JSON.stringify(p.recurring), "::jsonb");
    if (p.resaleCents !== undefined) set("resale_cents", p.resaleCents);
    if (p.details !== undefined) set("details", JSON.stringify(p.details), "::jsonb");
    set("updated_at", deps.now().toISOString());
    vals.push(id.data, c.get("userId"));
    const { rows } = await db.query<Row>(
      `update wishes set ${sets.join(", ")} where id = $${vals.length - 1} and user_id = $${vals.length} returning ${COLUMNS}`,
      vals,
    );
    if (!rows[0]) return c.json({ error: "That wish wasn't found." }, 404);
    return c.json({ wish: toWish(rows[0]) });
  });

  app.delete("/:id", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That wish wasn't found." }, 404);
    const { rows } = await db.query("delete from wishes where id = $1 and user_id = $2 returning id", [id.data, c.get("userId")]);
    if (!rows[0]) return c.json({ error: "That wish wasn't found." }, 404);
    return c.body(null, 204);
  });

  return app;
}
