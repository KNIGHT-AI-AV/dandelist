import { describe, expect, it } from "vitest";
import type { WishQuestion } from "./agent";
import { answerOf, answersFrom, refineChanged, withGiven } from "./refine";

const bracelet: WishQuestion = { id: "bracelet", label: "Which bracelet?", options: ["Oyster", "President"], picked: "Oyster" };
const condition: WishQuestion = { id: "condition", label: "New or pre-owned?", options: ["New", "Pre-owned"], picked: "Pre-owned", answered: true };

describe("refining a hunt", () => {
  it("shows the hunt's own answer until the person changes it", () => {
    expect(answerOf(bracelet, {})).toBe("Oyster");
    expect(answerOf(bracelet, { bracelet: "Jubilee" })).toBe("Jubilee");
  });

  it("counts a change only when it says something new", () => {
    expect(refineChanged([bracelet], {})).toBe(false);
    expect(refineChanged([bracelet], { bracelet: "Oyster" })).toBe(false);
    expect(refineChanged([bracelet], { bracelet: "   " })).toBe(false);
    expect(refineChanged([bracelet], { bracelet: " Jubilee " })).toBe(true);
  });

  it("sends the person's answers by question id, never the agent's own picks", () => {
    expect(answersFrom([bracelet, condition], { bracelet: " Jubilee " })).toEqual([
      { question: "bracelet", answer: "Jubilee" },
      { question: "condition", answer: "Pre-owned" },
    ]);
    expect(answersFrom([bracelet], {})).toEqual([]);
  });

  it("keeps the answers on the draft's questions for a retry", () => {
    expect(withGiven([bracelet, condition], [{ question: "bracelet", answer: "Jubilee" }])).toEqual([{ ...bracelet, picked: "Jubilee", answered: true }, condition]);
  });
});
