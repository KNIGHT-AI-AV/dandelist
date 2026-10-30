import type { Widget } from "@dandelist/catalogue/dream";
import { describe, expect, it } from "vitest";
import { autoPickCar, carSelectionSummary, carSelectionValues, carStepLabels, commitCarDrafts, initialCarSelection, pickCarChoice, removeCarOwn } from "./car-selection";

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

/** A build with nothing picked past the model: what the Dandy chooses when nobody answers. */
const open: Extract<Widget, { kind: "car_builder" }> = {
  kind: "car_builder", id: "car_2", currency: "USD", steps: [
    { id: "model", title: "Model", choices: [{ id: "g", label: "G-Class" }], selected: "g" },
    { id: "trim", title: "Trim", choices: [{ id: "amg", label: "AMG G 63", priceCents: 18655000 }, { id: "g550", label: "G 550", priceCents: 14800000 }] },
    { id: "colour", title: "Colour", choices: [{ id: "red", label: "Hyacinth Red", priceCents: 75000 }, { id: "black", label: "Obsidian Black", priceCents: 0 }] },
    { id: "interior", title: "Interior", choices: [] },
    { id: "options", title: "Options", choices: [{ id: "night", label: "Night Package", priceCents: 130000 }] },
  ],
};

describe("car builder one tap at a time", () => {
  it("a tap replaces a single step's pick and toggles an option", () => {
    let x = pickCarChoice(open, initialCarSelection(open), "trim", "amg");
    x = pickCarChoice(open, x, "trim", "g550");
    expect(x.picked.trim).toEqual(["g550"]);
    x = pickCarChoice(open, x, "options", "night");
    expect(x.picked.options).toEqual(["night"]);
    expect(pickCarChoice(open, x, "options", "night").picked.options).toEqual([]);
  });

  it("a tapped card drops a typed answer for the same step", () => {
    const typed = commitCarDrafts(open, initialCarSelection(open), { colour: "Mint green" });
    const x = pickCarChoice(open, typed, "colour", "black");
    expect(carStepLabels(open, x, "colour")).toEqual(["Obsidian Black"]);
  });

  it("when time runs out the Dandy picks the lowest price for single steps and adds no options", () => {
    const { selection, labels } = autoPickCar(open, initialCarSelection(open), ["trim", "colour", "interior", "options"]);
    expect(selection.picked.trim).toEqual(["g550"]);
    // An included colour comes before a paid one.
    expect(selection.picked.colour).toEqual(["black"]);
    expect(selection.picked.options).toEqual([]);
    expect(labels).toEqual(["G 550", "Obsidian Black"]);
    expect(carSelectionValues(selection).selections).toMatchObject({ model: ["g"], trim: ["g550"], colour: ["black"], interior: [], options: [] });
  });

  it("keeps what is already picked or typed, and names it", () => {
    const typed = commitCarDrafts(open, pickCarChoice(open, initialCarSelection(open), "trim", "amg"), { colour: "Mint green" });
    const { selection, labels } = autoPickCar(open, typed, ["trim", "colour"]);
    expect(selection.picked.trim).toEqual(["amg"]);
    expect(selection.own.colour).toEqual(["Mint green"]);
    expect(selection.picked.colour).toEqual([]);
    expect(labels).toEqual(["AMG G 63", "Mint green"]);
  });
});
