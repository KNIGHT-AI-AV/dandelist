import { z } from "zod";

/** On only when set to 1, true, on or yes. */
const flag = z
  .string()
  .optional()
  .transform((v) => /^(1|true|on|yes)$/i.test(v ?? ""));

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
  // Google Shopping through Apify's free plan ($5 of credit a month). The daily cap keeps cash spend at $0.
  APIFY_TOKEN: z.string().optional(),
  APIFY_DAILY_USD: z.coerce.number().positive().default(0.15),
  // Agent-made pictures are stored in the media bucket and served at PUBLIC_API_URL/media/<key>.
  MEDIA_BUCKET: z.string().optional(),
  PUBLIC_API_URL: z.string().url().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  MEDIA_CUTOUTS: flag,
  MEDIA_GENERATE: flag,
  MEDIA_UPSCALE: flag,
  MEDIA_CUTOUTS_PER_DAY: z.coerce.number().int().min(0).default(100),
  MEDIA_IMAGES_PER_DAY: z.coerce.number().int().min(0).default(20),
  WEB_ORIGINS: z.string().default("https://dandelist.com,https://www.dandelist.com,http://localhost:8081"),
  PORT: z.coerce.number().int().default(8080),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = schema.parse(source);
  if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required in production; sign-in codes would never arrive");
  }
  return env;
}
