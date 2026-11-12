import { expect, it, vi } from "vitest";
import { sandboxBilling } from "../src/billing/sandbox";
const db = { query: vi.fn(), exec: vi.fn() };
it("does not parse credentials or create a transport while disabled", () => {
  expect(sandboxBilling({ NODE_ENV: "production", BILLING_SANDBOX_ENABLED: false, PLAY_SERVICE_ACCOUNT_JSON: "invalid-private-input" }, db)).toBeUndefined();
  expect(db.query).not.toHaveBeenCalled();
});
it("refuses production even if called outside readEnv", () => {
  expect(() => sandboxBilling({ NODE_ENV: "production", BILLING_SANDBOX_ENABLED: true }, db)).toThrow("development-only");
});
it("advertises Apple only until a deployment-owned Play credential is configured", () => {
  expect(sandboxBilling({ NODE_ENV: "staging", BILLING_SANDBOX_ENABLED: true }, db)).toMatchObject({ enabled: true, apple: true, google: false });
});
it("refuses malformed configured credentials rather than advertising Play readiness", () => {
  expect(() => sandboxBilling({ NODE_ENV: "staging", BILLING_SANDBOX_ENABLED: true, PLAY_SERVICE_ACCOUNT_JSON: "{}" }, db)).toThrow(/^Play identity unavailable$/);
});
