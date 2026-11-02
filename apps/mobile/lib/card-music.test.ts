import { describe, expect, it } from "vitest";
import { cardMusic } from "./card-music";

// Owner, 2026-11-02: "Music shouldn't ding or stop until the image itself is found".
describe("the music while a card is made", () => {
  it("plays while the price is being found", () => {
    expect(cardMusic({ priced: false, needsPhoto: true, photo: false, looking: true })).toBe("waiting");
  });

  it("keeps playing once the price lands, until the checked photo is in", () => {
    expect(cardMusic({ priced: true, needsPhoto: true, photo: false, looking: true })).toBe("waiting");
  });

  it("lands, with the chime, the moment the photo is in", () => {
    expect(cardMusic({ priced: true, needsPhoto: true, photo: true, looking: true })).toBe("landed");
    expect(cardMusic({ priced: true, needsPhoto: true, photo: true, looking: false })).toBe("landed");
  });

  it("stops quietly, with no chime, when the hunt ends with no photo", () => {
    expect(cardMusic({ priced: true, needsPhoto: true, photo: false, looking: false })).toBe("idle");
  });

  it("lands an amount or infinity as it is priced: those cards need no photo", () => {
    expect(cardMusic({ priced: true, needsPhoto: false, photo: false, looking: true })).toBe("landed");
  });

  it("is quiet when nothing is being looked for", () => {
    expect(cardMusic({ priced: false, needsPhoto: true, photo: false, looking: false })).toBe("idle");
  });
});
