import { expect, it } from "vitest";
import { readEnv } from "../src/env";
const fixture = { DATABASE_URL: "postgres://fixture.invalid/local-only", JWT_SECRET: "fixture-secret-at-least-32-characters", CODE_PEPPER: "fixture-pepper-at-least-16-characters", RESEND_API_KEY: "fixture-never-sent" };
it("billing transport remains absent by default, including production", () => {
  expect(readEnv(fixture).BILLING_SANDBOX_ENABLED).toBe(false);
  expect(readEnv({ ...fixture, NODE_ENV: "production" }).BILLING_SANDBOX_ENABLED).toBe(false);
});
it.each(["1", "true", "on", "yes"])("production refuses sandbox opt-in before opening the database (%s)", flag => {
  expect(() => readEnv({ ...fixture, NODE_ENV: "production", BILLING_SANDBOX_ENABLED: flag })).toThrow("development-only");
});
it("only explicit development opt-in mounts the sandbox transport", () => {
  expect(readEnv({ ...fixture, BILLING_SANDBOX_ENABLED: "1" }).BILLING_SANDBOX_ENABLED).toBe(true);
  expect(readEnv({ ...fixture, BILLING_SANDBOX_ENABLED: "0" }).BILLING_SANDBOX_ENABLED).toBe(false);
});
