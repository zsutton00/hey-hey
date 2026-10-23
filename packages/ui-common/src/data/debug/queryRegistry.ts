type QueryRegistryEventKind =
  | "single_query_set"
  | "single_query_deleted"
  | "list_query_set"
  | "list_query_deleted"
  | "item_set"
  | "item_deleted"
  | "query_key_removed_from_item"
  | "expected_query_heartbeat";

export type QueryRegistryEvent = {
  id: string;
  at: string;
  collection: string;
  kind: QueryRegistryEventKind;
  queryKey?: string;
  itemId?: string;
  storageId?: string;
  detail?: Record<string, unknown>;
};

// No-op implementations to avoid memory pressure from debug event retention.
export const logQueryRegistryEvent = (
  _event: Omit<QueryRegistryEvent, "id" | "at">,
): void => {};
