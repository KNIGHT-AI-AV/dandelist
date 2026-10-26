import type { Item, Period } from "@dandelist/cost";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type WishKind = "buy" | "do" | "visit" | "own";

export interface Wish {
  id: string;
  name: string;
  kind: WishKind;
  item: Item;
  createdAt: string;
}

export interface NewWish {
  name: string;
  kind: WishKind;
  upfrontCents: number;
  recurringCents: number;
  period: Period;
}

interface WishStore {
  wishes: Wish[];
  add(w: NewWish): Wish;
  remove(id: string): void;
}

const Ctx = createContext<WishStore | null>(null);

// Wishes live in memory until the wish API lands; the shape already matches what the server will store.
export function WishProvider({ children }: { children: ReactNode }) {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const store = useMemo<WishStore>(
    () => ({
      wishes,
      add(w) {
        const id = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const wish: Wish = {
          id,
          name: w.name.trim(),
          kind: w.kind,
          createdAt: new Date().toISOString(),
          item: {
            id,
            upfrontCents: w.upfrontCents,
            recurring: w.recurringCents > 0 ? [{ amountCents: w.recurringCents, period: w.period }] : [],
          },
        };
        setWishes((ws) => [wish, ...ws]);
        return wish;
      },
      remove(id) {
        setWishes((ws) => ws.filter((w) => w.id !== id));
      },
    }),
    [wishes],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useWishes(): WishStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWishes must be used inside WishProvider");
  return ctx;
}
