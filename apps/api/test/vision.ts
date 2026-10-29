/**
 * The photo hunt's model calls (apps/api/src/agent/photos.ts), for fakes whose tests are about something else: its web
 * search finds nothing, and both looks pick the wish out of every line-up. Null for any other call.
 */
export function visionReply(body: Record<string, any>): string | null {
  const format = body.text?.format?.name;
  if (String(body.instructions ?? "").startsWith("You find the best photograph of one wish")) return "Nothing found.";
  // These tests plan no lookalikes, so the line-up is the wish, then "none": option A is the wish.
  if (format === "photo_check") return JSON.stringify({ seen: "the very thing wished for", fits: ["A"], quality: "studio", clean: true });
  return null;
}
