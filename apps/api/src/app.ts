import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentRoutes, type AgentDeps } from "./agent/routes";
import { authRoutes, requireAuth, type AuthVars } from "./auth";
import { wishRoutes } from "./wishes";

export interface AppDeps extends AgentDeps {
  webOrigins: string[];
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;

  app.use("*", cors({ origin: deps.webOrigins, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PATCH", "DELETE"] }));

  app.get("/healthz", async (c) => {
    await db.query("select 1");
    return c.json({ ok: true });
  });

  app.route("/auth", authRoutes(deps));
  app.route("/wishes", wishRoutes(deps));
  app.route("/agent", agentRoutes(deps));

  app.use("/me", requireAuth(deps));
  app.get("/me", async (c) => {
    const user = (await db.query<{ id: string; email: string; created_at: string }>("select id, email, created_at from users where id = $1", [c.get("userId")])).rows[0];
    if (!user) return c.json({ error: "Sign in again to continue." }, 401);
    return c.json({ user });
  });

  // Account deletion is required by the App Store; everything the user owns goes with the row.
  app.delete("/me", async (c) => {
    await db.query("delete from users where id = $1", [c.get("userId")]);
    return c.body(null, 204);
  });

  return app;
}
