/**
 * Dandelist cost engine. Every number a person sees comes from here, never from a model.
 * Money is integer cents in, unrounded cents out; callers round with `roundCents` at display time.
 */

export type Cents = number;
export type Period = "week" | "month" | "year";

export interface Recurring {
  label?: string;
  amountCents: Cents;
  period: Period;
}

/** Financing for one item. The loan covers the item's price minus the deposit. */
export interface Loan {
  depositCents: Cents;
  /** Nominal annual rate as a fraction, e.g. 0.07 for 7%. */
  annualRate: number;
  termMonths: number;
  feesCents?: Cents;
}

export interface Item {
  id: string;
  /** Full purchase price, whether paid in cash or financed. */
  upfrontCents: Cents;
  recurring: Recurring[];
  /** Expected resale value at the end of the horizon, if any. */
  resaleCents?: Cents;
  loan?: Loan;
}

/** 52-week year, as the brief specifies. */
export const PERIODS_PER_YEAR: Record<Period, number> = { week: 52, month: 12, year: 1 };

export function roundCents(cents: number): Cents {
  return Math.round(cents);
}

export function annualRecurringCents(recurring: Recurring[]): Cents {
  return recurring.reduce((sum, r) => sum + r.amountCents * PERIODS_PER_YEAR[r.period], 0);
}

export function recurringBreakdown(items: Item[]): { perYear: number; perMonth: number; perWeek: number } {
  const perYear = items.reduce((sum, item) => sum + annualRecurringCents(item.recurring), 0);
  return { perYear, perMonth: perYear / 12, perWeek: perYear / 52 };
}

/** Cash leaving your account on day one: the full price, or only the deposit for a financed item. */
export function upfrontCashCents(items: Item[]): Cents {
  return items.reduce((sum, item) => sum + (item.loan ? item.loan.depositCents : item.upfrontCents), 0);
}

/** The sticker price of everything, regardless of how it is paid. */
export function upfrontPriceCents(items: Item[]): Cents {
  return items.reduce((sum, item) => sum + item.upfrontCents, 0);
}

export function loanPrincipalCents(item: Item): Cents {
  if (!item.loan) return 0;
  return Math.max(0, item.upfrontCents - item.loan.depositCents);
}

export function loanPaymentCents(principalCents: Cents, annualRate: number, termMonths: number): number {
  if (termMonths <= 0) throw new RangeError("termMonths must be positive");
  if (principalCents <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principalCents / termMonths;
  return (principalCents * r) / (1 - Math.pow(1 + r, -termMonths));
}

export interface LoanWindow {
  payment: number;
  paymentsMade: number;
  paidTotal: number;
  interestPaid: number;
  principalPaid: number;
  balanceLeft: number;
}

/** What a loan costs within the first `months` of its life. */
export function loanWithin(item: Item, months: number): LoanWindow {
  const principal = loanPrincipalCents(item);
  if (!item.loan || principal === 0) {
    return { payment: 0, paymentsMade: 0, paidTotal: 0, interestPaid: 0, principalPaid: 0, balanceLeft: 0 };
  }
  const { annualRate, termMonths } = item.loan;
  const payment = loanPaymentCents(principal, annualRate, termMonths);
  const r = annualRate / 12;
  const paymentsMade = Math.min(termMonths, Math.max(0, Math.floor(months)));
  let balance = principal;
  let interestPaid = 0;
  for (let i = 0; i < paymentsMade; i++) {
    const interest = balance * r;
    interestPaid += interest;
    balance = balance + interest - payment;
  }
  balance = Math.max(0, balance);
  return {
    payment,
    paymentsMade,
    paidTotal: payment * paymentsMade,
    interestPaid,
    principalPaid: principal - balance,
    balanceLeft: balance,
  };
}

/**
 * Cash that leaves your account over the horizon: deposits or cash prices, loan payments and fees made
 * inside the horizon, and running costs. A financed price is never counted twice.
 */
export function horizonCashOutlay(items: Item[], years: number): number {
  const months = years * 12;
  let total = 0;
  for (const item of items) {
    if (item.loan) {
      total += item.loan.depositCents + (item.loan.feesCents ?? 0) + loanWithin(item, months).paidTotal;
    } else {
      total += item.upfrontCents;
    }
    total += annualRecurringCents(item.recurring) * years;
  }
  return total;
}

/** A horizon total spread evenly over its months. An equivalent, never the actual monthly bill. */
export function equivalentMonthly(totalCents: number, years: number): number {
  if (years <= 0) throw new RangeError("years must be positive");
  return totalCents / (years * 12);
}

export interface OwnershipCost {
  price: Cents;
  interest: number;
  fees: Cents;
  running: number;
  resale: Cents;
  net: number;
}

/** What owning an item costs over the horizon: price, interest, fees and running costs, minus resale. */
export function ownershipCost(item: Item, years: number): OwnershipCost {
  const interest = item.loan ? loanWithin(item, years * 12).interestPaid : 0;
  const fees = item.loan?.feesCents ?? 0;
  const running = annualRecurringCents(item.recurring) * years;
  const resale = item.resaleCents ?? 0;
  return { price: item.upfrontCents, interest, fees, running, resale, net: item.upfrontCents + interest + fees + running - resale };
}

export function workHours(cents: number, netHourlyCents: Cents): number | null {
  if (netHourlyCents <= 0) return null;
  return cents / netHourlyCents;
}

/** Months until savings reach the target. Null when nothing is being saved. */
export function monthsToSave(targetCents: number, monthlySavingsCents: Cents, savedCents: Cents = 0): number | null {
  const remaining = targetCents - savedCents;
  if (remaining <= 0) return 0;
  if (monthlySavingsCents <= 0) return null;
  return remaining / monthlySavingsCents;
}

/** Pre-tax income needed to take home `netCents`, at an editable effective tax rate. */
export function grossIncomeEquivalent(netCents: number, taxRate: number): number {
  if (!(taxRate >= 0 && taxRate < 1)) throw new RangeError("taxRate must be at least 0 and below 1");
  return netCents / (1 - taxRate);
}

/** Net worth is what you own minus what you owe. A wishlist total is never part of it. */
export function netWorth(assetsCents: Cents[], liabilitiesCents: Cents[]): Cents {
  const sum = (xs: Cents[]) => xs.reduce((a, b) => a + b, 0);
  return sum(assetsCents) - sum(liabilitiesCents);
}
