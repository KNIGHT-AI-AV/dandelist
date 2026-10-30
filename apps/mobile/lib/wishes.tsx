import type { Media } from "./agent";
import type { Item, Period } from "@dandelist/cost";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./auth";

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

/** The signed-in person's wishes, kept on the server; this holds the copy on screen. */
export function WishProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, api } = useAuth();
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [status, setStatus] = useState<WishStore["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

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
  }, [api]);

  useEffect(() => {
    if (authStatus === "signedIn") void reload();
    if (authStatus === "signedOut") {
      setWishes([]);
      setStatus("idle");
    }
  }, [authStatus, reload]);

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
        return wish;
      },
      async remove(id) {
        const before = wishes;
        setWishes((ws) => ws.filter((x) => x.id !== id));
        const res = await api(`/wishes/${id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok || res?.status === 404) return;
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
    [wishes, status, error, reload, api],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useWishes(): WishStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWishes must be used inside WishProvider");
  return ctx;
}
