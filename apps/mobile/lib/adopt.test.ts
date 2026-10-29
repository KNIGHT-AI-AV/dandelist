import { describe, expect, it } from "vitest";
import { adoptionDone, adoptionKeys, alreadyHas, withoutAdopted } from "./adopt";

const priced = { wish: { option: { url: "https://www.rolex.com/sub" } }, items: [{ id: "porsche-911" }, { id: "leica-q3" }] };

describe("adopting the kept list (Codex R01)", () => {
  it("keys each wish to its place in the kept list, the priced first wish first", () => {
    expect(adoptionKeys(priced)).toEqual(["wish", "porsche-911", "leica-q3"]);
    expect(adoptionKeys({ wish: {}, items: [{ id: "leica-q3" }] })).toEqual(["leica-q3"]);
  });

  it("takes off only the wish the server now has, keeping the rest for next time", () => {
    const afterFirst = withoutAdopted(priced, "wish");
    expect(afterFirst).toEqual({ wish: null, items: priced.items });
    const afterPick = withoutAdopted(afterFirst, "porsche-911");
    expect(afterPick.items).toEqual([{ id: "leica-q3" }]);
    expect(adoptionDone(afterPick)).toBe(false);
    expect(adoptionDone(withoutAdopted(afterPick, "leica-q3"))).toBe(true);
  });

  it("keeps an unpriced first wish until the Dandy has priced it", () => {
    const unpriced = { wish: {}, items: [] };
    expect(adoptionKeys(unpriced)).toEqual([]);
    expect(adoptionDone(unpriced)).toBe(false);
  });

  it("never writes a wish twice when its first write landed but the answer was lost", () => {
    const have = [{ name: "Rolex Submariner Date", details: { agent: { url: "https://www.rolex.com/sub" } } }] as never[];
    expect(alreadyHas(have, { name: "Rolex Submariner Date", details: { agent: { url: "https://www.rolex.com/sub" } } } as never)).toBe(true);
    expect(alreadyHas(have, { name: "Rolex Submariner Date", details: { agent: { url: "https://www.chrono.example/sub" } } } as never)).toBe(false);
    expect(alreadyHas(have, { name: "Leica Q3" } as never)).toBe(false);
  });
});
