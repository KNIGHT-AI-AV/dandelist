import { z } from "zod";

/** An optional setting where an empty value counts as unset. */
const optional = z.string().trim().optional().transform((v) => v || undefined);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CODE_PEPPER: z.string().min(16, "CODE_PEPPER must be at least 16 characters"),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Dandelist <signin@knightaiav.com>"),
  JUDGE_EMAIL: z.string().email().optional(),
  JUDGE_CODE: z.string().regex(/^\d{6}$/).optional(),
  MODEL_API_KEY: z.string().optional(),
  SPEND_DAILY_USD: z.coerce.number().positive().default(10),
  SPEND_TOTAL_USD: z.coerce.number().positive().default(120),
  WEB_ORIGINS: z.string().default("https://dandelist.com,https://www.dandelist.com,http://localhost:8081"),
  PORT: z.coerce.number().int().default(8080),
  NODE_ENV: z.string().default("development"),
  // Where this API is reachable from the internet; social sign-in providers return here.
  PUBLIC_API_URL: z.string().url().optional(),
  // Social sign-in. Each provider stays hidden and off until its settings are present.
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  // Apple on the web and Android (a Services ID). Native iOS checks Apple's tokens against the app's bundle id;
  // set APPLE_BUNDLE_ID to an empty value to turn that off.
  APPLE_SERVICES_ID: optional,
  APPLE_BUNDLE_ID: z.string().trim().default("com.knightaiav.dandelist"),
});

export type Env = z.infer<typeof schema> & { PUBLIC_API_URL: string };

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = schema.parse(source);
  const production = env.NODE_ENV === "production";
  if (production && !env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required in production; sign-in codes would never arrive");
  }
  const publicUrl = env.PUBLIC_API_URL ?? (production ? "https://api.dandelist.knightaiav.com" : `http://localhost:${env.PORT}`);
  return { ...env, PUBLIC_API_URL: publicUrl.replace(/\/+$/, "") };
}
