import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { migrate, openDb } from "./db";
import { readEnv } from "./env";
import { consoleMailer, resendMailer } from "./mailer";
import { s3MediaStore } from "./media-store";

const env = readEnv();
const db = await openDb(env.DATABASE_URL);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

for (const [name, id, secret] of [
  ["Google", env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
  ["GitHub", env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
] as const) {
  if (!!id !== !!secret) console.warn(`${name} sign-in needs both its client id and its client secret; it stays off`);
}

const app = createApp({
  db,
  mailer: env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : consoleMailer(),
  jwtSecret: env.JWT_SECRET,
  codePepper: env.CODE_PEPPER,
  judge: env.JUDGE_EMAIL && env.JUDGE_CODE ? { email: env.JUDGE_EMAIL, code: env.JUDGE_CODE } : undefined,
  now: () => new Date(),
  meta: env.MODEL_API_KEY ? { apiKey: env.MODEL_API_KEY } : undefined,
  spendCaps: { dailyUsd: env.SPEND_DAILY_USD, totalUsd: env.SPEND_TOTAL_USD },
  apify: env.APIFY_TOKEN ? { token: env.APIFY_TOKEN, dailyUsd: env.APIFY_DAILY_USD } : undefined,
  media: {
    store: env.MEDIA_BUCKET && env.PUBLIC_API_URL ? await s3MediaStore(env.MEDIA_BUCKET, env.AWS_REGION, env.PUBLIC_API_URL) : undefined,
    cutouts: env.MEDIA_CUTOUTS,
    generate: env.MEDIA_GENERATE,
    upscale: env.MEDIA_UPSCALE,
    cutoutsPerDay: env.MEDIA_CUTOUTS_PER_DAY,
    imagesPerDay: env.MEDIA_IMAGES_PER_DAY,
  },
  webOrigins: env.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  oauth: {
    apiUrl: env.PUBLIC_API_URL,
    production: env.NODE_ENV === "production",
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : undefined,
    apple: { servicesId: env.APPLE_SERVICES_ID, bundleId: env.APPLE_BUNDLE_ID || undefined },
  },
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`dandelist api listening on ${info.port}`));
