import type { PaginatedAgentSessionItemDto } from "@hey-hey/ui-common/api";
import { useRef } from "react";

type Item = PaginatedAgentSessionItemDto;

function selectItems(
  items: Item[],
  search: string,
  sortBy: string | undefined,
): Item[] {
  const selected = items.filter((item) =>
    [
      item.agentSession.title,
      item.parentEntity?.name,
      ...item.services.map((service) => service.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  return selected.sort((left, right) => {
    switch (sortBy) {
      case "name-asc":
        return (left.agentSession.title ?? "").localeCompare(
          right.agentSession.title ?? "",
        );
      case "name-desc":
        return (right.agentSession.title ?? "").localeCompare(
          left.agentSession.title ?? "",
        );
      case "created-asc":
        return (
          Date.parse(left.agentSession.sessionDate) -
          Date.parse(right.agentSession.sessionDate)
        );
      case "created-desc":
        return (
          Date.parse(right.agentSession.sessionDate) -
          Date.parse(left.agentSession.sessionDate)
        );
      default:
        return 0;
    }
  });
}

// Freeze selection/order until an explicit presentation change; new pages append.
// Keep row objects live so field patches never need to move an existing row.
export function useSessionFeedPresentation(
  items: Item[],
  search: string,
  sortBy: string | undefined,
  scope: string,
): { items: Item[]; hasPendingUpdates: boolean } {
  const key = JSON.stringify([scope, search.trim().toLowerCase(), sortBy]);
  const presentation = useRef<{
    key: string;
    seen: Set<string>;
    ids: string[];
  }>({ key: "", seen: new Set(), ids: [] });
  const current = presentation.current;
  const candidates =
    key === current.key
      ? items.filter((item) => !current.seen.has(item.agentSession.id))
      : items;
  const selected = selectItems(candidates, search.trim().toLowerCase(), sortBy);
  const byId = new Map(items.map((item) => [item.agentSession.id, item]));
  const ids =
    key === current.key ? current.ids.filter((id) => byId.has(id)) : [];
  presentation.current = {
    key,
    seen: new Set(items.map((item) => item.agentSession.id)),
    ids: [...ids, ...selected.map((item) => item.agentSession.id)],
  };
  const visibleItems = presentation.current.ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const desiredIds = selectItems(
    items,
    search.trim().toLowerCase(),
    sortBy,
  ).map((item) => item.agentSession.id);
  return {
    items: visibleItems,
    hasPendingUpdates:
      desiredIds.length !== presentation.current.ids.length ||
      desiredIds.some((id, index) => id !== presentation.current.ids[index]),
  };
}
