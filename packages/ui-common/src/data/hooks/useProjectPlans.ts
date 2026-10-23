import { useMemo } from "react";
import { type WorkStatus } from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";
import {
  PLAN_WORK_ITEM_TYPE,
  isPlanWorkItem,
  type PlanWorkItem,
} from "../plans/canonicalPlan";
import { useWorkItems } from "./useWorkItems";

export interface UseProjectPlansOptions {
  enabled?: boolean;
  statuses?: WorkStatus[];
}

export interface UseProjectPlansReturn {
  plans: PlanWorkItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<PlanWorkItem[]>;
}

const validatePlanList = (
  workItems: readonly WorkItemResponseDto[]
): { plans: PlanWorkItem[]; error: Error | null } => {
  const plans = workItems.filter(isPlanWorkItem);
  if (plans.length !== workItems.length) {
    return {
      plans: [],
      error: new Error(
        "The Plan list response contained an item that is not a canonical PLAN."
      ),
    };
  }
  return { plans, error: null };
};

export function useProjectPlans(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseProjectPlansOptions = {}
): UseProjectPlansReturn {
  const { enabled = true, statuses } = options;
  const query = useWorkItems(
    organizationId ?? "",
    "task",
    projectId ?? "",
    undefined,
    {
      enabled: enabled && !!organizationId && !!projectId,
      taskType: PLAN_WORK_ITEM_TYPE,
      status: statuses,
    }
  );
  const parsed = useMemo(
    () => validatePlanList(query.workItems),
    [query.workItems]
  );

  const refetch = async (): Promise<PlanWorkItem[]> => {
    const workItems = (await query.refetch()) ?? [];
    const result = validatePlanList(workItems);
    if (result.error) throw result.error;
    return result.plans;
  };

  return {
    plans: parsed.plans,
    isLoading: query.isLoading,
    error: query.error ?? parsed.error,
    refetch,
  };
}
