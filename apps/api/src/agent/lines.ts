import type { Step } from "./agent";

/**
 * One short line per step for the app's single working row, which it rewrites in place while the agent hunts
 * (owner, 2026-10-29: tell me what it's working on, in one place, without spamming the chat). Our code writes these
 * from the step itself; only a thought carries the model's own words, already cleaned to one plain line.
 */

const LINE_MAX = 64;

const site = (raw: string) => {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
};

/** One line, at most `max` characters, cut at a word with plain dots (the app's text is plain: dream/agent.ts tidy). */
export function clip(s: string, max = LINE_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).replace(/\s+\S*$/, "")}...` : t;
}

export function lineFor(step: Step): string {
  switch (step.type) {
    case "search":
      return clip(`Searching for ${step.query}`);
    case "open":
      return step.ok ? `Reading ${site(step.url)}` : `Couldn't open ${site(step.url)}, moving on`;
    case "fx":
      return `Converting ${step.from} to ${step.to}`;
    case "check":
      return step.verified ? `Price confirmed on ${site(step.url)}` : step.listed ? "Price confirmed in a shop listing" : `Checking the price on ${site(step.url)}`;
    case "price":
      return clip(`Priced ${step.label}`);
    case "explain":
      return "Weighing the options";
    case "note":
      return clip(step.text);
  }
}

/** The step with its line, unless it already carries one. */
export const withLine = <S extends Step>(step: S): S => (step.line ? step : { ...step, line: lineFor(step) });
