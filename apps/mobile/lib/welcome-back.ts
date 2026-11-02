/**
 * What the welcome says to someone signed in who comes back (components/welcome-back.tsx; owner, 2026-11-02: "When
 * users come back to the application, it shouldn't just take them to the straight homepage ... something that welcomes
 * them back"). Their own list, never a pitch: how many wishes it holds, and one of them behind the glass.
 */
export type WelcomeWish = {
  id: string;
  name: string;
  details?: { agent?: { imageUrl?: string } } | null;
};

/** Where the welcome remembers which wish it showed, so the next one is another. */
export const LAST_HERO_KEY = "dandelist.welcome.hero";

/**
 * The wish whose photograph stands behind the welcome (owner, 2026-11-02: "one of their items randomly changing every
 * time"): a random one of the wishes with a checked photo, and never the one shown last time while there is another.
 */
export function heroWish<W extends WelcomeWish>(wishes: readonly W[], last: string | null, random: () => number = Math.random): W | null {
  const withPhoto = wishes.filter((w) => !!w.details?.agent?.imageUrl);
  const pool = withPhoto.length > 1 && last ? withPhoto.filter((w) => w.id !== last) : withPhoto;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}

/**
 * The two lines: a greeting, then their list in a few words. An empty list gets a plain start, since a guest's kept
 * wish joins it once the list opens; a list that hasn't loaded (null) gets the greeting alone.
 */
export function welcomeLines(wishes: readonly WelcomeWish[] | null): {
  title: string;
  line: string | null;
} {
  if (!wishes) return { title: "Welcome", line: null };
  const n = wishes.length;
  if (!n) return { title: "Welcome", line: "Your Dandelist starts here." };
  return {
    title: "Welcome back",
    line: `Your Dandelist so far · ${n} ${n === 1 ? "wish" : "wishes"}`,
  };
}
