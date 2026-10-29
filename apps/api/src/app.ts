import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentRoutes, type AgentDeps } from "./agent/routes";
import { authRoutes, requireAuth, type AuthVars } from "./auth";
import { dreamRoutes } from "./dream/routes";
import { fxRoutes } from "./fx";
import { guestRoutes } from "./guest";
import { poolSource } from "./pool";
import { previewRoutes } from "./preview";
import { MEDIA_KEY } from "./media-store";
import { meRoutes } from "./me";
import { wishRoutes } from "./wishes";

export interface AppDeps extends AgentDeps {
  webOrigins: string[];
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;

  app.use("*", cors({ origin: deps.webOrigins, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));

  app.get("/healthz", async (c) => {
    await db.query("select 1");
    return c.json({ ok: true });
  });

  // Pictures the agent made (SAM cutouts, Muse Image). Public like any image link: names are the sha256 of the bytes.
  app.get("/media/:key", async (c) => {
    const key = c.req.param("key");
    const store = deps.media?.store;
    if (!store || !MEDIA_KEY.test(key)) return c.json({ error: "Not found." }, 404);
    const obj = await store.get(key);
    if (!obj) return c.json({ error: "Not found." }, 404);
    return c.body(obj.bytes as never, 200, {
      "Content-Type": obj.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  app.route("/fx", fxRoutes(deps));
  app.route("/auth", authRoutes(deps));
  app.route("/wishes", wishRoutes(deps));
  app.route("/agent", agentRoutes(deps));
  // The pre-login pool (catalogue plus archive subjects with photos), shared by the preview and the guest routes.
  const pool = poolSource(db, deps.now);
  app.route("/preview", previewRoutes({ ...deps, pool }));
  app.route("/guest", guestRoutes({ ...deps, pool }));
  app.route("/", dreamRoutes(deps));
  app.route("/me", meRoutes(deps));

  app.use("/me", requireAuth(deps));
  app.get("/me", async (c) => {
    const user = (await db.query<{ id: string; email: string; created_at: string }>("select id, email, created_at from users where id = $1", [c.get("userId")])).rows[0];
    if (!user) return c.json({ error: "Sign in again to continue." }, 401);
    return c.json({ user });
  });

  // Account deletion is required by the App Store; everything the user owns goes with the row.
  app.delete("/me", async (c) => {
    const avatar = (await db.query<{ avatar_key: string | null }>("select avatar_key from users where id = $1", [c.get("userId")])).rows[0]?.avatar_key;
    await db.query("delete from users where id = $1", [c.get("userId")]);
    // Their profile photo goes too, unless someone else uses the very same picture (keys are the bytes' sha256).
    if (avatar && deps.media?.store?.delete) {
      const shared = (await db.query<{ n: number }>("select count(*)::int as n from users where avatar_key = $1", [avatar])).rows[0];
      if (!Number(shared?.n ?? 0)) await deps.media.store.delete(avatar).catch((e: unknown) => console.warn("could not delete a profile photo", e instanceof Error ? e.message : e));
    }
    return c.body(null, 204);
  });

  return app;
}
