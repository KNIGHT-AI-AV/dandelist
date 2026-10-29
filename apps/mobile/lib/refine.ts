import type { Answer, WishQuestion } from "./agent";

/**
 * Changing the answers a hunt used (owner, 2026-10-29): the agent picks the likely answer to each question so nothing
 * waits on the person; they may change any, or type their own, and hunt again. `edits` holds what they changed on the
 * card and haven't hunted with yet, by question id.
 */

/** The answer a question shows now: the person's change, else what the hunt used. */
export const answerOf = (q: WishQuestion, edits: Record<string, string>) => edits[q.id] ?? q.picked;

/** True when some answer was changed to something new, so another hunt would differ. */
export const refineChanged = (questions: WishQuestion[], edits: Record<string, string>) =>
  questions.some((q) => {
    const v = edits[q.id]?.trim();
    return !!v && v !== q.picked;
  });

/** Every answer the person gave, now or on an earlier hunt, by question id; the agent keeps its own picks for the rest. */
export function answersFrom(questions: WishQuestion[], edits: Record<string, string>): Answer[] {
  return questions.flatMap((q) => {
    const v = (edits[q.id] ?? (q.answered ? q.picked : "")).trim().slice(0, 200);
    return v ? [{ question: q.id, answer: v }] : [];
  });
}

/** The questions with those answers in place, so a draft sent to hunt again (or retried) carries them. */
export const withGiven = (questions: WishQuestion[], answers: Answer[]): WishQuestion[] =>
  questions.map((q) => {
    const a = answers.find((x) => x.question === q.id);
    return a ? { ...q, picked: a.answer, answered: true } : q;
  });
