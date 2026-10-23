import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type {
  ApiResponse,
  ListWorkflowExecutionsResponseDto,
  WorkflowExecutionSummaryDto,
} from "../../api";
import { dataClient } from "../../clients";
const MAX_LIMIT = 200;
export interface UserWorkflowExecutionsFilters {
  limit?: number;
  nextPageToken?: string;
  workflowType?: string;
  sourceConversationId?: string;
}

const normalizeLimit = (limit?: number): number | undefined => {
  if (limit === undefined || limit === null || Number.isNaN(limit)) {
    return undefined;
  }

  const clamped = Math.min(Math.max(limit, 1), MAX_LIMIT);
  return Math.floor(clamped);
};

const isWorkflowExecutionSummaryDto = (
  value: unknown
): value is WorkflowExecutionSummaryDto => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.workflowId === "string" &&
    typeof record.runId === "string" &&
    typeof record.workflowType === "string" &&
    typeof record.status === "string" &&
    typeof record.startTime === "string" &&
    (record.closeTime === null ||
      record.closeTime === undefined ||
      typeof record.closeTime === "string")
  );
};

const parseListWorkflowExecutionsResponse = (
  data: unknown
): ListWorkflowExecutionsResponseDto | null => {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.workflows)) {
    return null;
  }

  const workflows = record.workflows.filter(isWorkflowExecutionSummaryDto);
  if (workflows.length !== record.workflows.length) {
    return null;
  }

  const nextPageToken = record.nextPageToken;
  if (
    nextPageToken !== undefined &&
    nextPageToken !== null &&
    typeof nextPageToken !== "string"
  ) {
    return null;
  }

  return {
    workflows,
    nextPageToken: nextPageToken ?? null,
  };
};

const normalizeUserWorkflowFilters = (
  filters: UserWorkflowExecutionsFilters
): UserWorkflowExecutionsFilters => {
  const normalizedLimit = normalizeLimit(filters.limit);

  return {
    limit: normalizedLimit,
    nextPageToken:
      filters.nextPageToken && filters.nextPageToken.trim().length > 0
        ? filters.nextPageToken.trim()
        : undefined,
    workflowType:
      filters.workflowType && filters.workflowType.trim().length > 0
        ? filters.workflowType.trim()
        : undefined,
    sourceConversationId:
      filters.sourceConversationId &&
      filters.sourceConversationId.trim().length > 0
        ? filters.sourceConversationId.trim()
        : undefined,
  };
};

export const userWorkflowKeys = {
  root: () => ["userWorkflows"] as const,
  organization: (organizationId: string) =>
    [...userWorkflowKeys.root(), organizationId] as const,
  list: (organizationId: string, filters: UserWorkflowExecutionsFilters = {}) =>
    [
      ...userWorkflowKeys.organization(organizationId),
      "list",
      normalizeUserWorkflowFilters(filters),
    ] as const,
};
export function userWorkflowsQueryOptions(
  organizationId: string,
  filters: UserWorkflowExecutionsFilters = {}
) {
  const params = normalizeUserWorkflowFilters(filters);
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: userWorkflowKeys.list(organizationId, params),
    queryFn: async ({ signal }): Promise<ListWorkflowExecutionsResponseDto> => {
      const response = await dataClient.request<ApiResponse>({
        ...captureRequestOptions(),
        signal,
        method: "GET",
        url: `/organizations/${organizationId}/workflows`,
        params,
      });
      const data = parseListWorkflowExecutionsResponse(response.data?.data);
      if (!data) throw new Error("Invalid workflow executions response");
      return data;
    },
  });
}
