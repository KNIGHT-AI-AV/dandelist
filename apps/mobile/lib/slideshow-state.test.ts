import { act, createElement, useEffect } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaImage } from "../components/media";
import { createSlideshow, nextSlideshowIndex, slideshowReducer as reduce, type SlideRecord, type SlideshowState } from "./slideshow-state";

const a: MediaImage = { url: "https://images.example/a.jpg", source: "commons.wikimedia.org", credit: "Alice", license: "CC BY 4.0", sourcePage: "https://commons.wikimedia.org/wiki/File:A.jpg", author: { name: "Alice", url: "https://example.com/alice" } };
const b: MediaImage = { ...a, url: "https://images.example/b.jpg", credit: "Bob", sourcePage: "https://commons.wikimedia.org/wiki/File:B.jpg" };
const c: MediaImage = { ...a, url: "https://images.example/c.jpg", credit: "Carol" };
const pending = (state: SlideshowState): SlideRecord => state.candidate!.record;
const tick = (state: SlideshowState) => reduce(state, { type: "tick", epoch: state.epoch });
function commit(state: SlideshowState): SlideshowState {
  const record = pending(state);
  return reduce(reduce(state, { type: "display", record }), { type: "finish", record, finished: true });
}

describe("slideshow display identity", () => {
  it("requires full-size display and the matching successful fade before changing image and credit", () => {
    const shownA = commit(createSlideshow([a, b]));
    const requestedB = tick(shownA);
    const record = pending(requestedB);
    expect(requestedB.shown).toBe(shownA.shown);
    expect(reduce(requestedB, { type: "finish", record, finished: true })).toBe(requestedB);
    const readyB = reduce(requestedB, { type: "display", record });
    expect(readyB.shown).toBe(shownA.shown);
    expect(readyB.shown?.image.credit).toBe("Alice");
    expect(reduce(readyB, { type: "display", record })).toBe(readyB);
    const shownB = reduce(readyB, { type: "finish", record, finished: true });
    expect(shownB.shown).toBe(record);
    expect(shownB.shown?.image.sourcePage).toBe(b.sourcePage);
    expect(reduce(shownB, { type: "error", record })).toBe(shownB);
  });

  it.each([false, true])("retains the actual A record when B fails (fade started: %s), then reaches C", (fading) => {
    const shownA = commit(createSlideshow([a, b, c]));
    let state = tick(shownA);
    const bad = pending(state);
    if (fading) state = reduce(state, { type: "display", record: bad });
    state = reduce(state, { type: "error", record: bad });
    expect(state.shown).toBe(shownA.shown);
    expect(state.candidate).toBeUndefined();
    expect(reduce(state, { type: "finish", record: bad, finished: true })).toBe(state);
    state = commit(tick(state));
    expect(state.shown?.image.url).toBe(c.url);
    state = commit(tick(state));
    expect(state.shown?.image.url).toBe(a.url);
    expect(pending(tick(state)).image.url).toBe(c.url); // B stays skipped, without retry timers.
  });

  it("has no attribution after first/all failure and stops cycling proven failures", () => {
    let state = createSlideshow([a, b]);
    state = reduce(state, { type: "error", record: pending(state) });
    expect(state.shown).toBeUndefined();
    state = tick(state);
    const second = pending(state);
    state = reduce(state, { type: "display", record: second });
    expect(state.shown).toBeUndefined();
    const successfulSecond = reduce(state, { type: "finish", record: second, finished: true });
    expect(successfulSecond.shown?.image.url).toBe(b.url);
    expect(nextSlideshowIndex(successfulSecond)).toBeUndefined();
    state = reduce(state, { type: "error", record: second });
    expect(nextSlideshowIndex(state)).toBeUndefined();
    expect(tick(state)).toBe(state);
  });

  it("does not re-request a lone committed image or a fallback whose other images failed", () => {
    const single = commit(createSlideshow([a]));
    expect(nextSlideshowIndex(single)).toBeUndefined();
    expect(tick(single)).toBe(single);
    let state = tick(commit(createSlideshow([a, b])));
    state = reduce(state, { type: "error", record: pending(state) });
    expect(nextSlideshowIndex(state)).toBeUndefined();
    expect(tick(state)).toBe(state);
  });

  it.each(["finish", "cancel"] as const)("cancellation (%s) is resumable and does not blacklist the URI", (type) => {
    let state = tick(commit(createSlideshow([a, b])));
    const record = pending(state);
    state = reduce(state, { type: "display", record });
    state = type === "finish" ? reduce(state, { type, record, finished: false }) : reduce(state, { type, record });
    expect(state.shown?.image.url).toBe(a.url);
    expect(state.failed).toEqual([]);
    const next = tick(state);
    expect(pending(next).image.url).toBe(b.url);
    expect(pending(next).attempt).not.toBe(record.attempt);
    expect(reduce(next, { type: "cancel", record })).toBe(next);
    expect(reduce(next, { type: "finish", record, finished: true })).toBe(next);
  });

  it("consumes busy ticks without moving the cursor or queueing the next image", () => {
    const state = tick(commit(createSlideshow([a, b, c])));
    const ready = reduce(state, { type: "display", record: pending(state) });
    expect(tick(ready)).toBe(ready);
    const finished = commit(ready);
    expect(finished.candidate).toBeUndefined();
    expect(pending(tick(finished)).image.url).toBe(c.url);
  });

  it("supersedes an unresolved request but rejects its late display, error and fade events", () => {
    const first = createSlideshow([a, b, c]);
    const abandoned = pending(first);
    const second = tick(first);
    for (const type of ["display", "error", "cancel"] as const) expect(reduce(second, { type, record: abandoned })).toBe(second);
    expect(reduce(second, { type: "finish", record: abandoned, finished: true })).toBe(second);
    expect(pending(second).image.url).toBe(b.url);
  });

  it("preserves equal semantic arrays but resets equal-length replacement, reorder and metadata changes", () => {
    const state = commit(createSlideshow([a, b]));
    expect(reduce(state, { type: "deck", images: [{ ...a, author: { ...a.author! } }, { ...b }] })).toBe(state);
    for (const images of [[c, b], [b, a], [{ ...a, credit: "Corrected author" }, b], [{ ...a, author: { ...a.author!, url: "https://example.com/updated" } }, b]]) {
      const replaced = reduce(state, { type: "deck", images });
      expect(replaced.epoch).toBe(state.epoch + 1);
      expect(replaced.shown).toBeUndefined();
      expect(replaced.failed).toEqual([]);
    }
  });

  it("captures metadata independently of caller mutation and preserves the generated marker", () => {
    const input = { ...a, author: { ...a.author! }, generated: true };
    const state = createSlideshow([input]);
    input.credit = "Mutated";
    input.author.name = "Mutated";
    expect(pending(state).image.credit).toBe("Alice");
    expect(pending(state).image.author?.name).toBe("Alice");
    expect(commit(state).shown?.image.generated).toBe(true);
  });

  it("invalidates old events through clear and an A→B→A deck sequence", () => {
    const first = createSlideshow([a]);
    const old = pending(first);
    const empty = reduce(first, { type: "deck", images: [] });
    expect(empty.candidate).toBeUndefined();
    expect(nextSlideshowIndex(empty)).toBeUndefined();
    const other = reduce(empty, { type: "deck", images: [b] });
    const restored = reduce(other, { type: "deck", images: [a] });
    expect(pending(restored).epoch).toBeGreaterThan(old.epoch);
    for (const state of [empty, other, restored]) {
      expect(reduce(state, { type: "tick", epoch: first.epoch })).toBe(state);
      for (const type of ["display", "error", "cancel"] as const) expect(reduce(state, { type, record: old })).toBe(state);
      expect(reduce(state, { type: "finish", record: old, finished: true })).toBe(state);
    }
  });
});

// Mount the actual Slideshow. Only the SDK hosts/animation driver and unrelated UI imports are substituted.
// These controls prove React node retention and effect scheduling, not native pixels or SDK readiness semantics.
const sdk = vi.hoisted(() => {
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
    interpolate(config: unknown) { return { value: this, config }; }
  }
  type Config = { toValue: number; duration: number; useNativeDriver: boolean };
  type Run = { value: Value; config: Config; done: boolean; callback?: (result: { finished: boolean }) => void; start: (callback?: (result: { finished: boolean }) => void) => void; stop: () => void; finish: (finished: boolean) => void };
  const runs: Run[] = [];
  return {
    Value, runs, instances: 0, reduced: false,
    timing(value: Value, config: Config) {
      const run: Run = {
        value, config, done: false,
        start(callback) { run.callback = callback; runs.push(run); },
        stop() { if (!run.done) run.finish(false); },
        finish(finished) { run.done = true; if (finished) value.setValue(config.toValue); run.callback?.({ finished }); },
      };
      return run;
    },
  };
});
vi.mock("react-native", () => ({
  View: "View", Text: "Text", StyleSheet: { absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } },
  Animated: { Value: sdk.Value, View: "AnimatedView", timing: sdk.timing },
  Easing: { out: (value: unknown) => value, cubic: "cubic", linear: "linear" }, PanResponder: {},
}));
vi.mock("expo-image", async () => {
  const React = await import("react");
  return { Image: (props: Record<string, unknown>) => {
    const [instance] = React.useState(() => ++sdk.instances);
    return React.createElement("Image", { ...props, instance });
  } };
});
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "Gradient" }));
vi.mock("./motion", () => ({ useReducedMotion: () => sdk.reduced }));
vi.mock("./theme", () => ({ type: { figure: {} }, usePalette: () => ({ bg: "black", ink3: "white", onPhotoTrack: "gray", onPhoto: "white" }) }));
vi.mock("../components/lux", () => ({ Photo: "Photo" }));
vi.mock("../components/embed", () => ({ Embed: "Embed" }));
vi.mock("../components/photo-credit", () => ({ PhotoCredit: "PhotoCredit" }));
const { Slideshow } = await import("../components/media");
const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
flags.IS_REACT_ACT_ENVIRONMENT = true;
flags.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
const isHost = (node: ReactTestInstance, name: string) => typeof node.type === "string" && node.type === name;

describe("the mounted slideshow's actual clock and retained layers", () => {
  let root: ReactTestRenderer | undefined;
  const full = () => root!.root.findAll((node) => isHost(node, "Image") && typeof node.props.onDisplay === "function");
  const image = (url: string) => full().find((node) => node.props.source.uri === url)!;
  const credits = () => root!.root.findAll((node) => isHost(node, "PhotoCredit")).map((node) => node.props.image as MediaImage);
  const fade = (node: ReactTestInstance) => {
    const value = node.parent!.parent!.props.style[1].opacity;
    return [...sdk.runs].reverse().find((run) => run.value === value)!;
  };
  const display = async (node: ReactTestInstance) => { await act(async () => node.props.onDisplay()); };
  const finish = async (node: ReactTestInstance, success = true) => { await act(async () => fade(node).finish(success)); };
  beforeEach(() => { vi.useFakeTimers(); sdk.runs.length = 0; sdk.instances = 0; sdk.reduced = false; });
  afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.useRealTimers(); });

  it.each([false, true])("keeps the repeating clock across a late fade/busy tick and promotes the same node (reduced: %s)", async (reduced) => {
    sdk.reduced = reduced;
    await act(async () => { root = create(createElement(Slideshow, { images: [a, b, c], interval: 3800 })); });
    const first = image(a.url);
    expect(credits()).toEqual([]);
    expect(first.props.onLoadEnd).toBeUndefined();
    const preload = root!.root.findAll((node) => isHost(node, "Image") && !node.props.onDisplay)[0]!;
    expect(preload.props.onLoad).toBeUndefined();
    expect(preload.props.onDisplay).toBeUndefined();
    await display(first);
    expect(fade(first).config.duration).toBe(reduced ? 400 : 1100);
    expect(credits()).toEqual([]);
    await finish(first);
    expect(credits()[0]?.credit).toBe("Alice");
    await act(async () => vi.advanceTimersByTime(3800));
    const second = image(b.url);
    const secondInstance = second.props.instance;
    expect(image(a.url).props.instance).toBe(first.props.instance);
    await act(async () => vi.advanceTimersByTime(3799));
    await display(second); // ready just before the second regular clock tick
    const secondFade = fade(second);
    await act(async () => vi.advanceTimersByTime(1));
    expect(full()).toHaveLength(2);
    expect(image(b.url).props.instance).toBe(secondInstance);
    expect(secondFade.done).toBe(false);
    expect(credits()[0]?.credit).toBe("Alice");
    await act(async () => vi.advanceTimersByTime(reduced ? 400 : 1100));
    await finish(second);
    expect(image(b.url).props.instance).toBe(secondInstance);
    expect(full()).toHaveLength(1);
    expect(credits()[0]?.credit).toBe("Bob");
    // No queued C and no clock reset at readiness/commit: the next tick is still at11400.
    await act(async () => vi.advanceTimersByTime(3800 - (reduced ? 400 : 1100)));
    expect(image(c.url)).toBeDefined();
    expect(image(b.url).props.instance).toBe(secondInstance);
  });

  it("retains A's actual node on B error, ignores late completion, and can display C", async () => {
    await act(async () => { root = create(createElement(Slideshow, { images: [a, b, c], interval: 3800 })); });
    const first = image(a.url);
    await display(first); await finish(first);
    await act(async () => vi.advanceTimersByTime(3800));
    const second = image(b.url);
    await display(second);
    const obsolete = fade(second).callback!;
    await act(async () => second.props.onError());
    expect(image(a.url).props.instance).toBe(first.props.instance);
    expect(full()).toHaveLength(1);
    expect(credits()[0]?.credit).toBe("Alice");
    await act(async () => obsolete({ finished: true }));
    expect(credits()[0]?.credit).toBe("Alice");
    await act(async () => vi.advanceTimersByTime(3800));
    await display(image(c.url)); await finish(image(c.url));
    expect(credits()[0]?.credit).toBe("Carol");
  });

  it("stops after all full-size errors and preserves children across semantic replacement/clear", async () => {
    let mounts = 0;
    function Child() { useEffect(() => { mounts += 1; }, []); return null; }
    const render = (images: MediaImage[]) => createElement(Slideshow, { images, interval: 3800 }, createElement(Child));
    await act(async () => { root = create(render([a, b])); });
    const obsoleteDisplay = image(a.url).props.onDisplay;
    await act(async () => image(a.url).props.onError());
    await act(async () => vi.advanceTimersByTime(3800));
    await act(async () => image(b.url).props.onError());
    expect(credits()).toEqual([]);
    expect(full()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { root!.update(render([{ ...a, credit: "New metadata" }])); });
    await act(async () => obsoleteDisplay());
    expect(credits()).toEqual([]);
    await display(image(a.url)); await finish(image(a.url));
    expect(credits()[0]?.credit).toBe("New metadata");
    await act(async () => { root!.update(render([])); });
    expect(full()).toHaveLength(0);
    expect(credits()).toEqual([]);
    expect(mounts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from a cancelled fade on the regular clock and commits the existing generated label", async () => {
    const generated = { ...a, generated: true };
    await act(async () => { root = create(createElement(Slideshow, { images: [generated], interval: 3800 })); });
    const cancelled = image(a.url);
    const cancelledInstance = cancelled.props.instance;
    await display(cancelled); await finish(cancelled, false);
    expect(full()).toHaveLength(0);
    expect(credits()).toEqual([]);
    await act(async () => vi.advanceTimersByTime(3800));
    const retried = image(a.url);
    expect(retried.props.instance).not.toBe(cancelledInstance);
    await display(retried); await finish(retried);
    expect(root!.root.findAll((node) => isHost(node, "Text")).some((node) => node.props.children === "Image made with AI")).toBe(true);
    expect(credits()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
