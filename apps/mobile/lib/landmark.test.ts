import { describe, expect, it, vi } from "vitest";

/** A screen's main landmark: on the web a role, on the phones nothing (a role there replaces a view's own traits). */
const h = vi.hoisted(() => ({ os: "web" }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));

async function mainOn(os: string) {
  h.os = os;
  vi.resetModules();
  return (await import("./landmark")).MAIN;
}

describe("a screen's main landmark", () => {
  it("is the main role on the web", async () => {
    expect(await mainOn("web")).toEqual({ role: "main" });
  });

  it("is nothing on iOS and Android", async () => {
    expect(await mainOn("ios")).toBeNull();
    expect(await mainOn("android")).toBeNull();
  });
});
