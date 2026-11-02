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

  it("greets an empty list without claiming they were here before, or that nothing is coming (a guest's kept wish joins it next)", () => {
    expect(welcomeLines([])).toEqual({
      title: "Welcome",
      line: "Your Dandelist starts here.",
    });
  });

  it("says nothing about a list it couldn't read, so a slow or failed load never calls a full list empty", () => {
    expect(welcomeLines(null)).toEqual({ title: "Welcome", line: null });
  });

  it("stands the first wish with a checked photo behind the glass, and none when no wish has one", () => {
    expect(heroWish([wish("A week in Lisbon"), wish("Leica Q3", "https://upload.wikimedia.org/leica.jpg"), wish("Rolex", "https://x/rolex.jpg")])?.name).toBe(
      "Leica Q3",
    );
    expect(heroWish([wish("A week in Lisbon")])).toBeNull();
    expect(heroWish([])).toBeNull();
  });
});
