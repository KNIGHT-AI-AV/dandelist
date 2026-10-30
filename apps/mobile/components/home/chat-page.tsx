import { router } from "expo-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, Keyboard, Platform, Pressable, Text, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Greeting } from "../chat/greeting";
import { HistorySheet } from "../chat/history-sheet";
import { HuntCard } from "../chat/hunt-card";
import { useHistory } from "../chat/use-history";
import { StreamText, WorkLog, Working, type StepLine } from "../chat/working";
import { DandyAvatar } from "../dandy-avatar";
import { CarBuilder, HomeBuilder, RegionPicker } from "../dream/builders";
import { SwipeDeck } from "../dream/deck";
import { ServiceQuote, WishReady } from "../dream/quotes";
import { KeyboardScroll, dockRoom } from "../inputs";
import { Glass, Icon, PrimaryButton } from "../lux";
import { Rise } from "../welcome/kit";
import { endTask, startTask, updateTask } from "../../lib/activity";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import {
  dreamTurn,
  feedFromSession,
  idleTooLong,
  loadSession,
  shouldResume,
  taskFor,
  wishFrom,
  type DreamAction,
  type DreamEvent,
  type FeedItem,
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
  const { width } = useWindowDimensions();
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

  const setSession = useCallback((id: string | null) => {
    session.current = id;
    setSessionIdState(id);
  }, []);

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
        setFeed((f) => (f.some((x) => x.kind === "widget" && x.widget.id === e.widget.id) ? f.map((x) => (x.kind === "widget" && x.widget.id === e.widget.id ? { ...x, widget: e.widget } : x)) : [...f, { id, kind: "widget", widget: e.widget }]));
      } else if (e.type === "life") setLife(e.life);
      else if (e.type === "error") {
        haptic.error();
        push({ id: nextId(), kind: "agent", text: e.message, fresh: true });
      }
    },
    [push],
  );

  // ---- turns: one at a time, in the order they were asked for

  const pump = useCallback(async () => {
    if (running.current) return;
    const next = queue.current.shift();
    if (!next) return;
    const mine = gen.current;
    const ctrl = new AbortController();
    running.current = ctrl;
    const isQuiet = next.action.type === "swipe";
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
    const onEvent = (e: DreamEvent) => {
      if (gen.current !== mine) return;
      lastActive.current = Date.now();
      if (e.type === "step" && e.state === "running" && task) updateTask(task, e.text);
      handle(e);
    };
    try {
      const sid = await dreamTurn(auth.apiStream, session.current, next.action, onEvent, { signal: ctrl.signal, name: dandyRef.current.name });
      if (gen.current === mine && sid) setSession(sid);
    } catch (e) {
      if (gen.current === mine && !ctrl.signal.aborted) {
        haptic.error();
        push({ id: nextId(), kind: "agent", text: friendly(e, "I couldn't answer just now. Try again."), fresh: true });
      }
    } finally {
      if (late) clearTimeout(late);
      if (task) endTask(task);
      if (running.current === ctrl) running.current = null;
      if (gen.current === mine) {
        lastActive.current = Date.now();
        // A step left running by a turn that stopped part way settles, so nothing spins forever.
        setFeed((f) => (f.some((x) => x.kind === "step" && x.state === "running") ? f.map((x) => (x.kind === "step" && x.state === "running" ? { ...x, state: "done" } : x)) : f));
        if (!queue.current.length) {
          busyRef.current = false;
          setBusy(false);
          setQuiet(false);
          void refreshHistory();
        }
        void pump();
      }
    }
  }, [auth.apiStream, handle, push, setSession, refreshHistory]);

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

  // ---- conversations

  /** Leaves the current conversation: stops listening to a reply on its way (the server still finishes and saves it). */
  const leave = useCallback(() => {
    gen.current++;
    queue.current = [];
    running.current?.abort();
    running.current = null;
    busyRef.current = false;
    setBusy(false);
    setQuiet(false);
    anchor.current = null;
    pinned.current = true;
    setFeed([]);
    setSession(null);
  }, [setSession]);

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
        const s = await loadSession(auth.api, id);
        if (gen.current !== mine) return;
        instant.current = true;
        setFeed(feedFromSession(s, nextId));
        setSession(s.id);
      } catch (e) {
        if (gen.current !== mine) return;
        if (!opts.quiet) push({ id: nextId(), kind: "agent", text: friendly(e, "I couldn't open that conversation. Try again."), fresh: true });
      } finally {
        if (gen.current === mine) setOpening(false);
        lastActive.current = Date.now();
      }
    },
    [auth.api, leave, push, setSession],
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
      if (!ready || busyRef.current || !idleTooLong(lastActive.current, now)) return;
      lastActive.current = now;
      void refreshHistory();
      startNew();
    };
    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      const onVisible = () => document.visibilityState === "visible" && back();
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }
    const sub = AppState.addEventListener("change", (s) => s === "active" && back());
    return () => sub.remove();
  }, [ready, refreshHistory, startNew]);

  // History belongs to this page: turning away closes it and sends any delete still waiting.
  useEffect(() => {
    if (pager.page !== "chat" && historyOpen) setHistoryOpen(false);
  }, [pager.page, historyOpen]);
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

  const owned = useMemo(() => new Set(wishes.map((w) => w.name.trim().toLowerCase())), [wishes]);
  const rows = useMemo(() => rowsOf(feed), [feed]);
  const lastSteps = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) if ("steps" in rows[i]!) return rows[i]!.key;
    return null;
  }, [rows]);
  const firstWords = feed.find((f) => f.kind === "you")?.text ?? history.sessions?.find((s) => s.id === sessionId)?.title ?? null;
  const empty = !feed.length;

  const renderWidget = (w: Widget): ReactNode => {
    switch (w.kind) {
      case "home_builder":
        return <HomeBuilder w={w} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} onSearchNow={() => send({ type: "search_now", widgetId: w.id })} />;
      case "car_builder":
        return <CarBuilder w={w} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} />;
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
      case "wish_ready":
        return <WishReady w={w} already={owned.has(w.wish.name.trim().toLowerCase())} onAdd={async () => void (await add(wishFrom(w.wish)))} />;
      case "item":
        // Hunted at once, in place: no button between the wish and its card. Its waiting music plays only while the chat
        // is the page in front.
        return <HuntCard id={w.id} text={w.text} already={owned.has(w.text.trim().toLowerCase())} watched={pager.page === "chat"} />;
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
        return <Rise onLayout={(e) => onWidgetLayout(f.id, e)}>{renderWidget(f.widget)}</Rise>;
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
