import { useSyncExternalStore } from "react";

export interface MinimizedModalWork {
  id: string;
  title: string;
  restore: () => void;
  ownerKey: string | undefined;
}

let work: readonly MinimizedModalWork[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

export function registerMinimizedWork(entry: MinimizedModalWork) {
  work = [...work.filter((item) => item.id !== entry.id), entry];
  publish();
  return () => {
    work = work.filter((item) => item.id !== entry.id);
    publish();
  };
}

/** Reopening an owner restores its mounted work instead of initializing it again. */
export function restoreModalWork(ownerKey: string): boolean {
  const existing = work.filter((item) => item.ownerKey === ownerKey);
  existing.forEach((item) => item.restore());
  return existing.length > 0;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => work;
export const useMinimizedModalWork = () =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
