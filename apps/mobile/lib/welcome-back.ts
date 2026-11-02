/**
 * What the welcome says to someone signed in who comes back (components/welcome-back.tsx; owner, 2026-11-02: "When
 * users come back to the application, it shouldn't just take them to the straight homepage ... something that welcomes
 * them back"). Their own list, never a pitch: how many wishes it holds, and the one at the top behind the glass.
 */
export type WelcomeWish = {
  name: string;
  details?: { agent?: { imageUrl?: string } } | null;
};

/** The wish whose photograph stands behind the welcome: the first on the list that has a checked photo. */
export function heroWish<W extends WelcomeWish>(wishes: readonly W[]): W | null {
  return wishes.find((w) => !!w.details?.agent?.imageUrl) ?? null;
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
