import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireAuth, type AuthDeps, type AuthVars } from "../auth";
import type { Entitlement, EntitlementService } from "../entitlements";

export interface BillingRoutesOptions {
  enabled: boolean;
  service: EntitlementService;
  apple: boolean;
  google: boolean;
}
const appleBody = z.object({ signedTransaction: z.string().min(1).max(500_000) }).strict();
const googleBody = z.object({ purchaseToken: z.string().min(1).max(16_000) }).strict();
const trialBody = z.object({ platform: z.enum(["web", "android"]) }).strict();
function view(entitlement: Entitlement) {
  const expiresAt = entitlement.expires_at ? new Date(entitlement.expires_at).toISOString() : null;
  return { state: entitlement.state, expiresAt, hasPremiumEntitlement: ["trialing", "active", "grace"].includes(entitlement.state) };
}

/** This transport never accepts consent, calls AI, or changes entitlement checks on existing product routes. */
export function billingRoutes(auth: Pick<AuthDeps, "db" | "jwtSecret" | "now">, options: BillingRoutesOptions) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", async (c, next) => {
    if (!options.enabled) return c.json({ error: "Not found." }, 404);
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("*", requireAuth(auth));
  app.use("*", bodyLimit({ maxSize: 510_000, onError: c => c.json({ error: "Purchase payload too large." }, 413) }));
  app.get("/", async c => {
    try { return c.json({ access: view(await options.service.read(c.get("userId"))), stores: { ios: options.apple, android: options.google } }); }
    catch { return c.json({ error: "Entitlement service unavailable." }, 503); }
  });
  app.post("/trial", async c => {
    const parsed = trialBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid trial request." }, 400);
    try { return c.json({ access: view(await options.service.startTrial(c.get("userId"), parsed.data.platform)) }); }
    catch { return c.json({ error: "Trial activation unavailable." }, 503); }
  });
  app.post("/apple", async c => {
    if (!options.apple) return c.json({ error: "Store verification unavailable." }, 503);
    const parsed = appleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid purchase request." }, 400);
    try {
      const userId = c.get("userId");
      await options.service.linkAppleTransaction(userId, parsed.data.signedTransaction);
      return c.json({ verified: true, userId, access: view(await options.service.read(userId)) });
    } catch { return c.json({ error: "Purchase could not be verified." }, 422); }
  });
  app.post("/google", async c => {
    if (!options.google) return c.json({ error: "Store verification unavailable." }, 503);
    const parsed = googleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid purchase request." }, 400);
    try {
      const userId = c.get("userId");
      await options.service.linkGooglePurchase(userId, parsed.data.purchaseToken);
      return c.json({ verified: true, userId, access: view(await options.service.read(userId)) });
    } catch { return c.json({ error: "Purchase could not be verified." }, 422); }
  });
  return app;
}
