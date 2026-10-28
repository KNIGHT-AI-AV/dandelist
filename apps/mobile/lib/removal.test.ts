import { describe, expect, it } from "vitest";
import { UNDO_MS, begin, expire, flush, hold, msLeft, release, undo, type Removal } from "./removal";

const car = { id: "car", name: "Porsche 911" };
const house = { id: "house", name: "Lake house" };

describe("removal with undo", () => {
  it("holds the delete for five seconds", () => {
    const s = begin(null, car, 1000);
    expect(s.commit).toEqual([]);
    expect(s.state).toMatchObject({ id: "car", name: "Porsche 911", due: 1000 + UNDO_MS });
    expect(UNDO_MS).toBe(5000);
  });

  it("deletes only once the window has closed", () => {
    const { state } = begin(null, car, 0);
    expect(expire(state, UNDO_MS - 1)).toEqual({ state, commit: [] });
    expect(expire(state, UNDO_MS)).toEqual({ state: null, commit: ["car"] });
  });

  it("never deletes after undo", () => {
    const { state } = begin(null, car, 0);
    const back = undo(state, "car");
    expect(back).toEqual({ state: null, commit: [] });
    expect(expire(back.state, UNDO_MS * 2).commit).toEqual([]);
  });

  it("ignores undo for a wish that isn't pending", () => {
    const { state } = begin(null, car, 0);
    expect(undo(state, "house")).toEqual({ state, commit: [] });
    expect(undo(null, "car")).toEqual({ state: null, commit: [] });
  });

  it("commits the older removal when a newer one starts", () => {
    const first = begin(null, car, 0);
    const second = begin(first.state, house, 2000);
    expect(second.commit).toEqual(["car"]);
    expect(second.state).toMatchObject({ id: "house", due: 2000 + UNDO_MS });
  });

  it("treats removing the same wish twice as one removal", () => {
    const first = begin(null, car, 0);
    expect(begin(first.state, car, 3000)).toEqual({ state: first.state, commit: [] });
  });

  it("commits what is pending when the screen goes away", () => {
    const { state } = begin(null, car, 0);
    expect(flush(state)).toEqual({ state: null, commit: ["car"] });
    expect(flush(null)).toEqual({ state: null, commit: [] });
  });

  it("pauses while held and resumes with the time that was left", () => {
    const { state } = begin(null, car, 0);
    const held = hold(state, 2000);
    expect(held).toMatchObject({ held: UNDO_MS - 2000 });
    expect(msLeft(held, 2000)).toBeNull();
    // Held for a minute: nothing is deleted meanwhile.
    expect(expire(held, 60_000).commit).toEqual([]);
    const resumed = release(held, 60_000);
    expect(msLeft(resumed, 60_000)).toBe(UNDO_MS - 2000);
    expect(expire(resumed, 60_000 + UNDO_MS - 2001).commit).toEqual([]);
    expect(expire(resumed, 60_000 + UNDO_MS - 2000).commit).toEqual(["car"]);
  });

  it("keeps hold and release idempotent", () => {
    const { state } = begin(null, car, 0);
    const held = hold(state, 1000);
    expect(hold(held, 4000)).toBe(held);
    expect(release(state, 4000)).toBe(state);
    expect(hold(null, 0)).toBeNull();
    expect(release(null, 0)).toBeNull();
  });

  it("never reports negative time", () => {
    const { state } = begin(null, car, 0);
    expect(msLeft(state, UNDO_MS + 500)).toBe(0);
    expect(msLeft(null as Removal, 0)).toBeNull();
    expect(hold(state, UNDO_MS + 500)).toMatchObject({ held: 0 });
  });

  it("uses a longer window when the system asks for one", () => {
    const { state } = begin(null, car, 0, 12_000);
    expect(expire(state, UNDO_MS).commit).toEqual([]);
    expect(expire(state, 12_000).commit).toEqual(["car"]);
  });
});
