import type {
  ListWorkflowExecutionsResponseDto,
  WorkflowExecutionSummaryDto,
} from "../../api";
import { userWorkflowsQueryOptions } from "../collections/workflowExecutions";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseUserWorkflowsOptions
  extends CollectionHookOptions<ListWorkflowExecutionsResponseDto> {
  limit?: number;
  nextPageToken?: string;
  workflowType?: string;
  sourceConversationId?: string;
}

export interface UseUserWorkflowsReturn
  extends DataHookReturn<ListWorkflowExecutionsResponseDto> {
  workflows: WorkflowExecutionSummaryDto[];
  nextPageToken: string | null;
}

export function useUserWorkflows(
  organizationId: string | undefined,
  options: UseUserWorkflowsOptions = {}
): UseUserWorkflowsReturn {
  const {
    limit = 50,
    nextPageToken,
    workflowType,
    sourceConversationId,
  } = options;
  const { result, state } = useDataLayerQuery(
    userWorkflowsQueryOptions(organizationId ?? "", {
      limit,
      nextPageToken: nextPageToken?.trim() || undefined,
      workflowType: workflowType?.trim() || undefined,
      sourceConversationId: sourceConversationId?.trim() || undefined,
    }),
    {
      ...options,
      enabled: options.enabled !== false && Boolean(organizationId),
    }
  );
  const data = result.data ?? null;
  return {
    ...state,
    data,
    workflows: data?.workflows ?? [],
    nextPageToken: data?.nextPageToken ?? null,
  };
}
