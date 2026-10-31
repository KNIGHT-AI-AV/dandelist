import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { agentRoutes, type AgentDeps } from "./agent/routes";
import { Alive } from "./alive";
import { serverError } from "./analytics";
import { authRoutes, requireAuth, type AuthVars } from "./auth";
import { dreamRoutes } from "./dream/routes";
import { fxRoutes } from "./fx";
import { guestRoutes } from "./guest";
import { helpRoutes } from "./help";
import { pairRoutes } from "./pairs";
import { poolSource, typicalSource } from "./pool";
import { previewRoutes } from "./preview";
import { isStoredKey } from "./media-store";
import { agentKeyRoutes, mcpRoutes } from "./mcp";
import { meRoutes } from "./me";
import { pickRoutes } from "./picks";
import { wishRoutes } from "./wishes";

export interface AppDeps extends AgentDeps {
  webOrigins: string[];
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  // Work that outlives its request keeps the instance awake through one request to itself (alive.ts).
  const alive = deps.alive ?? new Alive({ origin: deps.oauth?.apiUrl });
  deps = { ...deps, alive };
  const { db } = deps;

  app.use("*", cors({ origin: deps.webOrigins, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));

  // An error no route handled: logged as before, and sent to PostHog error tracking with where it happened.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    serverError(err, (c.get("userId") as string | undefined) ?? null, { path: c.req.path, method: c.req.method });
    return c.json({ error: "Something went wrong." }, 500);
  });
  app.use("*", async (c, next) => {
    alive.noteOrigin(new URL(c.req.url).origin);
    await next();
  });
  app.get("/internal/hold", async (c) => c.body(null, await alive.wait(c.req.header("x-hold"))));

  app.get("/healthz", async (c) => {
    await db.query("select 1");
    return c.json({ ok: true });
  });

  // Pictures the agent made (SAM cutouts, Muse Image). Public like any image link: names are the sha256 of the bytes.
  app.get("/media/:key", async (c) => {
    const key = c.req.param("key");
    const store = deps.media?.store;
    if (!store || !isStoredKey(key)) return c.json({ error: "Not found." }, 404);
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
  // Today's pick: one suggestion a day, made when the list opens (picks.ts).
  app.route("/picks", pickRoutes(deps));
  app.route("/agent", agentRoutes(deps));
  // The pre-login pool (catalogue plus archive subjects with photos), shared by the preview and the guest routes.
  const pool = poolSource(db, deps.now);
  // Archive subjects with a typical price, photographed or not: this or that prices the things it names from them.
  const typicals = typicalSource(db, deps.now);
  app.route("/preview", previewRoutes({ ...deps, pool }));
  app.route("/guest", guestRoutes({ ...deps, pool, typicals }));
  // This or that from a signed-in person's list and notes (pairs.ts), for the app's own this or that.
  app.route("/pairs", pairRoutes({ ...deps, pool, typicals }));
  app.route("/", dreamRoutes(deps));
  // Agents: keys a person makes in Settings, and the MCP server those keys open, one account per key.
  app.route("/me/agent-keys", agentKeyRoutes(deps));
  app.route("/mcp", mcpRoutes({ ...deps, call: (path, init) => app.request(path, init) }));
  app.route("/me", meRoutes(deps));
  // What someone saw when they asked for help, kept private for the team (help.ts).
  app.route("/help", helpRoutes(deps));

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
    // Their profile photo goes too. Avatar keys belong to one person, and the store deletes nothing else.
    if (avatar && deps.media?.store) await deps.media.store.delete(avatar).catch((e: unknown) => console.warn("could not delete a profile photo", e instanceof Error ? e.message : e));
    return c.body(null, 204);
  });

  return app;
}
