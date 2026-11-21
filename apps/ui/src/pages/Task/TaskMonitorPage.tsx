import { Box } from "@mui/material";
import React from "react";

import {
  EntityType,
  RelationshipValue,
  type TaskResponseDto,
} from "@hey-hey/contracts/api";
import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
} from "@hey-hey/ui-common/context";
import { useFullEntityContext, useProject } from "@hey-hey/ui-common/data";

import { TaskBreadcrumbs } from "../../components/TaskBreadcrumbs";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";
import { TaskMonitorResponsiveWorkspace } from "../../components/TaskMonitorResponsiveWorkspace";
import { useSuppressLayoutMainBottomSpacing } from "../../components/Layout/LayoutMainBottomSpacingContext";
import { useRemainingViewportHeight } from "../../hooks/useRemainingViewportHeight";

export interface TaskMonitorPageProps {
  organizationId: string;
  projectId: string;
  monitorId: string;
  task: TaskResponseDto;
}

export const TaskMonitorPage: React.FC<TaskMonitorPageProps> = ({
  organizationId,
  projectId,
  monitorId,
  task,
}) => {
  useSuppressLayoutMainBottomSpacing(true);

  const { containerRef, height } = useRemainingViewportHeight(true, 0);
  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });
  const {
    data: fullEntityContext,
    isFetched: isContextFetched,
    error: contextError,
  } = useFullEntityContext({
    organizationId,
    projectId,
    entityType: EntityType.Task,
    entityId: monitorId,
    enabled: !!organizationId && !!projectId && !!monitorId,
    includeRelatedEntities: true,
    includeFeatureHierarchy: true,
  });
  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
    fallbackHierarchy: fullEntityContext?.featureHierarchy,
  });

  const findDirectRelated = (taskType: string) =>
    fullEntityContext?.relatedEntities?.find(
      (entity) =>
        entity.entityType === EntityType.Task &&
        entity.taskType === taskType &&
        entity.relationship === RelationshipValue.RelatedTo &&
        !entity.via?.length,
    );
  const relatedPlan = findDirectRelated("PLAN");
  const relatedStage = findDirectRelated("PLAN_STAGE");
  const parentPlan = relatedPlan
    ? { id: relatedPlan.entityId, displayName: relatedPlan.displayName }
    : undefined;

  // Hold activation until the Plan lookup settles so the row is never first
  // published without its Plan and then moved. A failed lookup activates the
  // monitor without lineage rather than dropping it.
  const isPlanLookupSettled = isContextFetched || contextError !== null;
  const composition: CanonicalPageComposition = isPlanLookupSettled
    ? {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "task",
          monitorId,
          parentPlan || relatedStage
            ? [
                ...(parentPlan
                  ? [createNavigationLineageEntry("plan", parentPlan.id)]
                  : []),
                ...(relatedStage
                  ? [
                      createNavigationLineageEntry(
                        "plan_stage",
                        relatedStage.entityId,
                      ),
                    ]
                  : []),
              ]
            : null,
          { kind: "task", label: task.name, taskType: task.type },
        ),
      }
    : { kind: "observational" };

  return (
    <CanonicalPageBoundary composition={composition}>
      <TaskBreadcrumbs
        projectId={projectId}
        projectName={project?.name}
        task={task}
        plan={parentPlan}
        featureAncestors={featureAncestors}
      />
      <Box
        ref={containerRef}
        data-testid="task-monitor-page"
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          ...(height === null ? {} : { height: `${height}px` }),
        }}
      >
        <TaskMonitorResponsiveWorkspace
          organizationId={organizationId}
          projectId={projectId}
          monitorId={monitorId}
        />
      </Box>
    </CanonicalPageBoundary>
  );
};
