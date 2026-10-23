import isEqual from "lodash/isEqual.js";
import type { PaginatedAgentSessionItemDto } from "../../api";
import type { PaginatedAgentSessionsPage } from "../collections/agentSessions";

export interface AgentSessionSnapshot {
  items: PaginatedAgentSessionItemDto[];
  nextCursor: string | null;
  acceptedPages: ReadonlyMap<string, readonly string[]>;
  hasPendingUpdates: boolean;
}

export const emptyAgentSessionSnapshot = (): AgentSessionSnapshot => ({
  items: [],
  nextCursor: null,
  acceptedPages: new Map(),
  hasPendingUpdates: false,
});

export function acceptAgentSessionPage(
  snapshot: AgentSessionSnapshot,
  pageKey: string,
  page: PaginatedAgentSessionsPage
): AgentSessionSnapshot {
  const seen = new Set(snapshot.items.map((item) => item.agentSession.id));
  const appended = page.items.filter((item) => {
    if (seen.has(item.agentSession.id)) return false;
    seen.add(item.agentSession.id);
    return true;
  });
  return {
    ...snapshot,
    items: [...snapshot.items, ...appended],
    nextCursor: page.nextCursor,
    acceptedPages: new Map(snapshot.acceptedPages).set(
      pageKey,
      page.items.map((item) => item.agentSession.id)
    ),
  };
}

// Refreshes patch fields, never membership, order, or the accepted cursor.
export function reconcileAgentSessionPage(
  snapshot: AgentSessionSnapshot,
  pageKey: string,
  page: PaginatedAgentSessionsPage
): AgentSessionSnapshot {
  const accepted = snapshot.acceptedPages.get(pageKey);
  if (!accepted) return snapshot;
  const refreshed = new Map(
    page.items.map((item) => [item.agentSession.id, item])
  );
  const items = snapshot.items.map(
    (item) => refreshed.get(item.agentSession.id) ?? item
  );
  const hasPendingUpdates =
    snapshot.hasPendingUpdates ||
    !isEqual(
      accepted,
      page.items.map((item) => item.agentSession.id)
    );
  if (
    hasPendingUpdates === snapshot.hasPendingUpdates &&
    isEqual(items, snapshot.items)
  ) {
    return snapshot;
  }
  return { ...snapshot, items, hasPendingUpdates };
}
