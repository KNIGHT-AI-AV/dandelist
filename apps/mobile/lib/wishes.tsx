import type { Media } from "./agent";
import type { Category, Financing } from "./comfort";
import type { Item, Period } from "@dandelist/cost";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { analytics } from "./analytics";
import { priceBand } from "./analytics-config";
import { useAuth } from "./auth";
import { ordered } from "./list-order";
import { useRecheckOwner } from "./rechecks";
import { createWishSession, updateWishSession, whileCurrent } from "./wish-session";

export type WishKind = "buy" | "do" | "visit" | "own";
export type WishTier = "must" | "nice" | "dream";

export interface Wish {
  id: string;
  name: string;
  kind: WishKind;
  tier: WishTier;
  item: Item;
  /** What the agent found when the wish was researched: the chosen option, its source and the summary. */
  details: WishDetails;
  /** Why it matters to them, in their own words; only they see it, and their Dandy keeps it in mind. */
  note?: string | null;
  createdAt: string;
}

export interface WishDetails {
  agent?: {
    runId: string;
    seller: string;
    url: string;
    status: "verified" | "estimate";
    checkedAt: string;
    imageUrl?: string;
    /** The photos, cutout and 3D model the agent found for it (real photos first). */
    media?: Media;
    explanation: string;
    source: { currency: string; price: number; rate: number; rateDate: string };
  };
  /** One plain sentence about the wish, written by the API (POST /wishes/describe) so search understands meaning. */
  about?: string;
  /** Up to five lowercase tags from the same call. */
  tags?: string[];
  /**
   * A wish no shop prices (lib/worth.ts): "money", whose upfront cost is the amount the person picked, or
   * "priceless", saved at zero, shown as infinity and left out of every total.
   */
  worth?: "money" | "priceless";
  /** A priceless wish's line, written by the Dandy when it read the wish. */
  line?: string;
  /**
   * What the wish may take of a year's income, judged by the same call as `about` for the tier it had then: its kind
   * of purchase, how it is paid for and the share (lib/comfort.ts does the sums). `why` is kept, not shown yet.
   */
  comfort?: { category: Category; financing: Financing; share: number; why: string; tier: WishTier; at: string };
}

export interface NewWish {
  name: string;
  kind: WishKind;
  tier: WishTier;
  upfrontCents: number;
  recurringCents: number;
  period: Period;
  /** Itemised running costs; when given, these replace recurringCents. */
  recurring?: { amountCents: number; period: Period; label?: string }[];
  details?: WishDetails;
}

interface WishStore {
  wishes: Wish[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  reload(): Promise<void>;
  add(w: NewWish): Promise<Wish>;
  remove(id: string): Promise<void>;
  /** Moves a wish to another tier. Shows at once; goes back if the server says no. */
  setTier(id: string, tier: WishTier): Promise<void>;
  /** Puts these wishes first, in this order, the rest after them as they were. Shows at once; goes back if the server says no. */
  reorder(ids: string[]): Promise<void>;
  /**
   * Folds details the server has already saved (a description) into the wish on screen, with no request and no
   * reload, so nothing else on screen is disturbed.
   */
  mergeDetails(id: string, change: Partial<WishDetails>): void;
  /** Saves a new photo on a wish (a retake). Shows at once; goes back if the server says no. */
  setPhoto(id: string, photo: { imageUrl: string; media: Media }): Promise<void>;
  /** Saves why the wish matters to them (null clears it). The copy on screen changes once the server has it. */
  setNote(id: string, note: string | null): Promise<void>;
}

type ServerWish = {
  id: string;
  name: string;
  kind: WishKind;
  tier: WishTier;
  upfrontCents: number;
  recurring: { amountCents: number; period: Period }[];
  resaleCents: number | null;
  details: WishDetails | null;
  note?: string | null;
  createdAt: string;
};

const fromServer = (w: ServerWish): Wish => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  tier: w.tier,
  createdAt: w.createdAt,
  details: w.details ?? {},
  note: w.note ?? null,
  item: { id: w.id, upfrontCents: w.upfrontCents, recurring: w.recurring, ...(w.resaleCents === null ? {} : { resaleCents: w.resaleCents }) },
});

async function failure(res: Response | null, fallback: string): Promise<Error> {
  if (!res) return new Error("Can't reach Dandelist. Check your connection.");
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

const Ctx = createContext<WishStore | null>(null);
type WishState = Pick<WishStore, "wishes" | "status" | "error">;
const emptyState = (): WishState => ({ wishes: [], status: "idle", error: null });

/** The signed-in person's wishes, kept on the server; this holds the copy on screen. */
export function WishProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user, api } = useAuth();
  const owner = authStatus === "signedIn" ? user?.id ?? null : null;
  // Price checks and "what you meant" looks belong to this sign-in too (lib/rechecks.ts).
  useRecheckOwner();
  const [session, setSession] = useState(() => createWishSession(owner, emptyState()));
  let current = session;
  if (session.scope.owner !== owner) {
    // Reset this provider before children render, without remounting their navigation/local state.
    current = createWishSession(owner, emptyState());
    setSession(current);
  }
  const { scope } = current;
  // The sign-in now, for completions to check against (wish-session.ts whileCurrent).
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const { wishes, status, error } = current.value;
  const update = useCallback((change: (value: WishState) => WishState) => {
    setSession((latest) => updateWishSession(latest, scope, change));
  }, [scope]);
  const setWishes = useCallback((next: SetStateAction<Wish[]>) => {
    update((value) => ({ ...value, wishes: typeof next === "function" ? next(value.wishes) : next }));
  }, [update]);
  const setStatus = useCallback((next: WishState["status"]) => {
    update((value) => ({ ...value, status: next }));
  }, [update]);
  const setError = useCallback((next: WishState["error"]) => {
    update((value) => ({ ...value, error: next }));
  }, [update]);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const res = await api("/wishes").catch(() => null);
    if (!res?.ok) {
      setError((await failure(res, "Couldn't load your wishes.")).message);
      setStatus("error");
      return;
    }
    setWishes(((await res.json()) as { wishes: ServerWish[] }).wishes.map(fromServer));
    setStatus("ready");
  }, [api, setWishes, setStatus, setError]);

  useEffect(() => {
    if (owner !== null) void reload();
  }, [owner, reload]);

  const store = useMemo<WishStore>(
    () => ({
      wishes,
      status,
      error,
      reload,
      async add(w) {
        const res = await api("/wishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: w.name.trim(),
            kind: w.kind,
            tier: w.tier,
            upfrontCents: w.upfrontCents,
            recurring: w.recurring ?? (w.recurringCents > 0 ? [{ amountCents: w.recurringCents, period: w.period }] : []),
            ...(w.details ? { details: w.details } : {}),
          }),
        }).catch(() => null);
        if (!res?.ok) throw await failure(res, "Couldn't save the wish.");
        const wish = fromServer(((await res.json()) as { wish: ServerWish }).wish);
        setWishes((ws) => [wish, ...ws]);
        // What kind of wish and how big, never its name; told only under the sign-in that added it.
        whileCurrent(() => scopeNow.current, scope, () =>
          analytics.capture("wish_added", { kind: wish.kind, tier: wish.tier, price: priceBand(wish.item.upfrontCents), running_costs: wish.item.recurring.length > 0, worth: wish.details.worth ?? null, from_agent: !!wish.details.agent }),
        );
        return wish;
      },
      async remove(id) {
        const before = wishes;
        setWishes((ws) => ws.filter((x) => x.id !== id));
        const res = await api(`/wishes/${id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok || res?.status === 404) return whileCurrent(() => scopeNow.current, scope, () => analytics.capture("wish_removed", { kind: before.find((x) => x.id === id)?.kind ?? null }));
        setWishes(before);
        throw await failure(res, "Couldn't remove the wish.");
      },
      async setTier(id, tier) {
        const was = wishes.find((x) => x.id === id)?.tier;
        if (!was || was === tier) return;
        setWishes((ws) => ws.map((x) => (x.id === id ? { ...x, tier } : x)));
        const res = await api(`/wishes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        }).catch(() => null);
        if (res?.ok) return;
        // Only undo this change: a later tap may already have moved the wish on.
        setWishes((ws) => ws.map((x) => (x.id === id && x.tier === tier ? { ...x, tier: was } : x)));
        throw await failure(res, "Couldn't save the wish.");
      },
      async reorder(ids) {
        const before = wishes;
        setWishes((ws) => ordered(ws, ids));
        const res = await api("/wishes/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
        if (res?.ok) return;
        setWishes(before);
        throw await failure(res, "Couldn't save the new order.");
      },
      mergeDetails(id, change) {
        setWishes((ws) => ws.map((x) => (x.id === id ? { ...x, details: { ...x.details, ...change } } : x)));
      },
      async setPhoto(id, photo) {
        const was = wishes.find((x) => x.id === id);
        if (!was) return;
        const details = { ...was.details, agent: { ...(was.details.agent ?? {}), imageUrl: photo.imageUrl, media: photo.media } } as WishDetails;
        setWishes((ws) => ws.map((x) => (x.id === id ? { ...x, details } : x)));
        const res = await api(`/wishes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ details }) }).catch(() => null);
        if (res?.ok) return;
        setWishes((ws) => ws.map((x) => (x.id === id && x.details === details ? { ...x, details: was.details } : x)));
        throw await failure(res, "Couldn't save the new photo.");
      },
      async setNote(id, note) {
        const res = await api(`/wishes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).catch(() => null);
        if (!res?.ok) throw await failure(res, "Couldn't save your note.");
        const saved = fromServer(((await res.json()) as { wish: ServerWish }).wish).note;
        setWishes((ws) => ws.map((x) => (x.id === id ? { ...x, note: saved } : x)));
      },
    }),
    [wishes, status, error, reload, api, setWishes, scope],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useWishes(): WishStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWishes must be used inside WishProvider");
  return ctx;
}
