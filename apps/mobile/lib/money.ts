export { formatCents } from "@dandelist/cost";

/** Parses what someone types ("$1,250.50", "99") into cents; null when it isn't a non-negative amount. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  return Math.round(Number(cleaned) * 100);
}
