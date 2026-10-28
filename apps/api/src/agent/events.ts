/**
 * Ledger events for the shopping and media tools. They travel as "note" steps that carry a structured `event`: the
 * app's ledger already draws every note, so an app that predates these events shows their text instead of
 * breaking, and a newer app can switch on `event.kind` for its own line.
 */
export type AgentEvent =
  /** Searched shops: one Google Shopping search and how many offers came back. */
  | { kind: "shop"; query: string; offers: number }
  /** Looked for 3D models on Sketchfab. */
  | { kind: "search3d"; query: string; found: number }
  /** Found photos for an option: how many, and the best one's size and source. */
  | { kind: "photos"; label: string; count: number; best?: { width: number; height: number; source: string } }
  /** Found a 3D model that truly matches. */
  | { kind: "model3d"; name: string; author: string }
  /** Image work with Meta's models: a SAM 3.1 cutout, a Muse Image upscale or a generated fallback picture. */
  | { kind: "imagework"; how: "cutout" | "upscaled" | "generated"; label: string; ok: boolean }
  /** The agent's own one-line reason for its next tool call, cleaned to plain text (agent.ts cleanThought). */
  | { kind: "thought"; text: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeEvent(e: AgentEvent): string {
  switch (e.kind) {
    case "shop":
      return e.offers ? `Searched shops for ${e.query}: ${plural(e.offers, "offer")}` : `Searched shops for ${e.query}: no offers`;
    case "search3d":
      return `Looked for a 3D model of ${e.query}: ${e.found ? plural(e.found, "candidate") : "none found"}`;
    case "photos":
      return `Found ${plural(e.count, "photo")} for ${e.label}${e.best ? `, the best ${e.best.width}×${e.best.height} from ${e.best.source}` : ""}`;
    case "model3d":
      return `Found a 3D model: ${e.name} by ${e.author}`;
    case "imagework":
      if (e.how === "cutout") return e.ok ? `Cut ${e.label} out of its photo with SAM 3.1` : `Couldn't cut ${e.label} out of its photo`;
      if (e.how === "upscaled") return e.ok ? `Sharpened a small photo of ${e.label} with Muse Image` : `Couldn't sharpen the photo of ${e.label}`;
      return e.ok ? `Made a picture of ${e.label} with Muse Image` : `Couldn't make a picture of ${e.label}`;
    case "thought":
      return e.text;
  }
}

export const eventStep = (event: AgentEvent, at: string) => ({ type: "note" as const, text: describeEvent(event), event, at });
