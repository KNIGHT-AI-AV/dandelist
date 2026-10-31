import { router } from "expo-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, Keyboard, Platform, Pressable, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Greeting } from "../chat/greeting";
import { HistorySheet } from "../chat/history-sheet";
import { HuntCard } from "../chat/hunt-card";
import { ListChangeCard } from "../chat/list-change";
import { useHistory } from "../chat/use-history";
import { StreamText, WorkLog, Working, type StepLine } from "../chat/working";
import { DandyAvatar } from "../dandy-avatar";
import { CarBuilder, HomeBuilder, RegionPicker } from "../dream/builders";
import { SwipeDeck } from "../dream/deck";
import { Choices } from "../dream/choices";
import { ServiceQuote, WishReady } from "../dream/quotes";
import { AddAnotherPrompt } from "../add-another";
import { KeyboardScroll, dockRoom } from "../inputs";
import { Glass, Icon, PrimaryButton } from "../lux";
import { Rise } from "../welcome/kit";
import { endTask, startTask, updateTask } from "../../lib/activity";
import { Delivery } from "../../lib/chat-delivery";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { listedWish } from "../../lib/listed";
import { takeQueuedWishes } from "../../lib/wish-queue";
import {
  askingChoices,
  askingWidget,
  dreamTurn,
  feedFromSession,
  lostConnection,
  sessionEvents,
  idleTooLong,
  loadSession,
  shouldResume,
  taskFor,
  wishFrom,
  type DreamAction,
  type DreamEvent,
  type Numbered,
  type FeedItem,
  type SessionDetail,
  type LifeContext,
  type Widget,
} from "../../lib/dream";
import { haptic, usePress } from "../../lib/motion";
import { useSuggestions } from "../../lib/suggestions";
import { fonts, layout, radius, space, type, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { useChatInbox, useHome } from "./bridge";
import { useTopRoom } from "./chrome";
import { usePager } from "./pager";
import { usePageSize } from "../../lib/page-size";

let seq = 0;
const nextId = () => `f${++seq}`;

/** The chat's own header under the top bar: the conversation's first words, New chat and History. */
const HEADER = 52;
/** Within this of the end, new content keeps the chat at the end; further up, the reader is left where they are. */
const PINNED_PX = 96;

type Queued = { action: DreamAction; echo?: string };
type Row = { key: string; item: FeedItem } | { key: string; steps: StepLine[] };

/** A small glass control for the chat's header, 44 pt tall to the touch. */
function HeaderButton({ label, icon, onPress, hint }: { label: string; icon?: "plus"; onPress(): void; hint?: string }) {
  const p = usePalette();
  const press = usePress(0.95);
  return (
    <Pressable accessibilityRole="button" accessibilityHint={hint} onPress={() => { haptic.select(); onPress(); }} onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}>
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Glass intensity={40} style={{ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon ? <Icon name={icon} size={11} color={p.ink} /> : null}
          <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink }]}>{label}</Text>
        </Glass>
      </Animated.View>
    </Pressable>
  );
}

/** Steps that follow one another fold into one work log; everything else is its own row. */
/** What the chat says when something breaks: plain words, never a platform error ("fetch failed: Unexpected..."). */
function friendly(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : "";
  if (!m || /fetch failed|network|connection|UnexpectedException|timed out|\.swift|\.kt:/i.test(m)) return m ? "I lost the connection for a moment. Send that again." : fallback;
  return m;
}

function rowsOf(feed: FeedItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of feed) {
    const last = rows[rows.length - 1];
    if (item.kind === "step") {
      if (last && "steps" in last) last.steps.push(item);
      else rows.push({ key: `steps:${item.id}`, steps: [item] });
    } else rows.push({ key: item.id, item });
  }
  return rows;
}

/**
 * The Dandy: a chat where people say anything they want. The Dandy answers in words and, when it helps, opens a tool
 * right in the conversation: a home builder, a car configurator, a swipe deck of real listings, a quote for a
 * service. Each finished find goes onto the list with what it costs to keep.
 *
 * Conversations are kept (owner, 2026-10-28): opening the chat picks up the latest one if it moved in the last hour,
 * otherwise a new one starts with three fresh suggestions; coming back after an hour away starts a new one too. The
 * header's History lists them all, to reopen or delete.
 */
export function ChatPage() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = usePageSize();
  const gutter = layout.gutter(width);
  const auth = useAuth();
  const { add, wishes } = useWishes();
  const dandy = useDandy();
  const pager = usePager();
  const home = useHome();
  const dock = home.dock || layout.control.primary;
  const top = useTopRoom();
  const suggestions = useSuggestions();
  const refreshSuggestions = suggestions.refresh;

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  // The running turn is a swipe: usually instant, so it shows no indicator and leaves the composer open.
  const [quiet, setQuiet] = useState(false);
  // Which conversation the chat is in is known (resumed or new); messages sent before then wait.
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [life, setLife] = useState<LifeContext | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  // Hunt cards still finding out what their wish is and what it costs, while "Add another while you wait" shows.
  const [hunting, setHunting] = useState<ReadonlySet<string>>(() => new Set());
  // Finds put on the list from this conversation: card (its id and name) to the wish saved from it.
  const [savedFrom, setSavedFrom] = useState<Readonly<Record<string, string>>>({});

  const session = useRef<string | null>(null);
  // Bumped whenever the chat changes conversation; anything still arriving for an older one is dropped.
  const gen = useRef(0);
  const queue = useRef<Queued[]>([]);
  const running = useRef<AbortController | null>(null);
  const early = useRef<string[]>([]);
  const lastActive = useRef(Date.now());
  const busyRef = useRef(false);
  const dandyRef = useRef(dandy);
  dandyRef.current = dandy;

  // Who shows the conversation's events, and each once (lib/chat-delivery.ts, review of #134): the open turn's stream,
  // the follower reading the log while background work runs, or a reload of the saved conversation, one at a time.
  const io = useRef({ show: (_: DreamEvent) => {}, reset: (_: SessionDetail) => {}, api: auth.api });
  const delivery = useMemo(
    () =>
      new Delivery({
        show: (e) => io.current.show(e),
        reset: (s) => io.current.reset(s),
        events: (sid, after, signal) => sessionEvents(io.current.api, sid, after, signal),
        load: (sid) => loadSession(io.current.api, sid),
        current: () => session.current,
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      }),
    [],
  );
  const setSession = useCallback((id: string | null) => {
    if (id !== session.current) delivery.seen = 0;
    session.current = id;
    setSessionIdState(id);
  }, [delivery]);

  // Deleting the open conversation starts a new one (startNew is defined further down).
  const startNewRef = useRef<() => void>(() => {});
  const history = useHistory(auth.api, (id) => {
    if (session.current === id) startNewRef.current();
  });
  const refreshHistory = history.refresh;
  const flushHistory = history.flush;

  // ---- keeping to the end

  const scroll = useRef<ScrollView>(null);
  const pinned = useRef(true);
  const instant = useRef(false);
  const autoUntil = useRef(0);
  const anchor = useRef<string | null>(null);
  const toEnd = useCallback((animated: boolean) => {
    autoUntil.current = Date.now() + 450;
    scroll.current?.scrollToEnd({ animated });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() < autoUntil.current) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    pinned.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < PINNED_PX;
  }, []);
  const onContentSize = useCallback(() => {
    if (anchor.current || !pinned.current) return;
    toEnd(!instant.current);
    instant.current = false;
  }, [toEnd]);
  // A tool that arrives while they're following along is shown from its top, with the line before it in view.
  const onWidgetLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    if (anchor.current !== id) return;
    anchor.current = null;
    pinned.current = false;
    autoUntil.current = Date.now() + 450;
    scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 56), animated: true });
  }, []);

  // ---- the feed

  const push = useCallback((item: FeedItem) => setFeed((f) => [...f, item]), []);

  const handle = useCallback(
    (e: DreamEvent) => {
      if (e.type === "text") push({ id: nextId(), kind: "agent", text: e.text, fresh: true });
      else if (e.type === "step")
        setFeed((f) => (f.some((x) => x.kind === "step" && x.id === e.id) ? f.map((x) => (x.kind === "step" && x.id === e.id ? { ...x, text: e.text, state: e.state } : x)) : [...f, { id: e.id, kind: "step", text: e.text, state: e.state }]));
      else if (e.type === "widget") {
        const id = nextId();
        if (pinned.current) anchor.current = id;
        setFeed((f) => (f.some((x) => x.kind === "widget" && x.widget.id === e.widget.id) ? f.map((x) => (x.kind === "widget" && x.widget.id === e.widget.id ? { ...x, widget: e.widget } : x)) : [...f, { id, kind: "widget", widget: e.widget, live: true }]));
      } else if (e.type === "life") setLife(e.life);
      else if (e.type === "error") {
        haptic.error();
        push({ id: nextId(), kind: "agent", text: e.message, fresh: true });
      }
    },
    [push],
  );

  // ---- the Dandy's background work (api dream/jobs.ts)

  // Slow work (a car or home search, a builder, what a pick costs to keep) runs on the server beside the conversation
  // and keeps going with the app closed (owner, 2026-10-31: "users need to be able to leave the app completely and it
  // still works"). The chat follows its event log while it runs, and catches up when the app comes back; `delivery`
  // decides which of those shows what.

  /** The conversation as the server saved it, with a row for each piece of work still running. */
  const showSaved = useCallback((s: SessionDetail) => {
    instant.current = true;
    const rows: FeedItem[] = (s.running ?? []).filter((j) => j.label).map((j) => ({ id: `job_${j.id}`, kind: "step", text: j.label, state: "running" }));
    setFeed([...feedFromSession(s, nextId), ...rows]);
  }, []);
  io.current = { show: handle, reset: showSaved, api: auth.api };

  // ---- turns: one at a time, in the order they were asked for

  const pump = useCallback(async () => {
    if (running.current) return;
    const next = queue.current.shift();
    if (!next) return;
    const mine = gen.current;
    const ctrl = new AbortController();
    running.current = ctrl;
    const isQuiet = next.action.type === "swipe";
    // The turn's stream carries what running jobs show while it's open, starting with what the app missed; nothing else
    // shows events until it ends (review of #134).
    const turn = delivery.beginTurn();
    if (next.echo) {
      pinned.current = true;
      push({ id: nextId(), kind: "you", text: next.echo });
    }
    busyRef.current = true;
    setBusy(true);
    setQuiet(isQuiet);
    lastActive.current = Date.now();
    // Every turn is one of the Dandy's live tasks on the list. A swipe shows only if it turns into real work.
    let task: string | null = isQuiet ? null : startTask(taskFor(next.action));
    const late = isQuiet ? setTimeout(() => (task = startTask(taskFor(next.action))), 700) : null;
    const onEvent = (e: Numbered) => {
      if (gen.current !== mine || !turn.take(e)) return;
      lastActive.current = Date.now();
      // Known from the first event, so a stream that breaks can still be caught up on.
      if (e.type === "start" && session.current !== e.sessionId) setSession(e.sessionId);
      if (e.type === "step" && e.state === "running" && task) updateTask(task, e.text);
      handle(e);
    };
    try {
      // The stream begins with anything the app missed since the last number it saw.
      const sid = await dreamTurn(auth.apiStream, session.current, next.action, onEvent, { signal: ctrl.signal, name: dandyRef.current.name, ...(session.current ? { after: turn.after } : {}) });
      if (gen.current === mine) {
        if (sid) setSession(sid);
        // The turn is done but its jobs work on: follow them from here.
        turn.end(session.current);
      }
    } catch (e) {
      if (gen.current === mine && !ctrl.signal.aborted) {
        const sid = session.current;
        // The server finishes the turn with the phone gone: catch up on it instead of asking for it again.
        if (sid && lostConnection(e)) void delivery.recover(sid);
        else {
          haptic.error();
          push({ id: nextId(), kind: "agent", text: friendly(e, "I couldn't answer just now. Try again."), fresh: true });
        }
      }
    } finally {
      if (late) clearTimeout(late);
      if (task) endTask(task);
      if (running.current === ctrl) running.current = null;
      if (gen.current === mine) {
        lastActive.current = Date.now();
        // A step left running by a turn that stopped part way settles, so nothing spins forever; a background job's row
        // runs on until its own end comes in.
        const stale = (x: FeedItem) => x.kind === "step" && x.state === "running" && !x.id.startsWith("job_");
        setFeed((f) => (f.some(stale) ? f.map((x) => (stale(x) && x.kind === "step" ? { ...x, state: "done" } : x)) : f));
        if (!queue.current.length) {
          busyRef.current = false;
          setBusy(false);
          setQuiet(false);
          void refreshHistory();
        }
        void pump();
      }
    }
  }, [auth.apiStream, handle, push, setSession, refreshHistory, delivery]);

  const send = useCallback(
    (action: DreamAction, echo?: string) => {
      queue.current.push({ action, echo });
      void pump();
    },
    [pump],
  );

  const submit = useCallback(
    (t: string) => {
      const msg = t.trim();
      if (!msg) return;
      setHistoryOpen(false);
      if (!ready) {
        early.current.push(msg);
        return;
      }
      // Shown the moment it's sent, even while the Dandy is still answering or hunting (owner, 2026-10-29: "add more
      // while hunting"). Turns run one after another in the order they were sent.
      pinned.current = true;
      push({ id: nextId(), kind: "you", text: msg });
      send({ type: "message", text: msg });
    },
    [ready, send, push],
  );

  // What the composer sends arrives here, from the list or from this page. The composer never waits: a message sent
  // during a reply joins the queue.
  const stepRunning = feed.some((f) => f.kind === "step" && f.state === "running");
  useChatInbox(submit, false);
  // Wishes added on the New wish screen while it prices one join this queue too, in order (lib/wish-queue.ts).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => takeQueuedWishes((t) => submitRef.current(t)), []);

  // ---- conversations

  /** Leaves the current conversation: stops listening to a reply on its way (the server still finishes and saves it). */
  const leave = useCallback(() => {
    gen.current++;
    queue.current = [];
    running.current?.abort();
    running.current = null;
    delivery.leave();
    busyRef.current = false;
    setBusy(false);
    setQuiet(false);
    anchor.current = null;
    pinned.current = true;
    setFeed([]);
    // Card ids start again in every conversation, so what the last one saved is forgotten with it.
    setSavedFrom({});
    setSession(null);
  }, [setSession, delivery]);

  const startNew = useCallback(
    (fresh = true) => {
      leave();
      setHistoryOpen(false);
      lastActive.current = Date.now();
      if (fresh) refreshSuggestions();
    },
    [leave, refreshSuggestions],
  );

  const openSession = useCallback(
    async (id: string, opts: { quiet?: boolean } = {}) => {
      leave();
      setHistoryOpen(false);
      setOpening(true);
      const mine = gen.current;
      try {
        // Entered only if nothing took over while it loaded (leaving it too): a message sent meanwhile keeps its own
        // conversation.
        await delivery.open(id, setSession);
      } catch (e) {
        if (gen.current !== mine) return;
        if (!opts.quiet) push({ id: nextId(), kind: "agent", text: friendly(e, "I couldn't open that conversation. Try again."), fresh: true });
      } finally {
        if (gen.current === mine) setOpening(false);
        lastActive.current = Date.now();
      }
    },
    [leave, push, setSession, delivery],
  );

  startNewRef.current = () => startNew();

  // On open: pick up the latest conversation if it moved in the last hour, else start a new one.
  const started = useRef(false);
  useEffect(() => {
    if (auth.status !== "signedIn" || started.current) return;
    started.current = true;
    void (async () => {
      const list = await refreshHistory();
      const latest = list?.[0];
      if (latest && shouldResume(latest.updatedAt, Date.now())) await openSession(latest.id, { quiet: true });
      setReady(true);
    })();
  }, [auth.status, refreshHistory, openSession]);

  // Messages sent before the chat knew its conversation go now, in order.
  useEffect(() => {
    if (!ready || !early.current.length) return;
    const waiting = early.current;
    early.current = [];
    for (const msg of waiting) send({ type: "message", text: msg }, msg);
  }, [ready, send]);

  // Back after an hour or more without a word: a new conversation, with fresh suggestions. The old one is in History.
  useEffect(() => {
    const back = () => {
      const now = Date.now();
      if (!ready) return;
      if (!busyRef.current && idleTooLong(lastActive.current, now)) {
        lastActive.current = now;
        void refreshHistory();
        startNew();
        return;
      }
      // What the Dandy did while the app was away: replies, cards and jobs that finished meanwhile.
      const sid = session.current;
      if (sid && !running.current) void delivery.recover(sid);
    };
    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      const onVisible = () => document.visibilityState === "visible" && back();
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }
    const sub = AppState.addEventListener("change", (s) => s === "active" && back());
    return () => sub.remove();
  }, [ready, refreshHistory, startNew, delivery]);

  // History belongs to this page: turning it out of view closes it and sends any delete still waiting. In a spread the
  // chat can sit beside the list, still in view.
  const inView = pager.shows("chat");
  useEffect(() => {
    if (!inView && historyOpen) setHistoryOpen(false);
  }, [inView, historyOpen]);
  useEffect(() => {
    if (!historyOpen) flushHistory();
  }, [historyOpen, flushHistory]);

  const openHistory = useCallback(() => {
    Keyboard.dismiss();
    setHistoryOpen(true);
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    void auth
      .api("/me/life")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { life?: LifeContext } | null) => b?.life && setLife(b.life))
      .catch(() => {});
  }, [auth.status, auth]);

  // ---- rendering

  const onPhase = useCallback((id: string, working: boolean) => {
    setHunting((s) => {
      if (s.has(id) === working) return s;
      const next = new Set(s);
      if (working) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const asking = useMemo(() => askingWidget(feed), [feed]);
  const choosing = useMemo(() => askingChoices(feed), [feed]);
  const rows = useMemo(() => rowsOf(feed), [feed]);
  const lastSteps = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) if ("steps" in rows[i]!) return rows[i]!.key;
    return null;
  }, [rows]);
  const firstWords = feed.find((f) => f.kind === "you")?.text ?? history.sessions?.find((s) => s.id === sessionId)?.title ?? null;
  const empty = !feed.length;

  const renderWidget = (w: Widget, live: boolean): ReactNode => {
    switch (w.kind) {
      case "home_builder":
        return <HomeBuilder w={w} live={live} waiting={asking === w.id} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} onSearchNow={() => send({ type: "search_now", widgetId: w.id })} />;
      case "car_builder":
        return <CarBuilder w={w} live={live} waiting={asking === w.id} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} />;
      case "deck":
        return (
          <View style={{ gap: 10 }}>
            <Text style={[type.title3, { color: p.ink, paddingHorizontal: 4 }]}>{w.title}</Text>
            <SwipeDeck
              cards={w.cards}
              onSwipe={(l, verdict) => send({ type: "swipe", widgetId: w.id, listingId: l.id, verdict })}
              onPick={(l) => send({ type: "pick", widgetId: w.id, listingId: l.id }, l.title)}
              onSearchNow={() => send({ type: "search_now", widgetId: w.id })}
              onEnough={() => send({ type: "message", text: "That's enough, show me the best match." }, "That's enough, show me the best match.")}
            />
          </View>
        );
      case "service_quote":
        return <ServiceQuote w={w} onAccept={async () => send({ type: "pick", widgetId: w.id })} />;
      case "wish_ready": {
        const card = `${w.id}\n${w.wish.name}`;
        return (
          <WishReady
            w={w}
            listedId={listedWish(wishes, savedFrom[card], [w.wish.name])}
            onShowOnList={home.showOnList}
            onAdd={async () => {
              const saved = await add(wishFrom(w.wish));
              setSavedFrom((m) => ({ ...m, [card]: saved.id }));
            }}
          />
        );
      }
      case "item":
        // Hunted at once, in place: no button between the wish and its card. Its waiting music plays only while the chat
        // is in view.
        return <HuntCard id={w.id} text={w.text} watched={inView} onPhase={onPhase} onShowOnList={home.showOnList} />;
      case "list_change":
        // A change to their own list: nothing moves until they tap Apply.
        return <ListChangeCard w={w} onShowOnList={home.showOnList} />;
      case "choices":
        // The answers to the question above, to tap instead of typing: only while it's the question the Dandy is waiting
        // on, the newest one with nothing said after it, even with a hunt card opened beside it. A typed answer or a newer
        // question closes it, and a reopened chat whose last word is this question can still answer it (review
        // R44-CHOICES-OWNER).
        return <Choices options={w.options} live={choosing === w.id} onChoose={(o) => send({ type: "message", text: o }, o)} />;
      case "region_picker":
        // Only when the Dandy asks: where they live otherwise comes from Settings.
        return <RegionPicker current={life?.home ?? w.current} onPick={(place) => send({ type: "region", home: place }, `I'll live in ${place.label}.`)} />;
    }
  };

  const renderItem = (f: FeedItem, isLast: boolean): ReactNode => {
    switch (f.kind) {
      case "you":
        return (
          <Rise style={{ alignSelf: "flex-end", maxWidth: "86%" }}>
            <Glass style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.md }}>
              <Text style={[type.callout, { color: p.ink }]}>{f.text}</Text>
            </Glass>
          </Rise>
        );
      case "agent":
        return (
          <Rise style={{ maxWidth: "94%" }}>
            <View accessibilityLiveRegion={isLast && f.fresh ? "polite" : "none"}>
              <StreamText text={f.text} fresh={!!f.fresh} style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]} />
            </View>
          </Rise>
        );
      case "widget":
        return <Rise onLayout={(e) => onWidgetLayout(f.id, e)}>{renderWidget(f.widget, !!f.live)}</Rise>;
      default:
        return null;
    }
  };

  const column = { width: "100%", maxWidth: layout.column, alignSelf: "center" } as const;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: top, paddingHorizontal: gutter }}>
        <View style={[column, { height: HEADER, flexDirection: "row", alignItems: "center", gap: space[8] }]}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[8] }}>
            {!empty ? (
              <>
                <DandyAvatar dandy={dandy} size={22} />
                <Text accessibilityRole="header" style={[type.footnote, { flexShrink: 1, fontFamily: fonts.label, color: p.ink2 }]} numberOfLines={1}>
                  {firstWords ?? dandy.name}
                </Text>
              </>
            ) : null}
          </View>
          {!empty || sessionId ? <HeaderButton label="New chat" icon="plus" hint={`Starts a new conversation with ${dandy.name}`} onPress={() => startNew()} /> : null}
          <HeaderButton label="History" hint="Shows your past conversations" onPress={openHistory} />
        </View>
      </View>

      <KeyboardScroll
        ref={scroll}
        keepEnd
        dock={dock}
        onScroll={onScroll}
        onContentSizeChange={onContentSize}
        contentContainerStyle={{ paddingTop: space[16], paddingBottom: dockRoom(dock, insets.bottom), paddingHorizontal: gutter, gap: space[12], width: "100%", maxWidth: layout.column + 2 * gutter, alignSelf: "center" }}
      >
        {empty && ready && !opening ? <Greeting dandy={dandy} items={suggestions.items} loading={suggestions.loading} onPick={submit} /> : null}
        {rows.map((r, i) => (
          <Fragment key={r.key}>
            {"steps" in r ? (
              <Rise>
                <WorkLog steps={r.steps} live={busy && r.key === lastSteps} />
              </Rise>
            ) : (
              renderItem(r.item, i === rows.length - 1)
            )}
          </Fragment>
        ))}
        {(busy && !quiet && !stepRunning) || opening || (!ready && auth.status === "signedIn") ? (
          <Rise>
            <Working dandy={dandy} />
          </Rise>
        ) : null}
        {/* While a wish is still being found (owner, 2026-10-30: "prompt them if they want to add more onto the queue"):
            one quiet line under the cards, which puts the cursor in the composer; the queue never waits. */}
        {hunting.size > 0 && ready ? (
          <Rise>
            <AddAnotherPrompt onPress={home.focusComposer} />
          </Rise>
        ) : null}
      </KeyboardScroll>

      <HistorySheet
        open={historyOpen}
        top={top + HEADER - 4}
        bottom={dockRoom(dock, insets.bottom) - space[16]}
        side={gutter}
        dandyName={dandy.name}
        sessions={history.sessions}
        error={history.error}
        currentId={sessionId}
        pending={history.pending}
        onPick={(id) => (id === sessionId ? setHistoryOpen(false) : void openSession(id))}
        onDelete={history.remove}
        onUndo={history.undo}
        onNew={() => startNew()}
        onRetry={() => void refreshHistory()}
        onClose={() => setHistoryOpen(false)}
      />
    </View>
  );
}
