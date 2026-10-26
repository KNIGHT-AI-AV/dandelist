import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { migrate, openDb } from "./db";
import { readEnv } from "./env";
import { consoleMailer, resendMailer } from "./mailer";

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
  webOrigins: env.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`dandelist api listening on ${info.port}`));
