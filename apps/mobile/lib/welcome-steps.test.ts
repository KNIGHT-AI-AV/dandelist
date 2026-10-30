import { describe, expect, it, vi } from "vitest";
import { keepsHunt, type FirstWish } from "./welcome";
import { welcomeSteps, type Fade } from "./welcome-steps";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({ getSecret: async () => null, setSecret: async () => {} }));

/**
 * The welcome as the browser showed it breaking (2026-10-30, iPhone size, a stand-in API): each case below is a
 * sequence that froze the flow, swallowed a tap or put back the wrong count before the fix.
 */
type S = { kind: string; n?: number };
type Snap = { answered: number; items: string[] };
const title: S = { kind: "title" };
const ask: S = { kind: "ask" };
const made: S = { kind: "made" };
const one: S = { kind: "vote", n: 1 };
const two: S = { kind: "vote", n: 2 };
const three: S = { kind: "vote", n: 3 };
const theme: S = { kind: "theme" };
const name = (s: S) => (s.n ? `${s.kind} ${s.n}` : s.kind);

/** A stage that behaves like Animated: starting a fade stops the one running, whose `done` then never comes. */
function stage() {
  let running: { to: 0 | 1; done: () => void } | null = null;
  const fade: Fade = (to, done) => {
    running = { to, done };
  };
  const end = () => {
    const r = running;
    running = null;
    r?.done();
  };
  return {
    fade,
    /** The fade under way runs to its end. */
    end,
    /** Every fade runs to its end, as when nobody touches anything for a couple of seconds. */
    settle: () => {
      while (running) end();
    },
    fading: () => running?.to ?? null,
  };
}

function welcome() {
  const st = stage();
  const shown: string[] = [];
  const tally: Snap = { answered: 0, items: [] };
  const steps = welcomeSteps<S, Snap>({
    fade: st.fade,
    show: (s) => shown.push(name(s)),
    capture: () => ({ answered: tally.answered, items: [...tally.items] }),
    keepsHistory: (s) => s.kind !== "title" && s.kind !== "theme",
  });
  /** Moves forward from `from` and lets the fade finish. */
  const forward = (from: S, to: S) => {
    expect(steps.leave(from)?.to(to)).toBe(true);
    st.settle();
  };
  return { st, shown, tally, steps, forward };
}

describe("the welcome's steps", () => {
  it("moves on from a pair voted on while it is still fading up (it used to freeze on that pair for good)", () => {
    const { st, shown, steps, forward } = welcome();
    steps.start(made);
    expect(steps.leave(made)?.to(one)).toBe(true);
    st.end(); // the card has faded out and the first pair is fading up
    expect(st.fading()).toBe(1);
    expect(steps.leave(one)?.to(two)).toBe(true); // "Neither", at once
    st.settle();
    expect(steps.at).toBe(two);
    forward(two, three);
    expect(shown).toEqual(["made", "vote 1", "vote 2", "vote 3"]);
  });

  it("goes to the card when the wish is sent again at once after Back (the tap used to be dropped)", () => {
    const { st, shown, steps, forward } = welcome();
    steps.start(ask);
    forward(ask, made);
    expect(steps.back()?.step).toBe(ask);
    st.end(); // the wish is back on screen, still fading up, its words still in the field
    expect(st.fading()).toBe(1);
    expect(steps.leave(ask)?.to(made)).toBe(true);
    st.settle();
    expect(steps.at).toBe(made);
    expect(shown).toEqual(["ask", "made", "ask", "made"]);
  });

  it("goes back exactly one step per Back, however quickly the taps come (one used to be lost and the next skipped a pair)", () => {
    const { st, shown, steps, forward } = welcome();
    steps.start(ask);
    forward(ask, made);
    forward(made, one);
    forward(one, two);
    expect(steps.leave(two)?.to(three)).toBe(true); // "Both": its price lands and the next pair starts to come
    expect(steps.back()?.step).toBe(two); // Back, inside that fade
    expect(steps.back()?.step).toBe(one); // and again, before anything settled
    st.settle();
    expect(steps.at).toBe(one);
    expect(shown).toEqual(["ask", "made", "vote 1", "vote 2", "vote 1"]);
    expect(steps.back()?.step).toBe(made);
    expect(steps.back()?.step).toBe(ask);
    expect(steps.back()).toBeNull();
    expect(steps.canGoBack()).toBe(false);
  });

  it("puts back what a pair had before its own vote, though the move comes once the price has flown (pair 1 came back as 2 of 3)", () => {
    const { st, steps, tally, forward } = welcome();
    steps.start(made);
    forward(made, one);
    const vote = steps.leave(one)!;
    tally.answered = 1; // the vote counts, and its pick goes on the list, before the next pair is asked for
    tally.items.push("leica-q3");
    expect(vote.to(two)).toBe(true);
    st.settle();
    expect(steps.back()).toEqual({ step: one, snap: { answered: 0, items: [] } });
  });

  it("ignores a tap on a step that is fading out, so a double tap can't send the wish or vote twice", () => {
    const { steps } = welcome();
    steps.start(ask);
    const send = steps.leave(ask)!;
    expect(send.to(made)).toBe(true);
    expect(steps.leave(ask)).toBeNull();
    expect(send.to(one)).toBe(false);
    expect(steps.at).toBe(made);
  });

  it("drops a vote whose price lands after Back: it moves nowhere", () => {
    const { st, steps, forward } = welcome();
    steps.start(made);
    forward(made, one);
    forward(one, two);
    const vote = steps.leave(two)!;
    steps.back(); // while the price is still in the air
    expect(vote.still()).toBe(false);
    expect(vote.to(three)).toBe(false);
    st.settle();
    expect(steps.at).toBe(one);
  });

  it("has no Back on the title or the theme, and starting over clears it", () => {
    const { st, steps, forward } = welcome();
    steps.start(title);
    expect(steps.canGoBack()).toBe(false);
    forward(title, ask);
    expect(steps.canGoBack()).toBe(false); // the title is not a step to go back to
    forward(ask, made);
    expect(steps.canGoBack()).toBe(true);
    expect(steps.reset(made, ask)).toBe(true);
    st.settle();
    expect(steps.canGoBack()).toBe(false);
    forward(ask, made);
    forward(made, theme);
    expect(steps.canGoBack()).toBe(false);
    expect(steps.back()).toBeNull();
  });
});

describe("sending the first wish again", () => {
  const priced: FirstWish = {
    text: "leica m11",
    title: "Leica M11",
    kind: "buy",
    option: { label: "Leica M11", seller: "Leica", url: "https://leica-camera.com/m11", upfrontCents: 899_500, recurring: [], status: "verified", statusLabel: "Checked on leica-camera.com", checkedAt: "2026-10-30T07:00:00Z", source: { currency: "USD", price: 8995, rate: 1, rateDate: "2026-10-30" } },
  };

  it("keeps the card, or the hunt still finding it, for the same words", () => {
    expect(keepsHunt(priced, "leica m11", false)).toBe(true);
    expect(keepsHunt({ text: "leica m11", title: "Leica M11" }, "leica m11", true)).toBe(true);
    expect(keepsHunt({ text: "love", worth: "priceless", line: "Free to give." }, "love", false)).toBe(true);
  });

  it("hunts afresh for new words, after a hunt that failed or stopped, and when there is no wish yet", () => {
    expect(keepsHunt(priced, "leica q3", false)).toBe(false);
    expect(keepsHunt({ text: "a unicorn", failed: "Couldn't find a price for that just now." }, "a unicorn", false)).toBe(false);
    expect(keepsHunt({ text: "leica m11" }, "leica m11", false)).toBe(false);
    expect(keepsHunt(null, "leica m11", false)).toBe(false);
  });
});
