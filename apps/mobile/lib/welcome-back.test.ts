import { describe, expect, it, vi } from "vitest";
import { LAST_HERO_KEY, LAST_READ_MS, heroWish, readLast, welcomeLines } from "./welcome-back";

const wish = (name: string, imageUrl?: string) => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  details: imageUrl ? { agent: { imageUrl } } : {},
});

describe("the welcome back", () => {
  it("greets a returning list by what it holds, in the owner's words (their list, not their life)", () => {
    expect(welcomeLines([wish("Leica Q3"), wish("A week in Lisbon")])).toEqual({
      title: "Welcome back",
      line: "Your Dandelist so far · 2 wishes",
    });
    expect(welcomeLines([wish("Leica Q3")]).line).toBe("Your Dandelist so far · 1 wish");
  });

  it("greets an empty list without claiming they were here before, or that nothing is coming (a guest's kept wish joins it next)", () => {
    expect(welcomeLines([])).toEqual({
      title: "Welcome",
      line: "Your Dandelist starts here.",
    });
  });

  it("says nothing about a list it couldn't read, so a slow or failed load never calls a full list empty", () => {
    expect(welcomeLines(null)).toEqual({ title: "Welcome", line: null });
  });

  // Owner, 2026-11-02: "one of their items randomly changing every time".
  const list = [wish("A week in Lisbon"), wish("Leica Q3", "https://upload.wikimedia.org/leica.jpg"), wish("Rolex", "https://x/rolex.jpg"), wish("Riva", "https://x/riva.jpg")];

  it("stands a random one of the wishes with a checked photo behind the glass, never one without", () => {
    expect(heroWish(list, null, () => 0)?.name).toBe("Leica Q3");
    expect(heroWish(list, null, () => 0.5)?.name).toBe("Rolex");
    expect(heroWish(list, null, () => 0.999)?.name).toBe("Riva");
    const seen = new Set(Array.from({ length: 60 }, (_, i) => heroWish(list, null, () => i / 60)?.name));
    expect([...seen].sort()).toEqual(["Leica Q3", "Riva", "Rolex"]);
  });

  it("changes from the one shown last time whenever there is another to show", () => {
    for (const [last, name] of [["leica-q3", "Leica Q3"], ["rolex", "Rolex"], ["riva", "Riva"]] as const) {
      for (let i = 0; i < 30; i++) expect(heroWish(list, last, () => i / 30)?.name).not.toBe(name);
    }
    expect(heroWish([wish("Leica Q3", "https://upload.wikimedia.org/leica.jpg")], "leica-q3", () => 0.4)?.name).toBe("Leica Q3");
  });

  it("shows no photo when no wish has one", () => {
    expect(heroWish([wish("A week in Lisbon")], null, () => 0)).toBeNull();
    expect(heroWish([], "rolex", () => 0)).toBeNull();
  });

  // Mac Team Attack, 11-02: an app without the keychain entitlement (an ad-hoc Simulator build) refuses SecureStore.
  it("reads which wish it showed last time, and takes a refusing or silent keychain as none", async () => {
    expect(await readLast(async (k) => (k === LAST_HERO_KEY ? "rolex" : null))).toBe("rolex");
    expect(await readLast(async () => null)).toBeNull();
    expect(await readLast(() => Promise.reject(new Error("-34018 missing entitlement")))).toBeNull();
    expect(
      await readLast(() => {
        throw new Error("SecureStore unavailable");
      }),
    ).toBeNull();
    vi.useFakeTimers();
    try {
      const silent = readLast(() => new Promise<string | null>(() => {}));
      vi.advanceTimersByTime(LAST_READ_MS);
      expect(await silent).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
