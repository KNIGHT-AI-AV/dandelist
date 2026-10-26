import { z } from "zod";

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
});

export type Env = z.infer<typeof schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = schema.parse(source);
  if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required in production; sign-in codes would never arrive");
  }
  return env;
}
