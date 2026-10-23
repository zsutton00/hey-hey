import type { DebugOutboxEventDto } from "../../api";
import {
  outboxEventsQueryOptions,
  type OutboxEventsData,
} from "../collections/outboxEvents";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseOutboxEventsReturn
  extends Omit<DataHookReturn<OutboxEventsData>, "data"> {
  data: OutboxEventsData | null;
  events: DebugOutboxEventDto[];
}
export function useOutboxEvents(
  entityType: string | undefined,
  entityId: string | undefined,
  options: CollectionHookOptions<OutboxEventsData> = {}
): UseOutboxEventsReturn {
  const { result, state } = useDataLayerQuery(
    outboxEventsQueryOptions(entityType ?? "", entityId ?? ""),
    {
      ...options,
      enabled: options.enabled !== false && Boolean(entityType && entityId),
    }
  );
  const data = result.data ?? null;
  return { ...state, data, events: data?.events ?? [] };
}
