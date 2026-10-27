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
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`dandelist api listening on ${info.port}`));
