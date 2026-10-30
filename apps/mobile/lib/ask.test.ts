import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_IDLE_MS, ASK_SETTLE_MS, AskClock, answerAsk, askDone, joinAnd, pickedLine, reopenAsk, startAsk, timeUpAsk } from "./ask";

const STEPS = ["model", "trim", "colour", "interior", "options"];

describe("questions one at a time", () => {
  it("opens the first question without an answer; ones the Dandy already filled start folded", () => {
    const a = startAsk(STEPS, ["model"]);
    expect(a.open).toBe("trim");
    expect(a.by).toEqual({ model: "dandy" });
    expect(startAsk(STEPS, STEPS).open).toBeNull();
  });

  it("folds a tapped question and opens the next one without an answer", () => {
    let a = startAsk(STEPS, ["model", "colour"]);
    a = answerAsk(a, STEPS, "trim");
    expect(a.open).toBe("interior");
    expect(a.by.trim).toBe("you");
    a = answerAsk(a, STEPS, "interior");
    a = answerAsk(a, STEPS, "options");
    expect(askDone(a)).toBe(true);
  });

  it("opens a folded question again to change it, and comes back to one still waiting", () => {
    let a = answerAsk(startAsk(STEPS, ["model"]), STEPS, "trim");
    expect(a.open).toBe("colour");
    a = reopenAsk(a, "trim");
    expect(a.open).toBe("trim");
    // The colour was never answered, so changing the trim leads back to it.
    a = answerAsk(a, STEPS, "trim");
    expect(a.open).toBe("colour");
  });

  it("changing an answer once everything is answered finishes the run again", () => {
    let a = reopenAsk(startAsk(STEPS, STEPS), "colour");
    expect(askDone(a)).toBe(false);
    a = answerAsk(a, STEPS, "colour");
    expect(askDone(a)).toBe(true);
    expect(a.by.colour).toBe("you");
  });

  it("when time runs out the Dandy takes the open question and every later one without an answer", () => {
    const a = answerAsk(startAsk(STEPS, ["model"]), STEPS, "trim");
    const { ask, took } = timeUpAsk(a, STEPS);
    expect(took).toEqual(["colour", "interior", "options"]);
    expect(askDone(ask)).toBe(true);
    expect(ask.by).toEqual({ model: "dandy", trim: "you", colour: "dandy", interior: "dandy", options: "dandy" });
  });

  it("never claims an answer the person gave, even on a question they opened again", () => {
    let a = answerAsk(startAsk(STEPS, STEPS.filter((s) => s !== "trim")), STEPS, "trim");
    a = reopenAsk(a, "trim");
    const { ask, took } = timeUpAsk(a, STEPS);
    expect(took).toEqual([]);
    expect(ask.by.trim).toBe("you");
  });

  it("keeps the Dandy's own pick for a refine question left open", () => {
    const ids = ["bracelet", "condition"];
    const a = reopenAsk(startAsk(ids, ids), "bracelet");
    expect(timeUpAsk(a, ids).took).toEqual(["bracelet"]);
    expect(timeUpAsk(startAsk(ids, ids), ids).took).toEqual([]);
  });
});

describe("the Dandy's one line", () => {
  it("names what it went with, in plain words", () => {
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
    expect(pickedLine(["Base"])).toBe("I went with Base.");
    expect(pickedLine(["Base", " Obsidian  Black ", "base"])).toBe("I went with Base and Obsidian Black.");
  });

  it("stays short, and says nothing when it named nothing", () => {
    expect(pickedLine(["Modern", "Pool", "Sea view", "Garden", "Gym"])).toBe("I went with Modern, Pool, Sea view and 2 more.");
    expect(pickedLine([])).toBeNull();
    expect(pickedLine(["  "])).toBeNull();
  });
});

describe("the Dandy's clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function clock() {
    const due = vi.fn<(key: string) => void>();
    const windows: (number | null)[] = [];
    return { c: new AskClock(due, (ms) => windows.push(ms)), due, windows };
  }

  it("answers an untouched question once, after the long wait", () => {
    const { c, due } = clock();
    c.wait("trim");
    vi.advanceTimersByTime(ASK_IDLE_MS - 1);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(due).toHaveBeenCalledOnce();
    expect(due).toHaveBeenCalledWith("trim");
    vi.advanceTimersByTime(ASK_IDLE_MS * 3);
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("starts the wait again on every touch, so someone still looking keeps the question", () => {
    const { c, due } = clock();
    c.wait("colour");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(ASK_IDLE_MS - 1000);
      c.touch();
    }
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ASK_IDLE_MS);
    expect(due).toHaveBeenCalledOnce();
  });

  it("moves on soon after a pick on a question that takes several", () => {
    const { c, due, windows } = clock();
    c.wait("options");
    vi.advanceTimersByTime(5000);
    c.touch(true);
    expect(windows.at(-1)).toBe(ASK_SETTLE_MS);
    vi.advanceTimersByTime(ASK_SETTLE_MS);
    expect(due).toHaveBeenCalledOnce();
    expect(due).toHaveBeenCalledWith("options");
  });

  it("holds while a field has focus, the chat is away or a screen reader is on, then waits the full time again", () => {
    const { c, due, windows } = clock();
    c.wait("trim");
    vi.advanceTimersByTime(ASK_IDLE_MS - 1000);
    c.hold("typing", true);
    c.hold("page", true);
    expect(windows.at(-1)).toBeNull();
    vi.advanceTimersByTime(ASK_IDLE_MS * 5);
    c.hold("typing", false);
    vi.advanceTimersByTime(ASK_IDLE_MS * 5);
    expect(due).not.toHaveBeenCalled();
    c.hold("page", false);
    vi.advanceTimersByTime(ASK_IDLE_MS - 1);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(due).toHaveBeenCalledOnce();
  });

  it("follows the open question and stops when nothing is open", () => {
    const { c, due } = clock();
    c.wait("trim");
    vi.advanceTimersByTime(ASK_IDLE_MS - 10);
    c.wait("colour");
    vi.advanceTimersByTime(ASK_IDLE_MS - 10);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(due).toHaveBeenCalledOnce();
    expect(due).toHaveBeenCalledWith("colour");
    c.wait("interior");
    c.wait(null);
    c.touch();
    vi.advanceTimersByTime(ASK_IDLE_MS * 2);
    expect(due).toHaveBeenCalledOnce();
    expect(c.counting).toBeNull();
  });
});
