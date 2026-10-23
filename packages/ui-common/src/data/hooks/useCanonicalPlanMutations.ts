import { useCallback } from "react";
import type { ProposalResponseDto, UpdateTaskDto } from "../../api";
import { isPlanWorkItem, type PlanWorkItem } from "../plans/canonicalPlan";
import { useWorkItemUpdateMethods } from "./useWorkItemUpdateMethods";

export type CanonicalPlanUpdateResult =
  | { status: "applied"; plan: PlanWorkItem }
  | {
      status: "pending";
      plan: PlanWorkItem;
      proposal: ProposalResponseDto;
    };

export interface UseCanonicalPlanMutationsReturn {
  updatePlan: (
    planId: string,
    updates: UpdateTaskDto
  ) => Promise<CanonicalPlanUpdateResult>;
  deletePlan: (planId: string) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

export const useCanonicalPlanMutations = (
  organizationId: string,
  projectId: string
): UseCanonicalPlanMutationsReturn => {
  const { updateTask, remove, isLoading, error } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId
  );

  const updatePlan = useCallback(
    async (
      planId: string,
      updates: UpdateTaskDto
    ): Promise<CanonicalPlanUpdateResult> => {
      let pendingProposal: ProposalResponseDto | null = null;
      const updated = await updateTask(planId, updates, {
        onPendingProposal: (proposal) => {
          pendingProposal = proposal;
        },
      });
      if (!isPlanWorkItem(updated)) {
        throw new Error("The updated Work Item is not a canonical Plan.");
      }
      return pendingProposal
        ? { status: "pending", plan: updated, proposal: pendingProposal }
        : { status: "applied", plan: updated };
    },
    [updateTask]
  );

  return {
    updatePlan,
    deletePlan: remove,
    isLoading,
    error,
  };
};
