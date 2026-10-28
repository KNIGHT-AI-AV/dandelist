import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_URL, useAuth } from "./auth";
import { CURRENCIES, FALLBACK_RATES, formatCompact, formatIn, isCurrency, readRates, symbolOf, toLocal, toUsd, unitOf, type CurrencyCode, type Rates } from "./fx";
import { getSecret, setSecret } from "./storage";

export { CURRENCIES, type CurrencyCode };

const CHOICE_KEY = "dandelist.currency";
const RATES_KEY = "dandelist.rates";

export interface Money {
  code: CurrencyCode;
  /** Units of `code` per US dollar today. */
  rate: number;
  /** "€183,000" from US cents. */
  format(usdCents: number): string;
  /** "€183K", for incomes and tight places. */
  compact(usdCents: number): string;
  symbol: string;
  /** Ladders count in this many whole units (100 for yen, 10 for yuan, 1 elsewhere). */
  unit: number;
  toLocal(usdCents: number): number;
  toUsd(localCents: number): number;
  /** Chooses the currency on this device and, when signed in, for the agent's pricing too. */
  choose(code: CurrencyCode): void;
}

let current = { code: "USD" as CurrencyCode, rate: 1 };
/** The same formatting outside React (a string built in a callback). */
export const formatMoney = (usdCents: number) => formatIn(current.code, current.rate, usdCents);

const Ctx = createContext<Money | null>(null);

type Life = { home: unknown; currency: string };

/**
 * The currency every figure is shown in (owner, recording 03: "5 top currencies starting with USD... they change
 * all pricing"). Wishes stay in US cents; this converts at the day's ECB rate from the API. The choice lives on the
 * device, and on the account's life context once signed in, which is what the agent prices in.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [code, setCode] = useState<CurrencyCode>("USD");
  const [rates, setRates] = useState<Rates>(FALLBACK_RATES);
  const [loaded, setLoaded] = useState(false);
  // Chosen here on purpose (onboarding or settings), as opposed to the default.
  const chosen = useRef(false);

  useEffect(() => {
    void (async () => {
      const saved = await getSecret(CHOICE_KEY);
      if (isCurrency(saved)) {
        chosen.current = true;
        setCode(saved);
      }
      const cached = readRates(JSON.parse((await getSecret(RATES_KEY)) ?? "null"));
      if (cached) setRates(cached);
      setLoaded(true);
    })().catch(() => setLoaded(true));
    void fetch(`${API_URL}/fx`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const fresh = readRates(body);
        if (!fresh) return;
        setRates(fresh);
        void setSecret(RATES_KEY, JSON.stringify({ rates: fresh }));
      })
      .catch(() => {});
  }, []);

  // Pushes a choice to the account so the agent prices in it. The life context needs its home with it.
  const push = useCallback(
    async (next: CurrencyCode) => {
      const res = await auth.api("/me/life").catch(() => null);
      const life = res?.ok ? ((await res.json()) as { life?: Life }).life : null;
      if (!life || life.currency === next) return;
      await auth.api("/me/life", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ home: life.home ?? null, currency: next }) }).catch(() => null);
    },
    [auth],
  );

  // Once signed in: a choice made on this device wins; otherwise the account's currency shows, if it's one of the five.
  useEffect(() => {
    if (!loaded || auth.status !== "signedIn") return;
    if (chosen.current) {
      void push(code);
      return;
    }
    void auth
      .api("/me/life")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { life?: Life } | null) => {
        if (!chosen.current && isCurrency(b?.life?.currency)) setCode(b!.life!.currency as CurrencyCode);
      })
      .catch(() => {});
    // `code` is read at sign-in only; later changes push from `choose`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, auth.status]);

  const choose = useCallback(
    (next: CurrencyCode) => {
      chosen.current = true;
      setCode(next);
      void setSecret(CHOICE_KEY, next);
      if (auth.status === "signedIn") void push(next);
    },
    [auth.status, push],
  );

  const rate = rates[code];
  current = { code, rate };
  const value = useMemo<Money>(
    () => ({
      code,
      rate,
      format: (c) => formatIn(code, rate, c),
      compact: (c) => formatCompact(code, rate, c),
      symbol: symbolOf(code),
      unit: unitOf(code),
      toLocal: (c) => toLocal(c, rate),
      toUsd: (c) => toUsd(c, rate),
      choose,
    }),
    [code, rate, choose],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Outside the provider (tests, the lab) money shows in dollars. */
const DOLLARS: Money = {
  code: "USD",
  rate: 1,
  format: (c) => formatIn("USD", 1, c),
  compact: (c) => formatCompact("USD", 1, c),
  symbol: "$",
  unit: 1,
  toLocal: (c) => c,
  toUsd: (c) => c,
  choose: () => {},
};

export function useMoney(): Money {
  return useContext(Ctx) ?? DOLLARS;
}
