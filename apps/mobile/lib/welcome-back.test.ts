import { describe, expect, it } from "vitest";
import { heroWish, welcomeLines } from "./welcome-back";

const wish = (name: string, imageUrl?: string) => ({
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

  it("says what comes next before a first wish, without claiming they were here before", () => {
    expect(welcomeLines([])).toEqual({
      title: "Welcome",
      line: "Let's find the first thing you want.",
    });
  });

  it("stands the first wish with a checked photo behind the glass, and none when no wish has one", () => {
    expect(heroWish([wish("A week in Lisbon"), wish("Leica Q3", "https://upload.wikimedia.org/leica.jpg"), wish("Rolex", "https://x/rolex.jpg")])?.name).toBe(
      "Leica Q3",
    );
    expect(heroWish([wish("A week in Lisbon")])).toBeNull();
    expect(heroWish([])).toBeNull();
  });
});
