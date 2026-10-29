import { describe, expect, it } from "vitest";
import { applyCarValues, buildReady, buildTotal, carBuildCriteria, carWidget } from "../src/dream/builders";
import type { CarBuildState } from "../src/dream/types";

const build = (): CarBuildState => ({
  id: "car", make: "Mercedes-Benz", model: "G 63", sourceUrl: "https://example.com/config", sourceCurrency: "USD", rate: 0.92, checkedAt: "2026-10-29",
  steps: [
    { id: "model", title: "Model", multi: false, choices: [{ id: "g63", label: "G 63", verified: true }], selected: ["g63"] },
    { id: "trim", title: "Trim", multi: false, choices: [{ id: "base", label: "Base", price: 186550, verified: true }], selected: ["base"] },
    { id: "colour", title: "Colour", multi: false, choices: [{ id: "black", label: "Black", price: 0, verified: true }], selected: ["black"] },
    { id: "interior", title: "Interior", multi: false, choices: [], selected: [] },
    { id: "options", title: "Options", multi: true, choices: [{ id: "night", label: "Night Package", price: 1300, verified: true }], selected: [] },
  ],
});

describe("custom car selections and incomplete prices", () => {
  it("keeps multiple typed parts alongside priced options, without trusting client prices", () => {
    const b = build();
    applyCarValues(b, { selections: { options: ["night", "night"] }, own: { options: ["Armoured glass", "armoured glass", { label: "fake", price: 0 }], interior: "Cream leather" }, price: 1, verified: true });
    expect(buildTotal(b)).toMatchObject({ total: 187850, verified: false, unpriced: ["Interior: Cream leather", "Options: Armoured glass"] });
    expect(buildTotal(b).parts).toContain("Armoured glass");
    const widget = carWidget(b, "EUR");
    expect(widget.knownSubtotalCents).toBe(Math.round(187850 * 0.92 * 100));
    expect(widget.steps.find((s) => s.id === "options")?.choices.find((c) => c.custom)).toMatchObject({ label: "Armoured glass", detail: "Not priced" });
    expect(widget.steps.find((s) => s.id === "options")?.choices.find((c) => c.custom)?.priceCents).toBeUndefined();
  });

  it("restores exactly through session JSON and lets custom choices be removed", () => {
    const b = build();
    applyCarValues(b, { own: { options: ["Tow pack, reinforced"], colour: "Mint green" } });
    const restored = JSON.parse(JSON.stringify(b)) as CarBuildState;
    expect(buildTotal(restored)).toEqual(buildTotal(b));
    expect(carWidget(restored, "EUR").steps.find((s) => s.id === "options")?.selected?.split(",")).toHaveLength(1);
    applyCarValues(restored, { selections: { colour: "black" }, own: { options: [], colour: [] } });
    expect(buildTotal(restored)).toMatchObject({ total: 186550, verified: true, unpriced: [] });
  });

  it("matches a typed known label and keeps included zero-price choices verified", () => {
    const b = build();
    applyCarValues(b, { own: { colour: " BLACK ", options: ["night package"] } });
    expect(buildTotal(b)).toMatchObject({ total: 187850, verified: true, unpriced: [] });
    expect(b.steps.flatMap((s) => s.choices).some((c) => c.custom)).toBe(false);
  });

  it("does not reuse the old model's prices for a custom model or pretend a custom trim is priced", () => {
    const b = build();
    b.imageUrl = "https://example.com/g63.jpg";
    applyCarValues(b, { own: { model: "Bentley Bentayga" } });
    expect(carWidget(b, "USD").steps.find((s) => s.id === "model")?.choices.find((c) => c.custom)?.imageUrl).toBeUndefined();
    expect(buildTotal(b).total).toBe(0);
    expect(buildTotal(b).unpriced).toEqual(["Model: Bentley Bentayga"]);
    expect(b.steps.find((s) => s.id === "trim")?.selected).toEqual([]);
    expect(carBuildCriteria(b, "EUR")).toMatchObject({ make: "", model: "Bentley Bentayga" });
    expect(carBuildCriteria(b, "EUR").notes).not.toContain("Trim: Base");
    applyCarValues(b, { selections: { model: [] }, own: { model: [] } });
    expect(buildReady(b)).toBe(false);
    const other = build();
    applyCarValues(other, { own: { trim: "Special edition" } });
    expect(buildReady(other)).toBe(true);
    expect(buildTotal(other)).toMatchObject({ total: 0, verified: false, unpriced: ["Trim: Special edition"] });
  });

  it("forwards every selected custom preference into search", () => {
    const b = build();
    applyCarValues(b, { own: { colour: "Mint green", interior: ["Cream leather"], options: ["Armoured glass", "Tow pack"] } });
    const c = carBuildCriteria(b, "EUR");
    expect(c.colour).toBe("Mint green");
    expect(c.notes).toContain("Interior: Cream leather");
    expect(c.notes).toContain("Options: Armoured glass; Options: Tow pack");
  });

  it("bounds custom strings and counts, and ignores unknown sections and forged choice IDs", () => {
    const b = build();
    applyCarValues(b, { selections: { colour: "not-a-choice" }, own: { options: Array.from({ length: 50 }, (_, i) => `${i} ${"x".repeat(100)}`), arbitrary: ["ignored"] } });
    const options = b.steps.find((s) => s.id === "options")!;
    expect(options.selected).toHaveLength(6);
    expect(options.choices.filter((c) => c.custom).every((c) => c.label.length <= 40 && c.price === undefined && !c.verified)).toBe(true);
    expect(buildTotal(b).parts).not.toContain("ignored");
  });

  it("accepts bounded Unicode without throwing or splitting a choice on punctuation", () => {
    const b = build();
    expect(() => applyCarValues(b, { own: { options: ["A".repeat(39) + "\uD83D\uDE80", "Tow pack, reinforced"] } })).not.toThrow();
    expect(b.steps.flatMap((s) => s.choices).every((c) => !/\p{Cs}/u.test(c.label))).toBe(true);
    expect(carWidget(b, "USD").steps.find((s) => s.id === "options")?.selected?.split(",")).toHaveLength(2);
  });
});
