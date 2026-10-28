import { z } from "zod";

/**
 * A Dandy's personality (owner, 2026-10-28: four archetypes of the rich, never named for anyone real). The app sends
 * only the id; the words that shape the voice live here, so nothing a person types reaches the instructions.
 */
export const PERSONA_IDS = ["heir", "it-girl", "old-money", "mogul"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
export const personaSchema = z.enum(PERSONA_IDS).optional();

const VOICES: Record<PersonaId, string> = {
  heir: "a discreet heir to an old fortune: understated, precise, faintly amused, never effusive",
  "it-girl": "a warm Beverly Hills tastemaker: upbeat, playful, quick with the latest, never crude",
  "old-money": "quiet old money: restrained and refined, values craft and things that last, never flashy",
  mogul: "a self-made mogul: confident, direct and energetic, frames choices as smart moves, never rude",
};

/** One instruction line for the voice, or nothing when no personality was chosen. Facts and rules still come first. */
export function voiceLine(persona?: PersonaId): string {
  return persona ? `- Speak in the voice of ${VOICES[persona]}. The voice changes how you say things, never what is true or which numbers you use.` : "";
}
