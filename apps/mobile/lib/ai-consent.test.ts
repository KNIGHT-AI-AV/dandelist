import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CONSENT_VERSION, aiConsent, giveAiConsent, loadAiConsent, resetAiConsentForTests } from "./ai-consent";

const local = vi.hoisted(() => new Map<string, string>());
vi.mock("./storage", () => ({
  getSecret: async (key: string) => local.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => { if (value === null) local.delete(key); else local.set(key, value); },
}));

beforeEach(() => {
  local.clear();
  resetAiConsentForTests();
});

describe("permission to send to the AI services", () => {
  it("is unknown until the device is read, then no on a fresh device", async () => {
    expect(aiConsent()).toBeNull();
    await loadAiConsent();
    expect(aiConsent()).toBe(false);
  });

  it("is kept on the device once given, for the next launch", async () => {
    await loadAiConsent();
    await giveAiConsent();
    expect(aiConsent()).toBe(true);
    resetAiConsentForTests();
    await loadAiConsent();
    expect(aiConsent()).toBe(true);
  });

  it("asks again when what is asked changes (an older answer is not a yes)", async () => {
    local.set("dandelist.ai-consent", String(Number(AI_CONSENT_VERSION) - 1));
    await loadAiConsent();
    expect(aiConsent()).toBe(false);
  });

  it("keeps a yes given while the device is still being read", async () => {
    const read = loadAiConsent();
    await giveAiConsent();
    await read;
    expect(aiConsent()).toBe(true);
  });
});
