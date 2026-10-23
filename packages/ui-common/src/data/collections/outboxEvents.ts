import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type {
  DebugOutboxEventDto,
  DebugOutboxEventsResponseDto,
} from "../../api";
export interface OutboxEventsData extends DebugOutboxEventsResponseDto {
  events: DebugOutboxEventDto[];
}
import { eventsClient } from "../../clients/serviceClients";
export const outboxEventKeys = {
  root: () => ["outboxEvents"] as const,
  entity: (entityType: string, entityId: string) =>
    [...outboxEventKeys.root(), entityType, entityId] as const,
};
export function outboxEventsQueryOptions(entityType: string, entityId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: outboxEventKeys.entity(entityType, entityId),
    queryFn: async ({ signal }) => {
      const response = await eventsClient.getEntityOutboxEventsDebug(
        { entityType, entityId },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data
        ? { ...response.data.data, events: response.data.data.events ?? [] }
        : null;
    },
  });
}
