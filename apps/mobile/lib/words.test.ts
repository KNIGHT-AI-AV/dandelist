import { describe, expect, it } from "vitest";
import { midSentence } from "./words";

describe("wish names in sentences", () => {
  it("lowers a leading article so a name reads mid-sentence", () => {
    expect(midSentence("A month in Lisbon")).toBe("a month in Lisbon");
    expect(midSentence("An evening at Noma")).toBe("an evening at Noma");
    expect(midSentence("The Amalfi coast for a week")).toBe("the Amalfi coast for a week");
  });

  it("leaves proper names and words that merely start with A alone", () => {
    expect(midSentence("Leica Q3")).toBe("Leica Q3");
    expect(midSentence("Amanzoe for two")).toBe("Amanzoe for two");
    expect(midSentence("Apple Vision Pro")).toBe("Apple Vision Pro");
  });
});
