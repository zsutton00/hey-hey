import { TERMS } from "../../i18n/terminology";
import { Paper } from "@mui/material";
import React from "react";
import { TargetEntityType, WorkStatus } from "../../api";
import { usePathService } from "../../contexts";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import type { PlanWorkItem } from "../../data/plans/canonicalPlan";
import { EntityGrid, EntityListItem, planAdapter } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";

export interface PlanListProps {
  plans: PlanWorkItem[];
  projectId: string;
  organizationId: string;
  isLoading?: boolean;
  searchTerm?: string;
  emptyMessage?: string;
  showCreateButton?: boolean;
  onCreatePlan?: () => void;
  onDelete?: (plan: PlanWorkItem) => void;
}

export const PlanList: React.FC<PlanListProps> = ({
  plans,
  projectId,
  organizationId,
  isLoading = false,
  searchTerm = "",
  emptyMessage,
  showCreateButton = false,
  onCreatePlan,
  onDelete,
}) => {
  const pathService = usePathService();
  const planType = useWorkItemTypeByKey(organizationId, projectId, "PLAN");
  const fallbackEmptyMessage = searchTerm
    ? "No plans match your search"
    : "Create your first plan to get started";
  const resolvedEmptyMessage = emptyMessage ?? fallbackEmptyMessage;

  // Helper to check if a plan can be deleted from the list
  const canDeletePlan = (plan: PlanWorkItem): boolean => {
    return (
      plan.status === WorkStatus.Backlog ||
      plan.status === WorkStatus.Refining ||
      plan.status === WorkStatus.Ready
    );
  };

  return (
    <Paper
      sx={(theme) => ({
        mt: 2,
        p: 3,
        width: "100%",
        backgroundColor:
          theme.palette.mode === "dark"
            ? theme.palette.grey[900]
            : "rgb(249, 249, 251)",
      })}
    >
      <EntityGrid
        items={plans}
        loading={isLoading}
        renderItem={(plan) => {
          const props = planAdapter.toEntityListItemProps(plan, {
            projectId,
            pathService,
            onDelete:
              onDelete && canDeletePlan(plan)
                ? () => onDelete(plan)
                : undefined,
          });

          return (
            <InteractionComponent
              entityId={plan.id}
              entityType={TargetEntityType.Task}
              entitySubtype={plan.type}
              hasProposalSupport
              entityTitle={plan.name}
              organizationId={organizationId}
              projectId={projectId}
            >
              <EntityListItem {...props} />
            </InteractionComponent>
          );
        }}
        keyExtractor={(plan) => plan.id}
        emptyMessage={resolvedEmptyMessage}
        showCreateButton={showCreateButton}
        onCreateItem={onCreatePlan}
        createAction={{
          verb: "create",
          noun: TERMS.Plan,
          entityType: "plan",
          workItemIcon: {
            typeKey: "PLAN",
            definition: planType.workItemTypeDefinition,
          },
        }}
      />
    </Paper>
  );
};
