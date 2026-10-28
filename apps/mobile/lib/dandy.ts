import { useEffect, useState } from "react";
import { setCurrentPersona, type PersonaId } from "./persona-state";
import { getSecret, setSecret } from "./storage";

/**
 * Your Dandy: the agent, named and styled by its owner (owner, 2026-10-28: no "your agent", no model names; people
 * give it a name, one of four personalities, a shape and a colour). The personality changes how it speaks; the API
 * receives its `voice` line with each request.
 */

export type { PersonaId };
export type ShapeId = "circle" | "square" | "diamond" | "capsule" | "leaf";

export interface Persona {
  id: PersonaId;
  name: string;
  line: string;
}

/** Four archetypes of the rich, named for what they are, never for anyone real. */
export const PERSONAS: Persona[] = [
  { id: "heir", name: "The Heir", line: "Discreet, dry wit, never in a hurry." },
  { id: "it-girl", name: "The It Girl", line: "Effusive, on trend, knows every opening." },
  { id: "old-money", name: "Old Money", line: "Quiet luxury. Buys once, buys well." },
  { id: "mogul", name: "The Mogul", line: "Bold, quick, thinks in moves." },
];

export const SHAPES: ShapeId[] = ["circle", "square", "diamond", "capsule", "leaf"];

/** Ten colours from the house palette: the themes' own accents and grounds, nothing off-brand. */
export const DANDY_COLORS: { id: string; name: string; hex: string; light: boolean }[] = [
  { id: "champagne", name: "Champagne", hex: "#CBA35C", light: true },
  { id: "emerald", name: "Emerald", hex: "#0E6B45", light: false },
  { id: "bordeaux", name: "Bordeaux", hex: "#7B1E33", light: false },
  { id: "sapphire", name: "Sapphire", hex: "#1C3F8F", light: false },
  { id: "onyx", name: "Onyx", hex: "#1B1B1E", light: false },
  { id: "ivory", name: "Ivory", hex: "#EDE6D8", light: true },
  { id: "rose", name: "Rose gold", hex: "#B76E79", light: true },
  { id: "platinum", name: "Platinum", hex: "#C7D0E2", light: true },
  { id: "amethyst", name: "Amethyst", hex: "#5E3A6E", light: false },
  { id: "cognac", name: "Cognac", hex: "#8A4B2A", light: false },
];

export interface Dandy {
  name: string;
  persona: PersonaId;
  shape: ShapeId;
  color: string;
}

export const DEFAULT_DANDY: Dandy = { name: "Dandy", persona: "old-money", shape: "circle", color: "champagne" };
export const DANDY_NAME_MAX = 20;

export const colorOf = (d: Pick<Dandy, "color">) => DANDY_COLORS.find((c) => c.id === d.color) ?? DANDY_COLORS[0]!;
export const personaOf = (d: Pick<Dandy, "persona">) => PERSONAS.find((p) => p.id === d.persona) ?? PERSONAS[2]!;

/** A name as typed, tidied: trimmed, one line, within the limit, and the default when left empty. */
export function cleanName(raw: string): string {
  const n = raw.replace(/\s+/g, " ").trim().slice(0, DANDY_NAME_MAX);
  return n || DEFAULT_DANDY.name;
}

const KEY = "dandelist.dandy";
let cached: Dandy | null = null;
const listeners = new Set<(d: Dandy) => void>();

export async function loadDandy(): Promise<Dandy> {
  if (cached) return cached;
  try {
    const raw = await getSecret(KEY);
    const d = raw ? (JSON.parse(raw) as Partial<Dandy>) : null;
    cached = d?.name ? { ...DEFAULT_DANDY, ...d } : DEFAULT_DANDY;
  } catch {
    cached = DEFAULT_DANDY;
  }
  setCurrentPersona(cached.persona);
  return cached;
}

export function saveDandy(d: Dandy): void {
  cached = { ...d, name: cleanName(d.name) };
  setCurrentPersona(cached.persona);
  void setSecret(KEY, JSON.stringify(cached));
  listeners.forEach((l) => l(cached!));
}

/** The Dandy on this device, kept current across screens. */
export function useDandy(): Dandy {
  const [d, setD] = useState<Dandy>(cached ?? DEFAULT_DANDY);
  useEffect(() => {
    void loadDandy().then(setD);
    listeners.add(setD);
    return () => void listeners.delete(setD);
  }, []);
  return d;
}
