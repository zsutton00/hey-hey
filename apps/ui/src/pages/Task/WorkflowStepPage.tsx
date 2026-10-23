import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import BackIcon from "@mui/icons-material/ArrowBack";
import {
  EntityType,
  TargetEntityType,
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type PlanContextEntryDto,
} from "@hey-hey/ui-common/api";
import {
  useFullEntityContext,
  useProject,
  useTaskHierarchy,
  useWorkItemGraph,
  useWorkItemTypeByKey,
  useWorkItems,
  useWorkItem,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

import { getDiagramElementMetadata } from "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer";
import {
  WorkflowStepPageView,
  type LinkedDiagramState,
} from "./WorkflowStepPageView";
import {
  buildWorkflowGraphDataFromAggregate,
  isWorkflowTask,
  isWorkflowStepTask,
  normalizeWorkflowStepEdges,
} from "./workflowStepEdges";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";

export const WorkflowStepPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = params.projectId ?? "";
  const taskId = params.taskId ?? "";
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [treeVisibilityOverride, setTreeVisibilityOverride] = useState<{
    taskId: string;
    visible: boolean;
  } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingStep, setIsDeletingStep] = useState(false);
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral([
      "step",
      "conversations",
      "data-debug",
      "admin",
    ] as const).withDefault("step"),
  );

  useEffect(() => {
    if (!isPlatformAdmin && activeTab === "data-debug") {
      void setActiveTab("step");
    }
  }, [activeTab, isPlatformAdmin, setActiveTab]);

  const {
    hierarchy,
    isLoading: isTaskLoading,
    error: taskError,
  } = useTaskHierarchy(organizationId, projectId, taskId, {
    enabled: !!organizationId && !!projectId && !!taskId,
    includeDesignDocCounts: true,
    includeAgentSessionCounts: true,
  });

  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  const { data: fullEntityContext } = useFullEntityContext({
    organizationId,
    projectId,
    entityType: EntityType.Task,
    entityId: taskId,
    enabled: !!organizationId && !!projectId && !!taskId,
    includeProposals: true,
  });

  const task = hierarchy?.task ?? null;
  const metadata = task ? getDiagramElementMetadata(task) : null;
  const reference =
    metadata?.role === "DIAGRAM_REFERENCE"
      ? metadata.canonicalReference
      : undefined;
  const referenceId =
    reference?.entityType === TargetEntityType.Task &&
    !reference.entityId.startsWith("temporary:")
      ? reference.entityId
      : "";
  const linkedQuery = useWorkItem(organizationId, "task", referenceId, {
    projectId,
    enabled: !!organizationId && !!projectId && !!referenceId,
  });
  const linkedDiagram: LinkedDiagramState = !reference
    ? { status: "absent" }
    : !referenceId || linkedQuery.error
      ? { status: "unavailable" }
      : linkedQuery.isLoading
        ? { status: "loading" }
        : linkedQuery.workItem?.type === WORK_ITEM_TYPE_KEYS.Diagram &&
            linkedQuery.workItem.name
          ? { status: "ready", diagram: linkedQuery.workItem }
          : { status: "unavailable" };
  const isTreeVisible =
    treeVisibilityOverride?.taskId === taskId
      ? treeVisibilityOverride.visible
      : task?.type !== WORK_ITEM_TYPE_KEYS.DiagramElement;
  const hierarchyParentWorkflow = hierarchy?.parent ?? null;
  const parentWorkflowId =
    hierarchyParentWorkflow?.id ?? task?.parentTaskId ?? "";

  const graphQuery = useWorkItemGraph(
    organizationId,
    projectId,
    parentWorkflowId,
    { enabled: !!organizationId && !!projectId && !!parentWorkflowId },
  );
  const workflowTypeQuery = useWorkItemTypeByKey(
    organizationId,
    projectId,
    WORK_ITEM_TYPE_KEYS.Diagram,
  );
  const parentWorkflow = graphQuery.data?.root ?? hierarchyParentWorkflow;
  const { remove: removeWorkflowStep } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { enabled: false },
  );

  const siblingWorkflowSteps = useMemo(
    () => (graphQuery.data?.children ?? []).filter(isWorkflowStepTask),
    [graphQuery.data?.children],
  );

  const edgeGroups = useMemo(() => {
    return normalizeWorkflowStepEdges(
      taskId,
      graphQuery.data?.relationships,
      siblingWorkflowSteps,
    );
  }, [graphQuery.data?.relationships, siblingWorkflowSteps, taskId]);

  const graphData = useMemo(
    () =>
      buildWorkflowGraphDataFromAggregate(
        graphQuery.data,
        workflowTypeQuery.workItemTypeDefinition,
      ),
    [graphQuery.data, workflowTypeQuery.workItemTypeDefinition],
  );

  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
    parent: parentWorkflow,
    fallbackHierarchy: fullEntityContext?.featureHierarchy,
  });
  const relatedEntities: ContextRelatedEntityDto[] =
    fullEntityContext?.relatedEntities ?? [];
  const proposals: EntityContextDtoProposalsInner[] =
    fullEntityContext?.proposals ?? [];
  const parentPlan: PlanContextEntryDto | undefined =
    fullEntityContext?.planContext?.parentPlan;

  const handleToggleTree = (): void => {
    setTreeVisibilityOverride({ taskId, visible: !isTreeVisible });
  };

  const conversationPathForId = React.useCallback(
    (conversationId: string): string =>
      `/projects/${projectId}/resolve-agent-session/${conversationId}`,
    [projectId],
  );

  const handleOpenDeleteDialog = (): void => {
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = (): void => {
    if (isDeletingStep) return;
    setIsDeleteDialogOpen(false);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!task?.id) return;

    try {
      setIsDeletingStep(true);
      await removeWorkflowStep(task.id);
      setIsDeleteDialogOpen(false);
      navigate(WebPathService.returnToProject(projectId));
    } catch (error) {
      console.error("Failed to delete Diagram Element:", error);
    } finally {
      setIsDeletingStep(false);
    }
  };

  if (!projectId || !taskId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required route parameters. Please check the task URL.
        </Alert>
      </Box>
    );
  }

  if (taskError) {
    const message = taskError.message || "Failed to load Diagram Element";
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {message}
        </Alert>
        <Box textAlign="center">
          <Button
            startIcon={<BackIcon />}
            href={WebPathService.returnToProject(projectId)}
            variant="outlined"
          >
            Go back
          </Button>
        </Box>
      </Box>
    );
  }

  const shouldLoadParentWorkflow = !!parentWorkflowId;
  const shouldLoadStepGraph =
    shouldLoadParentWorkflow && isWorkflowTask(parentWorkflow);

  if (
    (isTaskLoading && !task) ||
    (shouldLoadParentWorkflow && graphQuery.isLoading) ||
    (shouldLoadStepGraph && workflowTypeQuery.isLoading)
  ) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "50vh",
          gap: 2,
        }}
      >
        <CircularProgress size={48} />
        <Typography variant="body1" color="text.secondary">
          Loading workflow step...
        </Typography>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Workflow step data not found. It may have been removed or the link is
          invalid.
        </Alert>
        <Box textAlign="center">
          <Button
            startIcon={<BackIcon />}
            href={WebPathService.returnToProject(projectId)}
            variant="outlined"
          >
            Go back
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <WorkflowStepPageView
      organizationId={organizationId}
      projectId={projectId}
      task={task}
      parentWorkflow={parentWorkflow}
      linkedDiagram={linkedDiagram}
      project={project}
      graphData={graphData}
      featureAncestors={featureAncestors}
      relatedEntities={relatedEntities}
      proposals={proposals}
      parentPlan={parentPlan}
      isPlatformAdmin={isPlatformAdmin}
      conversationPathForId={conversationPathForId}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      flowLinks={edgeGroups.flowLinks}
      fulfillmentLinks={edgeGroups.fulfillmentLinks}
      isTreeVisible={isTreeVisible}
      onToggleTree={handleToggleTree}
      edgeLoadError={graphQuery.error}
      isDeleteDialogOpen={isDeleteDialogOpen}
      isDeletingStep={isDeletingStep}
      onDeleteClick={handleOpenDeleteDialog}
      onCancelDelete={handleCloseDeleteDialog}
      onConfirmDelete={handleConfirmDelete}
    />
  );
};
