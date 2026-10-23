/**
 * In-memory cache of per-proposal selected state. Keyed by proposalId.
 *
 * Lives at module scope as a plain Map so the data is wiped on full-page
 * refresh (no localStorage / sessionStorage / IndexedDB). Lets multiple
 * components rendering the same proposal id stay in sync without lifting
 * state, and lets a renderer remember whether a proposal has been applied
 * or rejected even when the proposal payload coming back from the server
 * still reads as Pending/Draft.
 */

export type ProposalLifecycleEntry = "applied" | "rejected";

export interface ProposalCacheEntry {
  lifecycle: ProposalLifecycleEntry;
  newEntityId?: string;
}

type Listener = () => void;

const entries = new Map<string, ProposalCacheEntry>();
const listeners = new Map<string, Set<Listener>>();

function notify(id: string): void {
  const set = listeners.get(id);
  if (!set) return;
  for (const listener of set) {
    listener();
  }
}

export function getEntry(id: string): ProposalCacheEntry | undefined {
  return entries.get(id);
}

export function setLifecycle(
  id: string,
  lifecycle: ProposalLifecycleEntry
): void {
  const prior = entries.get(id);
  entries.set(id, { ...prior, lifecycle });
  // Stage readiness debug: inspect the updated entry and subscribers before notification.
  
  notify(id);
}

export function setNewEntityId(id: string, newEntityId: string): void {
  const prior = entries.get(id);
  if (!prior) {
    entries.set(id, { lifecycle: "applied", newEntityId });
  } else if (prior.newEntityId === newEntityId) {
    return;
  } else {
    entries.set(id, { ...prior, newEntityId });
  }
  notify(id);
}

export function subscribe(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(id);
    }
  };
}

export function __resetForTests(): void {
  entries.clear();
  listeners.clear();
}
