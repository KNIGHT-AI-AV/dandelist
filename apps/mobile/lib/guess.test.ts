import { describe, expect, it } from "vitest";
import type { WishCandidate } from "./agent";
import { guessCandidates, guessOthers } from "./guess";

const pictured = (name: string, model: string, url?: string): WishCandidate => ({ name, make: "Porsche", model, variant: "", ...(url ? { image: { url, source: "commons.wikimedia.org" } } : {}) });

describe("a vague wish's candidates as photos (owner, 2026-10-30: pick which one they meant)", () => {
  it("shows only candidates with a photo, and only when two or more have one", () => {
    const draft = { title: "Porsche 911", candidates: [pictured("Porsche 911", "911", "https://x/911.jpg"), pictured("Porsche Cayenne", "Cayenne"), pictured("Porsche Taycan", "Taycan", "https://x/taycan.jpg")] };
    expect(guessCandidates(draft)).toEqual({ candidates: [draft.candidates[0], draft.candidates[2]], current: 0 });
    expect(guessCandidates({ ...draft, candidates: draft.candidates.slice(0, 2) })).toBeNull();
    expect(guessCandidates({ title: "Porsche 911" })).toBeNull();
    expect(guessCandidates(null)).toBeNull();
  });

  it("marks the one being hunted by the wish's title or bare name, and none when neither is among them", () => {
    const candidates = [pictured("Porsche Taycan", "Taycan", "https://x/t.jpg"), pictured("Porsche 911", "911", "https://x/9.jpg")];
    expect(guessCandidates({ title: "Porsche 911 in pink", name: " porsche 911 ", candidates })?.current).toBe(1);
    expect(guessCandidates({ title: "Porsche Macan", candidates })?.current).toBe(-1);
  });

  it("never shows a name twice, five at most", () => {
    const many = ["911", "Taycan", "Cayenne", "Macan", "Panamera", "718"].map((m) => pictured(`Porsche ${m}`, m, `https://x/${m}.jpg`));
    expect(guessCandidates({ title: "Porsche 911", candidates: [...many.slice(0, 2), { ...many[0]!, name: "PORSCHE 911" }, ...many.slice(2)] })?.candidates.map((c) => c.model)).toEqual(["911", "Taycan", "Cayenne", "Macan", "Panamera"]);
  });
});

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
