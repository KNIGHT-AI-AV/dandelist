const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Formats cents as dollars; whole dollars when the amount has no cents. */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  return rounded % 100 === 0 ? usdWhole.format(rounded / 100) : usd.format(rounded / 100);
}

/** Parses what someone types ("$1,250.50", "99") into cents; null when it isn't a non-negative amount. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  return Math.round(Number(cleaned) * 100);
}
