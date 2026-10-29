/** The chip that opens a free answer wherever choices are offered (owner, 2026-10-29: "Jubilee is not here"). */
export const OWN = "Type your own";
/** Typed entries one builder section keeps; the server takes up to 16 styles or features in all. */
export const MAX_OWN = 6;

/**
 * Adds what someone typed to a builder section's own entries. When it names one of the section's choices, that
 * choice is picked instead of adding a copy; a blank, a repeat or a full section changes nothing.
 */
export function addOwn(text: string, choices: { id: string; label: string }[], own: string[]): { own: string[]; pick?: string } {
  const entry = text.trim().replace(/\s+/g, " ").slice(0, 40);
  const key = entry.toLowerCase();
  if (!entry) return { own };
  const known = choices.find((c) => c.label.toLowerCase() === key || c.id.toLowerCase() === key);
  if (known) return { own, pick: known.id };
  if (own.some((o) => o.toLowerCase() === key) || own.length >= MAX_OWN) return { own };
  return { own: [...own, entry] };
}
