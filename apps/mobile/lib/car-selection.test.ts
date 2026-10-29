import type { Widget } from "@dandelist/catalogue/dream";
import { describe, expect, it } from "vitest";
import { carSelectionSummary, carSelectionValues, commitCarDrafts, initialCarSelection, removeCarOwn } from "./car-selection";

const widget: Extract<Widget, { kind: "car_builder" }> = {
  kind: "car_builder", id: "car", currency: "USD", steps: [
    { id: "model", title: "Model", choices: [{ id: "g63", label: "G 63" }], selected: "g63" },
    { id: "trim", title: "Trim", choices: [{ id: "base", label: "Base", priceCents: 18655000 }], selected: "base" },
    { id: "colour", title: "Colour", choices: [{ id: "black", label: "Black", priceCents: 0 }], selected: "black" },
    { id: "interior", title: "Interior", choices: [] },
    { id: "options", title: "Options", choices: [{ id: "night", label: "Night Package", priceCents: 130000 }], selected: "night" },
  ],
};

describe("car builder typed choices", () => {
  it("flushes open fields for either action, preserving offered options and empty sections", () => {
    const result = commitCarDrafts(widget, initialCarSelection(widget), { colour: "Mint green", interior: "Cream leather", options: "Armoured glass" });
    expect(carSelectionValues(result)).toEqual({ selections: { model: ["g63"], trim: ["base"], colour: [], interior: [], options: ["night"] }, own: { model: [], trim: [], colour: ["Mint green"], interior: ["Cream leather"], options: ["Armoured glass"] } });
    expect(carSelectionSummary(widget, result)).toEqual({ subtotal: 18785000, unpriced: ["Colour: Mint green", "Interior: Cream leather", "Options: Armoured glass"] });
  });

  it("replaces a single custom answer and selects an offered answer by typed name", () => {
    const first = commitCarDrafts(widget, initialCarSelection(widget), { colour: "Mint green" });
    const next = commitCarDrafts(widget, first, { colour: "Gold" });
    expect(next.own.colour).toEqual(["Gold"]);
    const known = commitCarDrafts(widget, next, { colour: " BLACK " });
    expect(known.own.colour).toEqual([]);
    expect(known.picked.colour).toEqual(["black"]);
    expect(carSelectionSummary(widget, known).unpriced).toEqual([]);
  });

  it("restores custom chips and sends explicit empty arrays after removal", () => {
    const restored = { ...widget, steps: [...widget.steps.filter((s) => s.id !== "colour"), { id: "colour", title: "Colour", choices: [{ id: "own:mint", label: "Mint green", custom: true }], selected: "own:mint" }] };
    const state = initialCarSelection(restored);
    expect(state.own.colour).toEqual(["Mint green"]);
    const removed = { ...state, own: { ...state.own, colour: [] } };
    const wire = JSON.parse(JSON.stringify(carSelectionValues(removed)));
    expect(wire.own.colour).toEqual([]);
    expect(wire.selections.colour).toEqual([]);
  });

  it("invalidates old component prices for a custom model, including included zero amounts", () => {
    const changed = commitCarDrafts(widget, initialCarSelection(widget), { model: "Bentley Bentayga" });
    expect(carSelectionSummary(widget, changed)).toEqual({ subtotal: 0, unpriced: ["Model: Bentley Bentayga"] });
    expect(changed.picked.trim).toEqual([]);
    const oldOptionPickedAgain = { ...changed, picked: { ...changed.picked, options: ["night"] } };
    expect(carSelectionSummary(widget, oldOptionPickedAgain)).toEqual({ subtotal: 0, unpriced: ["Model: Bentley Bentayga", "Options: Night Package"] });
    const removed = removeCarOwn(widget, oldOptionPickedAgain, "model", "Bentley Bentayga");
    expect(removed.picked.options).toEqual([]);
    expect(removed.picked.model).toEqual([]);
    expect(carSelectionSummary(widget, removed).subtotal).toBe(0);
  });
});
