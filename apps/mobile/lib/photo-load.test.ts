import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_RETRY_MS, usePhotoLoad } from "./photo-load";

/**
 * A photograph's load (owner's screenshots, 2026-11-01: his Audi R8 showed no photo on the list while its page showed
 * the same one): a failure is tried again, belongs to its address, and a new address starts over at once.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

let seen: ReturnType<typeof usePhotoLoad> = { show: false, tries: 0, onError() {} };
function Probe({ uri }: { uri?: string | null }) {
  seen = usePhotoLoad(uri);
  return null;
}
let root: ReactTestRenderer | null = null;
const show = async (uri?: string | null) => {
  await act(async () => {
    if (root) root.update(createElement(Probe, { uri }));
    else root = create(createElement(Probe, { uri }));
  });
};
const fail = () => act(async () => seen.onError());
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe("a photograph's load", () => {
  it("is tried again after a failure, twice, then left to its stand-in", async () => {
    vi.useFakeTimers();
    await show("https://uploads.example/r8.jpg");
    expect(seen).toMatchObject({ show: true, tries: 0 });
    await fail();
    expect(seen.show).toBe(false);
    await wait(PHOTO_RETRY_MS[0] - 1);
    expect(seen.show).toBe(false);
    await wait(1);
    expect(seen).toMatchObject({ show: true, tries: 1 });
    await fail();
    await wait(PHOTO_RETRY_MS[1]);
    expect(seen).toMatchObject({ show: true, tries: 2 });
    await fail();
    await wait(60_000);
    expect(seen).toMatchObject({ show: false, tries: 2 });
  });

  it("starts over at once for a new address, even after the last one was given up", async () => {
    vi.useFakeTimers();
    await show("https://shop.example/listing.jpg");
    for (const ms of [0, ...PHOTO_RETRY_MS]) {
      await wait(ms);
      await fail();
    }
    expect(seen.show).toBe(false);
    await show("https://uploads.example/r8.jpg");
    expect(seen).toMatchObject({ show: true, tries: 0 });
  });

  it("keeps showing a new address when the old one's failure arrives late", async () => {
    await show("https://shop.example/listing.jpg");
    const late = seen.onError;
    await show("https://uploads.example/r8.jpg");
    await act(async () => late());
    expect(seen).toMatchObject({ show: true, tries: 0 });
  });

  it("leaves a failed new address to its own wait when the old one's failure arrives late", async () => {
    vi.useFakeTimers();
    await show("https://shop.example/listing.jpg");
    const late = seen.onError;
    await show("https://uploads.example/r8.jpg");
    await fail();
    expect(seen.show).toBe(false);
    await act(async () => late());
    // Still the new address's failure, still waiting its turn.
    expect(seen).toMatchObject({ show: false, tries: 0 });
    await wait(PHOTO_RETRY_MS[0] - 1);
    expect(seen.show).toBe(false);
    await wait(1);
    expect(seen).toMatchObject({ show: true, tries: 1 });
  });

  it("counts a late failure from an earlier try of the same address for nothing", async () => {
    vi.useFakeTimers();
    await show("https://uploads.example/r8.jpg");
    const first = seen.onError;
    await fail();
    await wait(PHOTO_RETRY_MS[0]);
    expect(seen).toMatchObject({ show: true, tries: 1 });
    // The first try's error again, late: the second try keeps running.
    await act(async () => first());
    expect(seen).toMatchObject({ show: true, tries: 1 });
    await fail();
    // And while the second try's failure waits: no earlier retry, no extra try.
    await act(async () => first());
    expect(seen).toMatchObject({ show: false, tries: 1 });
    await wait(PHOTO_RETRY_MS[1] - 1);
    expect(seen.show).toBe(false);
    await wait(1);
    expect(seen).toMatchObject({ show: true, tries: 2 });
    await fail();
    await wait(60_000);
    expect(seen).toMatchObject({ show: false, tries: 2 });
  });

  it("shows nothing without an address", async () => {
    await show(undefined);
    expect(seen.show).toBe(false);
    await show("");
    expect(seen.show).toBe(false);
  });
});
