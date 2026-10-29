import type { Widget } from "@dandelist/catalogue/dream";
import { addOwn } from "./own";

type CarWidget = Extract<Widget, { kind: "car_builder" }>;
export type CarSelection = { picked: Record<string, string[]>; own: Record<string, string[]> };

export function initialCarSelection(w: CarWidget): CarSelection {
  const picked: CarSelection["picked"] = {};
  const own: CarSelection["own"] = {};
  for (const step of w.steps) {
    const selected = new Set(step.selected?.split(",") ?? []);
    picked[step.id] = step.choices.filter((c) => selected.has(c.id) && !c.custom).map((c) => c.id);
    own[step.id] = step.choices.filter((c) => selected.has(c.id) && c.custom).map((c) => c.label);
  }
  return { picked, own };
}

/** Flush open fields on both actions, so a tap never silently discards what was typed. */
export function commitCarDrafts(w: CarWidget, selection: CarSelection, drafts: Record<string, string | null>): CarSelection {
  const picked = { ...selection.picked };
  const own = { ...selection.own };
  for (const step of w.steps) {
    const text = drafts[step.id]?.trim();
    if (!text) continue;
    const multi = step.id === "options";
    const result = addOwn(text, step.choices.filter((c) => !c.custom), multi ? own[step.id] ?? [] : []);
    if (result.pick) {
      picked[step.id] = multi ? [...new Set([...(picked[step.id] ?? []), result.pick])] : [result.pick];
      if (!multi) own[step.id] = [];
    } else {
      own[step.id] = result.own;
      if (!multi && result.own.length) picked[step.id] = [];
    }
  }
  if (own.model?.[0] !== selection.own.model?.[0] || picked.model?.[0] !== selection.picked.model?.[0]) {
    for (const step of w.steps) if (step.id !== "model") picked[step.id] = [];
  }
  return { picked, own };
}

export function carSelectionValues(selection: CarSelection) {
  return { selections: selection.picked, own: selection.own };
}

export function removeCarOwn(w: CarWidget, selection: CarSelection, step: string, label: string): CarSelection {
  const own = { ...selection.own, [step]: (selection.own[step] ?? []).filter((entry) => entry !== label) };
  const picked = { ...selection.picked };
  if (step === "model") for (const section of w.steps) if (section.id !== "model") picked[section.id] = [];
  return { picked, own };
}

/** Known component prices do not apply to a different model. Missing amounts are never zero-priced parts. */
export function carSelectionSummary(w: CarWidget, selection: CarSelection) {
  const changedModel = !!selection.own.model?.length;
  let subtotal = 0;
  const unpriced: string[] = [];
  for (const step of w.steps) {
    for (const label of selection.own[step.id] ?? []) unpriced.push(`${step.title}: ${label}`);
    for (const id of selection.picked[step.id] ?? []) {
      const c = step.choices.find((choice) => choice.id === id);
      if (!c || step.id === "model") continue;
      if (changedModel || c.priceCents === undefined) unpriced.push(`${step.title}: ${c.label}`);
      else subtotal += c.priceCents;
    }
  }
  return { subtotal, unpriced };
}
