import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DreamAction, Numbered, SessionDetail } from "../../lib/dream";

/**
 * Which of Dandy's questions can still be answered with a tap, decided by the real chat (review R44-CHOICES-OWNER):
 * the real ChatPage, its feed, its turn queue, its delivery and the real Choices row. The stream, the saved
 * conversation and the views stand in. Only the newest question with nothing said after it is answerable: a typed
 * answer or a newer question closes it, a reopened chat whose last word is the question can answer it, and one tap
 * sends once.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  turns: [] as DreamAction[],
  /** What the next turns stream, one list of events per turn. */
  scripts: [] as Numbered[][],
  saved: null as SessionDetail | null,
  latest: [] as { id: string; updatedAt: string }[],
  inbox: null as ((text: string) => void) | null,
  /** While set, a turn stays open after its events, as when Dandy is still answering. */
  hold: null as Promise<void> | null,
}));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("react-native", () => ({
  Animated: { View: "AnimatedView" },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Keyboard: { dismiss() {} },
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-router", () => ({ router: { push() {}, replace() {} } }));
vi.mock("../chat/greeting", () => ({ Greeting: "Greeting" }));
vi.mock("../chat/history-sheet", () => ({ HistorySheet: "HistorySheet" }));
vi.mock("../chat/hunt-card", () => ({ HuntCard: "HuntCard" }));
vi.mock("../chat/list-change", () => ({ ListChangeCard: "ListChangeCard" }));
vi.mock("../chat/use-history", () => ({
  useHistory: () => ({ sessions: h.latest, error: null, pending: null, refresh: async () => h.latest, flush() {}, remove() {}, undo() {} }),
}));
vi.mock("../chat/working", () => ({ StreamText: ({ text }: { text: string }) => createElement("StreamText", { text }), WorkLog: "WorkLog", Working: "Working" }));
vi.mock("../dandy-avatar", () => ({ DandyAvatar: "DandyAvatar" }));
vi.mock("../dream/builders", () => ({ CarBuilder: "CarBuilder", HomeBuilder: "HomeBuilder", RegionPicker: "RegionPicker" }));
vi.mock("../dream/deck", () => ({ SwipeDeck: "SwipeDeck" }));
vi.mock("../dream/quotes", () => ({ ServiceQuote: "ServiceQuote", WishReady: "WishReady" }));
vi.mock("../add-another", () => ({ AddAnotherPrompt: "AddAnotherPrompt" }));
vi.mock("../inputs", () => ({ KeyboardScroll: passThrough("KeyboardScroll"), dockRoom: () => 0 }));
vi.mock("../lux", () => ({ Chip: "Chip", Glass: passThrough("Glass"), Icon: "Icon", PrimaryButton: "PrimaryButton" }));
vi.mock("../welcome/kit", () => ({ Rise: passThrough("Rise") }));
vi.mock("../../lib/activity", () => ({ startTask: () => "task", updateTask() {}, endTask() {} }));
vi.mock("../../lib/auth", () => {
  const auth = { status: "signedIn", api: async () => ({ ok: false, json: async () => null }), apiStream: async () => null };
  return { useAuth: () => auth };
});
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ name: "Dandy" }) }));
vi.mock("../../lib/listed", () => ({ listedWish: () => null }));
vi.mock("../../lib/wish-queue", () => ({ takeQueuedWishes: () => () => {} }));
vi.mock("../../lib/motion", () => ({ haptic: { error() {}, select() {}, success() {} }, usePress: () => ({ scale: 1, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/suggestions", () => ({ useSuggestions: () => ({ items: [], loading: false, refresh() {} }) }));
vi.mock("../../lib/theme", () => ({
  fonts: {},
  layout: { gutter: () => 20, column: 560, control: { primary: 56 } },
  radius: { md: 18, pill: 999 },
  space: { 8: 8, 12: 12, 16: 16 },
  type: {},
  usePalette: () => ({ ink: "#fff", ink2: "#ccc" }),
}));
vi.mock("../../lib/wishes", () => ({ useWishes: () => ({ add: async () => null, wishes: [] }) }));
vi.mock("./bridge", () => {
  const home = { dock: 0, showOnList() {}, focusComposer() {} };
  return {
    useHome: () => home,
    useChatInbox: (submit: (text: string) => void) => {
      h.inbox = submit;
    },
  };
});
vi.mock("./chrome", () => ({ useTopRoom: () => 0 }));
vi.mock("./pager", () => ({ usePager: () => ({ page: "chat", shows: (id: string) => id === "chat" }) }));
vi.mock("../../lib/dream", async (original) => ({
  ...(await original<typeof import("../../lib/dream")>()),
  // The turn's stream: each turn plays the next script, then ends.
  dreamTurn: async (_api: unknown, sessionId: string | null, action: DreamAction, onEvent: (e: Numbered) => void) => {
    h.turns.push(action);
    for (const e of h.scripts.shift() ?? []) onEvent(e);
    if (h.hold) await h.hold;
    return sessionId ?? "s1";
  },
  loadSession: async () => h.saved!,
  sessionEvents: async () => ({ events: [], seq: 0, gap: false, running: [] }),
}));

const { ChatPage } = await import("./chat-page");
const { Choices } = await import("../dream/choices");

let root: ReactTestRenderer | null = null;
const at = "2026-10-31T15:00:00Z";
const ask = (id: string, question: string, options: string[]): Numbered[] => [
  { type: "text", text: question },
  { type: "widget", widget: { kind: "choices", id, options } },
];
const settle = () => act(async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
});

async function mount() {
  await act(async () => {
    root = create(createElement(ChatPage));
  });
  await settle();
}
/** The answer rows on screen, in order, each with its chips. */
const rows = () => root!.root.findAllByType(Choices);
const chips = (row: ReactTestInstance) => row.findAll((n) => (n.type as unknown) === "Chip");
const answerable = (row: ReactTestInstance) => chips(row).some((c) => typeof c.props.onPress === "function");
const said = () => root!.root.findAll((n) => (n.type as unknown) === "StreamText").map((n) => n.props.text as string);
async function type(text: string) {
  await act(async () => h.inbox!(text));
  await settle();
}
async function tap(row: ReactTestInstance, label: string) {
  await act(async () => chips(row).find((c) => c.props.label === label)!.props.onPress());
  await settle();
}

beforeEach(() => {
  h.turns = [];
  h.scripts = [];
  h.saved = null;
  h.latest = [];
  h.inbox = null;
  h.hold = null;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("answering Dandy's question with a tap (review R44-CHOICES-OWNER)", () => {
  it("closes a question once they type their answer instead", async () => {
    await mount();
    h.scripts.push(ask("choice_1", "New or used?", ["New", "Used"]), [{ type: "text", text: "Used it is." }]);
    await type("a porsche 911");
    expect(said()).toContain("New or used?");
    expect(rows().map(answerable)).toEqual([true]);
    await type("used please");
    expect(rows().map(answerable)).toEqual([false]);
    expect(h.turns).toEqual([
      { type: "message", text: "a porsche 911" },
      { type: "message", text: "used please" },
    ]);
  });

  it("keeps the question open when Dandy opens another tool beside it in the same reply", async () => {
    await mount();
    h.scripts.push([...ask("choice_1", "New or used?", ["New", "Used"]), { type: "widget", widget: { kind: "item", id: "item_1", text: "a Leica Q3" } }]);
    await type("a porsche 911 and a leica");
    expect(root!.root.findAll((n) => (n.type as unknown) === "HuntCard")).toHaveLength(1);
    expect(rows().map(answerable)).toEqual([true]);
    await type("used");
    expect(rows().map(answerable)).toEqual([false]);
  });

  it("leaves only the newest question open when another follows", async () => {
    await mount();
    h.scripts.push(ask("choice_1", "New or used?", ["New", "Used"]), ask("choice_2", "Which colour?", ["Black", "Silver"]));
    await type("a porsche 911");
    await type("used");
    expect(rows().map(answerable)).toEqual([false, true]);
  });

  it("sends one tapped answer once, then closes the question", async () => {
    await mount();
    h.scripts.push(ask("choice_1", "New or used?", ["New", "Used"]), [{ type: "text", text: "Used it is." }]);
    await type("a porsche 911");
    const [row] = rows();
    await tap(row!, "Used");
    // A second tap on the same row changes nothing.
    for (const c of chips(row!)) if (typeof c.props.onPress === "function") await tap(row!, c.props.label as string);
    expect(h.turns).toEqual([
      { type: "message", text: "a porsche 911" },
      { type: "message", text: "Used" },
    ]);
    expect(answerable(rows()[0]!)).toBe(false);
    expect(chips(rows()[0]!).find((c) => c.props.label === "Used")!.props.selected).toBe(true);
  });

  it("sends one answer once when it's tapped while Dandy is still answering", async () => {
    await mount();
    let finish = () => {};
    h.hold = new Promise<void>((r) => (finish = r));
    h.scripts.push(ask("choice_1", "New or used?", ["New", "Used"]), [{ type: "text", text: "Used it is." }]);
    await type("a porsche 911");
    const [row] = rows();
    await tap(row!, "Used");
    // The turn is still open, so the answer waits its turn; the row is closed already.
    expect(answerable(rows()[0]!)).toBe(false);
    h.hold = null;
    await act(async () => finish());
    await settle();
    expect(h.turns).toEqual([
      { type: "message", text: "a porsche 911" },
      { type: "message", text: "Used" },
    ]);
  });

  it("can answer the question a reopened chat ends on, saved the way the server saves it", async () => {
    h.latest = [{ id: "s9", updatedAt: new Date().toISOString() }];
    h.saved = {
      id: "s9",
      transcript: [
        { role: "user", text: "a porsche 911", at },
        { role: "agent", text: "New or used?", at },
        { role: "agent", text: 'Asked "New or used?" with the answers New / Used.', at, widget: { kind: "choices", id: "choice_1" } },
      ],
      widgets: [{ kind: "choices", id: "choice_1", options: ["New", "Used"] }],
      running: [],
    };
    await mount();
    expect(said()).toEqual(["New or used?"]);
    expect(rows().map(answerable)).toEqual([true]);
    h.scripts.push([{ type: "text", text: "Used it is." }]);
    await tap(rows()[0]!, "New");
    expect(h.turns).toEqual([{ type: "message", text: "New" }]);
    expect(answerable(rows()[0]!)).toBe(false);
  });

  it("keeps a reopened question closed when they had already answered it", async () => {
    h.latest = [{ id: "s9", updatedAt: new Date().toISOString() }];
    h.saved = {
      id: "s9",
      transcript: [
        { role: "agent", text: "New or used?", at },
        { role: "agent", text: 'Asked "New or used?" with the answers New / Used.', at, widget: { kind: "choices", id: "choice_1" } },
        { role: "user", text: "Used", at },
      ],
      widgets: [{ kind: "choices", id: "choice_1", options: ["New", "Used"] }],
      running: [],
    };
    await mount();
    expect(rows().map(answerable)).toEqual([false]);
  });
});
