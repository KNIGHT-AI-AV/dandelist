import type { Period } from "@dandelist/cost";
import type { WishKind } from "./wishes";

/** Shapes the API's wish agent returns. The app shows these numbers; it never asks the model for one. */

export interface Draft {
  title: string;
  kind: WishKind;
  summary: string;
  specifics: { name: string; value: string }[];
  region: string;
  currency: string;
  unknowns: string[];
}

export interface Question {
  question: string;
  choices: string[];
}

export interface Answer {
  question: string;
  answer: string;
}

export type Step =
  | { type: "search"; query: string; at: string }
  | { type: "open"; url: string; title?: string; ok: boolean; imageUrl?: string; at: string }
  | { type: "fx"; from: string; to: string; rate?: number; at: string }
  | { type: "check"; url: string; verified: boolean; at: string }
  | { type: "price"; label: string; upfrontCents?: number; at: string }
  | { type: "explain"; at: string }
  | { type: "note"; text: string; at: string };

export interface PriceOption {
  label: string;
  seller: string;
  url: string;
  upfrontCents: number;
  recurring: { label: string; amountCents: number; period: Period }[];
  source: { currency: string; price: number; rate: number; rateDate: string };
  status: "verified" | "estimate";
  evidence: string;
  confidence: "high" | "medium" | "low";
  imageUrl?: string;
  checkedAt: string;
  totals: { monthlyCents: number; horizonCents: number; spreadMonthlyCents: number };
}

export interface Run {
  id: string;
  status: "running" | "done" | "error";
  steps: Step[];
  result: { options: PriceOption[]; explanation: string; note: string; horizonYears: number } | null;
  error: string | null;
  cached?: boolean;
  createdAt: string;
}

type Api = (path: string, init?: RequestInit) => Promise<Response>;

async function read<T>(res: Response | null, fallback: string): Promise<T> {
  if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? fallback);
  return body;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function interpretWish(api: Api, text: string) {
  return read<{ draft: Draft; questions: Question[] }>(await api("/agent/interpret", json({ text })).catch(() => null), "Couldn't read that wish. Try again.");
}

export async function startResearch(api: Api, draft: Draft, answers: Answer[]) {
  return (await read<{ run: Run }>(await api("/agent/runs", json({ draft, answers })).catch(() => null), "Couldn't start the research.")).run;
}

export async function getRun(api: Api, id: string) {
  return (await read<{ run: Run }>(await api(`/agent/runs/${id}`).catch(() => null), "Lost track of the research.")).run;
}
