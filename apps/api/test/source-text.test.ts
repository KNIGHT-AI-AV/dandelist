import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MUST_SAY } from "../src/dream/agent";

/** Every .ts file under a directory. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("the API's source text", () => {
  // A script that edits source through an escaping language can write "\b" as a backspace byte: the must-say test in
  // dream/agent.ts held four of them and could never match (found 2026-11-03).
  it("holds no control characters other than tab and line ends", () => {
    const bad = files(join(__dirname, "../src")).filter((f) => /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("the concierge's must-say test", () => {
  it("matches the tool outputs that tell the concierge to speak", () => {
    expect(MUST_SAY.test('Not hunted again, already on a card above in this conversation: "a Leica Q3". Say so.')).toBe(true);
    expect(MUST_SAY.test("Not run: this message has used its tool budget.")).toBe(true);
    expect(MUST_SAY.test("Made Austin Luxury House the wish.")).toBe(false);
  });
});
