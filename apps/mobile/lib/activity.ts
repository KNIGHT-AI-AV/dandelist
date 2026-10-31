import { useMemo, useSyncExternalStore } from "react";

/**
 * What the Dandy is doing right now, for the list's Dandy area (owner, recording 03: "live tasks the agent is doing,
 * fading between multiple until done"). Anything that runs agent work (a chat turn, a price check, a new wish being
 * priced) starts a task here and ends it when the work is done; the list shows them in turn, or a quote when idle.
 */
export interface Task {
  id: string;
  /** Present tense, a few words: "Checking the price of the Leica Q3". */
  text: string;
  startedAt: number;
  /** The account whose things the line names (a saved wish's name, say): no one else sees it. */
  account?: string;
}

let tasks: readonly Task[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startTask(text: string, account?: string): string {
  const id = `t${++seq}`;
  tasks = [...tasks, { id, text, startedAt: Date.now(), ...(account ? { account } : {}) }];
  emit();
  return id;
}

export function updateTask(id: string, text: string): void {
  if (!tasks.some((t) => t.id === id && t.text !== text)) return;
  tasks = tasks.map((t) => (t.id === id ? { ...t, text } : t));
  emit();
}

export function endTask(id: string): void {
  if (!tasks.some((t) => t.id === id)) return;
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}

/** Runs `work` as a task: shown while it runs, gone when it settles either way. */
export async function asTask<T>(text: string, work: (update: (text: string) => void) => Promise<T>): Promise<T> {
  const id = startTask(text);
  try {
    return await work((next) => updateTask(id, next));
  } finally {
    endTask(id);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * The tasks on screen. Given the account signed in now (null when nobody is), a line naming another account's things
 * is left out from the first render after a sign-in change, before its work has stopped and ended it (review of #131).
 */
export function useTasks(account?: string | null): readonly Task[] {
  const all = useSyncExternalStore(subscribe, () => tasks, () => tasks);
  return useMemo(() => (account === undefined ? all : all.filter((t) => t.account === undefined || t.account === account)), [all, account]);
}

/** For tests. */
export function currentTasks(): readonly Task[] {
  return tasks;
}
