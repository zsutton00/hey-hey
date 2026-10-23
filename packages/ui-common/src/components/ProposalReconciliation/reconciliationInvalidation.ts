const listeners = new Map<string, Set<() => void>>();

export function invalidateProposalReconciliation(proposalId: string): void {
  listeners.get(proposalId)?.forEach((listener) => listener());
}

export function subscribeProposalReconciliation(
  proposalId: string,
  listener: () => void,
): () => void {
  const subscribers = listeners.get(proposalId) ?? new Set();
  subscribers.add(listener);
  listeners.set(proposalId, subscribers);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(proposalId);
  };
}
