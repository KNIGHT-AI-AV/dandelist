import { describe, expect, it } from "vitest";
import { guessOthers } from "./guess";

describe("a best guess (owner, 2026-10-30: the cats that look like little lions)", () => {
  it("offers the other likely names only when the reading wasn't sure", () => {
    expect(guessOthers({ title: "Maine Coon kitten", sure: true, others: ["Siberian kitten"] })).toBeNull();
    expect(guessOthers({ title: "Maine Coon kitten" })).toBeNull();
    expect(guessOthers(null)).toBeNull();
    expect(guessOthers({ title: "Maine Coon kitten", sure: false })).toEqual([]);
  });

  it("never offers the wish's own name back or a name twice, three at most", () => {
    expect(guessOthers({ title: "Maine Coon kitten", sure: false, others: [" maine coon kitten ", "Norwegian Forest kitten", "Siberian kitten", "Norwegian forest kitten", "", "Ragdoll kitten", "Lykoi"] })).toEqual([
      "Norwegian Forest kitten",
      "Siberian kitten",
      "Ragdoll kitten",
    ]);
  });
});
