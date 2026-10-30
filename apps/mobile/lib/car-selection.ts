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

/** Options take several picks; every other step takes one. */
export const multiStep = (step: string) => step === "options";

/** A tap on a choice: it replaces the step's pick (options toggle instead), and a new model clears every other step. */
export function pickCarChoice(w: CarWidget, x: CarSelection, step: string, id: string): CarSelection {
  const now = x.picked[step] ?? [];
  const picked = { ...x.picked, [step]: multiStep(step) ? (now.includes(id) ? now.filter((c) => c !== id) : [...now, id]) : [id] };
  if (step === "model" && (x.own.model?.length || now[0] !== id)) for (const s of w.steps) if (s.id !== "model") picked[s.id] = [];
  return { picked, own: multiStep(step) ? x.own : { ...x.own, [step]: [] } };
}

/** What a step holds now, offered choices first, then typed ones, by label. */
export function carStepLabels(w: CarWidget, x: CarSelection, step: string): string[] {
  const s = w.steps.find((st) => st.id === step);
  const offered = (x.picked[step] ?? []).map((id) => s?.choices.find((c) => c.id === id)?.label).filter((l): l is string => !!l);
  return [...offered, ...(x.own[step] ?? [])];
}

/**
 * The Dandy's own picks when time runs out, for the steps it takes: a step with a pick keeps it; one that takes a
 * single choice and has none gets the one at the lowest listed price, so an included colour comes before a paid one;
 * options stay as they are. Returns the selection and the labels it went with, for its one line.
 */
export function autoPickCar(w: CarWidget, x: CarSelection, steps: readonly string[]): { selection: CarSelection; labels: string[] } {
  const picked = { ...x.picked };
  const labels: string[] = [];
  for (const id of steps) {
    const step = w.steps.find((s) => s.id === id);
    if (!step) continue;
    const held = carStepLabels(w, { picked, own: x.own }, id);
    if (held.length || multiStep(id)) {
      labels.push(...held);
      continue;
    }
    const offered = step.choices.filter((c) => !c.custom);
    if (!offered.length) continue;
    const best = offered.reduce((a, c) => ((c.priceCents ?? Infinity) < (a.priceCents ?? Infinity) ? c : a));
    picked[id] = [best.id];
    labels.push(best.label);
  }
  return { selection: { picked, own: x.own }, labels };
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
