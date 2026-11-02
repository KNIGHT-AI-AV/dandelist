/**
 * The waiting music for a card being made (lib/waiting.ts plays it; owner, 2026-11-02: "Music shouldn't ding or stop
 * until the image itself is found"). Since a card goes out the moment it is priced and its photo follows (#205), the
 * price landing is not the end: the music plays on until the card's checked photo is in, and the chime is that photo
 * landing. An amount or infinity needs no photo and lands as it is priced; a card whose hunt ends with no photo stops
 * quietly, with no chime, as the chat's card does.
 */
export type CardMusic = "waiting" | "landed" | "idle";

export function cardMusic({ priced, needsPhoto, photo, looking }: { priced: boolean; needsPhoto: boolean; photo: boolean; looking: boolean }): CardMusic {
  if (priced && (!needsPhoto || photo)) return "landed";
  return looking ? "waiting" : "idle";
}
