import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
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
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type PlanContextEntryDto,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeGraphCapability,
} from "@hey-hey/ui-common/api";
import {
  useFullEntityContext,
  useProject,
  useTaskHierarchy,
  useWorkItemGraph,
  useWorkItemGraphDraft,
  useWorkItemTypeByKey,
  useWorkItems,
  useSubmitWorkItemGraphProposal,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

import {
  WorkflowDetailPageView,
  type WorkflowDetailPageActiveTab,
  type WorkflowDetailPageTabChange,
} from "./WorkflowDetailPageView";
import {
  buildGraphInput,
  canAuthorGraph,
  getReadableGraphEdgeTypes,
  selectGraphWorkItemRoute,
  type GraphRootInput,
} from "./graphWorkItemRouting";
import {
  buildWorkflowGraphDataFromAggregate,
  isWorkflowStepTask,
  isWorkflowTask,
} from "./workflowStepEdges";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";

export const WorkflowDetailPage: React.FC<{
  workItemTypeDefinition?: WorkItemTypeDefinitionDto;
  /**
   * Mounts the page inside Preview: identity comes from props rather than the
   * route, tabs stay local, breadcrumbs are hidden, and graph authoring (which
   * navigates to the review page) is unavailable.
   */
  preview?: { projectId: string; taskId: string };
}> = ({ workItemTypeDefinition, preview }) => {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = preview?.projectId ?? params.projectId ?? "";
  const taskId = preview?.taskId ?? params.taskId ?? "";
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [treeVisibilityOverride, setTreeVisibilityOverride] = useState<{
    taskId: string;
    visible: boolean;
  } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingWorkflow, setIsDeletingWorkflow] = useState(false);
  const [routeActiveTab, setRouteActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral([
      "diagram",
      "workflow",
      "conversations",
      "data-debug",
      "admin",
    ] as const).withDefault("diagram"),
  );
  const isPreview = preview !== undefined;
  const [previewActiveTab, setPreviewActiveTab] =
    useState<WorkflowDetailPageActiveTab>("diagram");
  const activeTab = isPreview ? previewActiveTab : routeActiveTab;
  const setActiveTab = useMemo<WorkflowDetailPageTabChange>(
    () =>
      isPreview
        ? (value) =>
            setPreviewActiveTab(
              (current) =>
                (typeof value === "function" ? value(current) : value) ??
                "diagram",
            )
        : setRouteActiveTab,
    [isPreview, setRouteActiveTab],
  );

  useEffect(() => {
    if (activeTab === "workflow") {
      void setActiveTab("diagram", { history: "replace" });
    }
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    if (!isPlatformAdmin && activeTab === "data-debug") {
      void setActiveTab("diagram");
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

  const typeDefinitionQuery = useWorkItemTypeByKey(
    organizationId,
    projectId,
    WORK_ITEM_TYPE_KEYS.Diagram,
  );
  const definition =
    workItemTypeDefinition ?? typeDefinitionQuery.workItemTypeDefinition;
  const graphRouteSelection = selectGraphWorkItemRoute({
    typeKey: WORK_ITEM_TYPE_KEYS.Diagram,
    definition,
    isFetched: Boolean(workItemTypeDefinition) || typeDefinitionQuery.isFetched,
  });
  const graphCapability =
    graphRouteSelection.status === "graph"
      ? graphRouteSelection.capability
      : undefined;
  const readableGraphEdgeTypes = useMemo(
    () => getReadableGraphEdgeTypes(graphCapability),
    [graphCapability],
  );

  const graphQuery = useWorkItemGraph(organizationId, projectId, taskId, {
    enabled: !!organizationId && !!projectId && !!taskId,
    incidentRelationshipTypes: ["GUARANTEES", "IMPLEMENTS", "CONSUMES"],
  });
  const graphAggregate = graphQuery.data;
  const workflow = (graphAggregate?.root ?? null) as TaskResponseDto | null;
  const childDefinitionQuery = useWorkItemTypeByKey(
    organizationId,
    projectId,
    graphCapability?.nodeChildType,
  );
  const { remove: removeWorkflow } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { enabled: false },
  );

  const steps = useMemo(
    () => (graphAggregate?.children ?? []).filter(isWorkflowStepTask),
    [graphAggregate?.children],
  );

  const graphData = useMemo(
    () => buildWorkflowGraphDataFromAggregate(graphAggregate, definition),
    [definition, graphAggregate],
  );
  const graphInput = useMemo(() => {
    if (!workflow || !graphAggregate || !definition || !graphCapability) {
      return null;
    }
    const input = buildGraphInput(
      { ...workflow, edges: graphAggregate.relationships },
      steps,
      definition,
      new Set(readableGraphEdgeTypes),
    );
    if (!graphAggregate.layout) {
      return input;
    }
    const layoutSectionKey = graphCapability.layout.sectionKey;
    return {
      ...input,
      root: {
        ...input.root,
        sections: [
          ...input.root.sections.filter(
            (section) => section.key !== layoutSectionKey,
          ),
          { key: layoutSectionKey, content: graphAggregate.layout },
        ],
      },
    };
  }, [
    definition,
    graphAggregate,
    graphCapability,
    readableGraphEdgeTypes,
    steps,
    workflow,
  ]);

  const task = hierarchy?.task ?? workflow ?? null;
  const isTreeVisible =
    treeVisibilityOverride?.taskId === taskId
      ? treeVisibilityOverride.visible
      : task?.type !== WORK_ITEM_TYPE_KEYS.Diagram;
  const parent = hierarchy?.parent ?? null;
  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
    parent,
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

  const handleOpenDeleteDialog = (): void => {
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = (): void => {
    if (isDeletingWorkflow) return;
    setIsDeleteDialogOpen(false);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!workflow?.id) return;

    try {
      setIsDeletingWorkflow(true);
      await removeWorkflow(workflow.id);
      setIsDeleteDialogOpen(false);
      navigate(WebPathService.returnToProject(projectId));
    } catch (error) {
      console.error("Failed to delete Diagram:", error);
    } finally {
      setIsDeletingWorkflow(false);
    }
  };

  if (!projectId || !taskId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required route parameters. Please check the workflow URL.
        </Alert>
      </Box>
    );
  }

  if (taskError || graphQuery.error) {
    const message =
      taskError?.message ||
      graphQuery.error?.message ||
      "Failed to load Diagram";
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

  const isLoading =
    (isTaskLoading && !task) ||
    graphQuery.isLoading ||
    graphRouteSelection.status === "loading" ||
    (graphCapability !== undefined && !childDefinitionQuery.isFetched);

  if (isLoading) {
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
          Loading workflow...
        </Typography>
      </Box>
    );
  }

  if (!task || !isWorkflowTask(workflow)) {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Workflow data not found. It may have been removed or the link is
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

  if (
    graphRouteSelection.status !== "graph" ||
    !graphInput ||
    !childDefinitionQuery.workItemTypeDefinition
  ) {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="error">
          The Workflow graph capability is unavailable or invalid.
        </Alert>
      </Box>
    );
  }

  if (preview) {
    return (
      <WorkflowDetailPageView
        organizationId={organizationId}
        projectId={projectId}
        workflow={workflow}
        parent={parent}
        project={project}
        graphData={graphData}
        featureAncestors={featureAncestors}
        relatedEntities={relatedEntities}
        proposals={proposals}
        parentPlan={parentPlan}
        isPlatformAdmin={isPlatformAdmin}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isTreeVisible={isTreeVisible}
        onToggleTree={handleToggleTree}
        graphLoadError={graphQuery.error}
        isDeleteDialogOpen={isDeleteDialogOpen}
        isDeletingWorkflow={isDeletingWorkflow}
        onDeleteClick={handleOpenDeleteDialog}
        onCancelDelete={handleCloseDeleteDialog}
        onConfirmDelete={handleConfirmDelete}
        hideBreadcrumbs
      />
    );
  }

  return (
    <WorkflowDetailAuthoringHost
      organizationId={organizationId}
      projectId={projectId}
      workflow={workflow}
      parent={parent}
      project={project}
      graphData={graphData}
      graphInput={graphInput}
      graphCapability={graphRouteSelection.capability}
      childTypeDefinition={childDefinitionQuery.workItemTypeDefinition}
      featureAncestors={featureAncestors}
      relatedEntities={relatedEntities}
      proposals={proposals}
      parentPlan={parentPlan}
      isPlatformAdmin={isPlatformAdmin}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      isTreeVisible={isTreeVisible}
      onToggleTree={handleToggleTree}
      graphLoadError={graphQuery.error}
      isDeleteDialogOpen={isDeleteDialogOpen}
      isDeletingWorkflow={isDeletingWorkflow}
      onDeleteClick={handleOpenDeleteDialog}
      onCancelDelete={handleCloseDeleteDialog}
      onConfirmDelete={handleConfirmDelete}
    />
  );
};

interface WorkflowDetailAuthoringHostProps extends React.ComponentProps<
  typeof WorkflowDetailPageView
> {
  graphInput: GraphRootInput;
  graphCapability: WorkItemTypeGraphCapability;
  childTypeDefinition: WorkItemTypeDefinitionDto;
}

const WorkflowDetailAuthoringHost: React.FC<
  WorkflowDetailAuthoringHostProps
> = ({
  graphInput,
  graphCapability,
  childTypeDefinition,
  organizationId,
  projectId,
  workflow,
  ...viewProps
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isNavigationPromptOpen, setIsNavigationPromptOpen] = useState(false);
  const stableInputRef = useRef(graphInput);
  const allowNavigationRef = useRef(false);
  const navigate = useNavigate();
  const submission = useSubmitWorkItemGraphProposal();

  if (!isEditing) {
    stableInputRef.current = graphInput;
  }
  const graphDraft = useWorkItemGraphDraft(
    isEditing ? stableInputRef.current : graphInput,
  );
  const blocker = useBlocker(
    () => !allowNavigationRef.current && isEditing && graphDraft.isDirty,
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      setIsNavigationPromptOpen(true);
    }
  }, [blocker.state]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!isEditing || !graphDraft.isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [graphDraft.isDirty, isEditing]);

  const discard = useCallback(() => {
    graphDraft.reset();
    setIsEditing(false);
  }, [graphDraft]);

  const review = useCallback(async () => {
    if (!graphDraft.isDirty) return;
    let proposal: ProposalResponseDto;
    try {
      proposal = await submission.submit({
        organizationId,
        projectId,
        eli5: "Changes this workflow's work item graph.",
        root: stableInputRef.current.root,
        graphCapability,
        draft: {
          operations: graphDraft.operations,
          projection: graphDraft.projected,
          isDirty: graphDraft.isDirty,
        },
      });
    } catch {
      return;
    }
    allowNavigationRef.current = true;
    const returnTo = WebPathService.task({
      projectId,
      taskId: workflow.id,
    });
    const proposalPath = WebPathService.proposal({
      projectId,
      proposalId: proposal.id,
    });
    navigate(`${proposalPath}?${new URLSearchParams({ returnTo }).toString()}`);
  }, [
    graphCapability,
    graphDraft.isDirty,
    graphDraft.operations,
    graphDraft.projected,
    navigate,
    organizationId,
    projectId,
    submission,
    workflow.id,
  ]);

  return (
    <WorkflowDetailPageView
      {...viewProps}
      organizationId={organizationId}
      projectId={projectId}
      workflow={workflow}
      graphProjection={graphDraft.projected}
      graphDraft={graphDraft}
      childTypeDefinition={childTypeDefinition}
      canEditGraph={canAuthorGraph(graphCapability)}
      isEditingGraph={isEditing}
      onEditGraph={() => setIsEditing(true)}
      onDiscardGraph={discard}
      onReviewGraph={review}
      isSubmittingGraph={submission.isPending}
      graphSubmissionError={submission.error}
      isNavigationPromptOpen={isNavigationPromptOpen}
      onStay={() => {
        blocker.reset?.();
        setIsNavigationPromptOpen(false);
      }}
      onDiscardNavigation={() => {
        discard();
        setIsNavigationPromptOpen(false);
        blocker.proceed?.();
      }}
    />
  );
};
