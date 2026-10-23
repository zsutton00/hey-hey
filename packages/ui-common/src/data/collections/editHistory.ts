import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type { EditHistoryEntryDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { queryOptions } from "@tanstack/react-query";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

// Extend EditHistoryEntryDto to include required collection fields
export interface EditHistoryEntry extends EditHistoryEntryDto {
  id: string;
  updatedAt: string;
  entityType?: "initiative" | "task";
}

export const editHistoryKeys = {
  root: () => ["editHistory"] as const,
  entity: (
    organizationId: string,
    entityType: "initiative" | "task",
    id: string,
  ) => ["editHistory", organizationId, id, entityType] as const,
};

const normalizeEntries = (
  entries: EditHistoryEntryDto[] | undefined,
  workItemId: string,
): EditHistoryEntry[] => {
  if (!entries?.length) {
    return [];
  }

  return entries.map((entry, index) => ({
    ...entry,
    id:
      entry.id ??
      `${workItemId}-edit-${index}-${entry.timestamp ?? Date.now()}`,
    updatedAt: entry.timestamp
      ? new Date(entry.timestamp).toISOString()
      : new Date().toISOString(),
  }));
};

const extractEntries = (
  response: unknown,
): EditHistoryEntryDto[] | undefined => {
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const dataLayer = (response as { data?: unknown }).data ?? response;
  if (!dataLayer || typeof dataLayer !== "object") {
    return undefined;
  }

  const inner = (dataLayer as { data?: unknown }).data ?? dataLayer;

  if (
    inner &&
    typeof inner === "object" &&
    Array.isArray((inner as { entries?: unknown }).entries)
  ) {
    return (inner as { entries: EditHistoryEntryDto[] }).entries;
  }

  if (Array.isArray(inner)) {
    return inner as EditHistoryEntryDto[];
  }

  return undefined;
};

const fetchWorkItemEditHistory = async (
  organizationId: string,
  workItemId: string,
  entityType: "initiative" | "task" = "initiative",
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<EditHistoryEntry[]> => {
  if (!organizationId || !workItemId) {
    return [];
  }

  const response = await platformClient.getInitiativeEditHistory(
    {
      organizationId: organizationId,
      initiativeId: workItemId,
    },
    requestOptions,
  );

  const entries = normalizeEntries(extractEntries(response), workItemId);

  if (entityType === "task") {
    return entries.map((entry) => ({
      ...entry,
      entityType,
    }));
  }

  return entries;
};

export function editHistoryQueryOptions(
  organizationId: string,
  workItemId: string,
  entityType: "initiative" | "task",
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: editHistoryKeys.entity(organizationId, entityType, workItemId),
    queryFn: ({ signal }) =>
      fetchWorkItemEditHistory(organizationId, workItemId, entityType, {
        ...captureRequestOptions(),
        signal,
      }),
  });
}
