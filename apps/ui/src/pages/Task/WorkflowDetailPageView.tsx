import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import React from "react";
import type { Options } from "nuqs";
import {
  Alert,
  Box,
  Chip,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import CancelIcon from "@mui/icons-material/Cancel";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import {
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type PlanContextEntryDto,
  type TaskResponseDto,
  TargetEntityType,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  CapsuleAction,
  DiscussCapsuleAction,
  WorkItemGraphEditor,
  WorkItemReadView,
  type WorkItemGraphDraftProjection,
} from "@hey-hey/ui-common/components";
import type { UseWorkItemGraphDraftReturn } from "@hey-hey/ui-common/data";
import {
  WorkflowGraphSurface,
  type WorkflowGraphSurfaceData,
} from "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer";

import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  type DetailPageTab,
} from "../../components/Layout";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import {
  TaskBreadcrumbs,
  type BreadcrumbFeatureAncestor,
} from "../../components/TaskBreadcrumbs";
import { TaskDetailSidebar } from "./TaskDetailSidebar";

export type WorkflowDetailPageActiveTab =
  "diagram" | "workflow" | "conversations" | "data-debug" | "admin";

export type WorkflowDetailPageTabChange = (
  value:
    | WorkflowDetailPageActiveTab
    | ((old: WorkflowDetailPageActiveTab) => WorkflowDetailPageActiveTab | null)
    | null,
  options?: Options,
) => void | Promise<URLSearchParams>;

interface WorkflowDetailPageViewProps {
  organizationId: string;
  projectId: string;
  workflow: TaskResponseDto;
  parent?: TaskResponseDto | null;
  project?: { id: string; name?: string } | null;
  graphData: WorkflowGraphSurfaceData | null;
  graphProjection?: WorkItemGraphDraftProjection;
  graphDraft?: UseWorkItemGraphDraftReturn;
  childTypeDefinition?: WorkItemTypeDefinitionDto;
  featureAncestors: BreadcrumbFeatureAncestor[];
  relatedEntities: ContextRelatedEntityDto[];
  proposals: EntityContextDtoProposalsInner[];
  parentPlan?: PlanContextEntryDto;
  isPlatformAdmin: boolean;
  activeTab: WorkflowDetailPageActiveTab;
  onTabChange: WorkflowDetailPageTabChange;
  isTreeVisible: boolean;
  onToggleTree: () => void;
  graphLoadError?: Error | null;
  enableEntityLinks?: boolean;
  isDeleteDialogOpen: boolean;
  isDeletingWorkflow: boolean;
  onDeleteClick: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  canEditGraph?: boolean;
  isEditingGraph?: boolean;
  onEditGraph?: () => void;
  onDiscardGraph?: () => void;
  onReviewGraph?: () => void;
  isSubmittingGraph?: boolean;
  graphSubmissionError?: Error | null;
  isNavigationPromptOpen?: boolean;
  onStay?: () => void;
  onDiscardNavigation?: () => void;
  hideBreadcrumbs?: boolean;
}

export const WorkflowDetailPageView: React.FC<WorkflowDetailPageViewProps> = ({
  organizationId,
  projectId,
  workflow,
  parent,
  project,
  graphData,
  graphProjection,
  graphDraft,
  childTypeDefinition,
  featureAncestors,
  relatedEntities,
  proposals,
  parentPlan,
  isPlatformAdmin,
  activeTab,
  onTabChange,
  isTreeVisible,
  onToggleTree,
  graphLoadError,
  enableEntityLinks = true,
  isDeleteDialogOpen,
  isDeletingWorkflow,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
  canEditGraph = false,
  isEditingGraph = false,
  onEditGraph,
  onDiscardGraph,
  onReviewGraph,
  isSubmittingGraph = false,
  graphSubmissionError,
  isNavigationPromptOpen = false,
  onStay,
  onDiscardNavigation,
  hideBreadcrumbs = false,
}) => {
  const stepCount = graphProjection
    ? graphProjection.children.filter((child) => !child.deleted).length
    : (graphData?.steps.length ?? 0);
  const edgeCount = graphProjection
    ? graphProjection.incidentRelationships.filter(
        (relationship) => !relationship.deleted,
      ).length
    : (graphData?.edges.length ?? 0);
  const isGraphDirty = graphDraft?.isDirty ?? false;
  const handleEditGraph = React.useCallback(() => {
    onEditGraph?.();
  }, [onEditGraph]);
  const handleDiscardGraph = React.useCallback(() => {
    onDiscardGraph?.();
  }, [onDiscardGraph]);
  const handleReviewGraph = React.useCallback(() => {
    onReviewGraph?.();
  }, [onReviewGraph]);
  const conversationPathForId = React.useCallback(
    (conversationId: string): string =>
      `/projects/${projectId}/resolve-agent-session/${conversationId}`,
    [projectId],
  );
  const isDiagramTab = activeTab === "diagram" || activeTab === "workflow";
  const tabs: DetailPageTab[] = [
    { value: "diagram", label: "Diagram" },
    { value: "conversations", label: "Conversations" },
    { value: "admin", label: "Admin" },
  ];
  if (isPlatformAdmin) {
    tabs.push({ value: "data-debug", label: "Data Debug" });
  }
  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    archivedAt: workflow.archivedAt,
  });

  return (
    <>
      {isDiagramTab && !isEditingGraph ? (
        <DiscussCapsuleAction
          entityId={workflow.id}
          entityType={TargetEntityType.Task}
          entityTitle={workflow.name}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : null}
      {isDiagramTab && canEditGraph && !isEditingGraph ? (
        <CapsuleAction
          id="edit-workflow-graph"
          label="Edit"
          icon={EditIcon}
          actionGroup="page"
          tier="page"
          order={100}
          behavior="click"
          onClick={handleEditGraph}
        />
      ) : null}
      {isDiagramTab && canEditGraph && isEditingGraph ? (
        <>
          <CapsuleAction
            id="cancel-workflow-graph"
            label={isGraphDirty ? "Cancel" : "Done"}
            icon={CancelIcon}
            actionGroup="page"
            tier="page"
            order={100}
            behavior="click"
            onClick={handleDiscardGraph}
            disabled={isSubmittingGraph}
            iconStyle={{ backgroundColor: "#6B7280", color: "#fff" }}
          />
          <CapsuleAction
            id="save-workflow-graph"
            label={isSubmittingGraph ? "Saving..." : "Save"}
            icon={SaveIcon}
            actionGroup="page"
            tier="page"
            order={101}
            behavior="click"
            onClick={handleReviewGraph}
            disabled={!isGraphDirty || isSubmittingGraph}
            inProgress={isSubmittingGraph}
          />
        </>
      ) : null}
      {!hideBreadcrumbs && (
        <TaskBreadcrumbs
          projectId={projectId}
          projectName={project?.name}
          task={workflow}
          parent={parent}
          plan={parentPlan}
          featureAncestors={featureAncestors}
          linksEnabled={enableEntityLinks}
        />
      )}
      <DetailPageContainer>
        <DetailPageHeader
          title={workflow.name || "Diagram"}
          subtitle="Diagram"
        />
        <DetailPageTabs
          value={activeTab}
          onChange={onTabChange}
          tabs={tabs}
          overflow="menu"
        />
        {isDiagramTab ? (
          <DetailPageBody
            widthStrategy="equal-split"
            gap={0}
            sidebarSide="right"
            contextualRail={
              !isEditingGraph
                ? {
                    id: `workflow-contextual-rail-${workflow.id}`,
                    label: "Feature Tree",
                    expanded: isTreeVisible,
                    onToggle: onToggleTree,
                  }
                : undefined
            }
            panePadding={{
              content: { p: 3, pb: 6 },
              sidebar: {
                alignSelf: "stretch",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                p: 3,
              },
            }}
            content={
              <Stack
                spacing={3}
                sx={{ minWidth: 0, width: "100%" }}
                data-testid="workflow-detail-page"
              >
                <Box
                  sx={{ minWidth: 0, maxWidth: "100%" }}
                  data-testid="workflow-detail-graph"
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    justifyContent="space-between"
                    spacing={1}
                    sx={{ mb: 1.5 }}
                  >
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Graph
                      </Typography>
                      <Typography variant="h6">Diagram</Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Chip size="small" label={`${stepCount} steps`} />
                      <Chip size="small" label={`${edgeCount} links`} />
                    </Stack>
                  </Stack>

                  {graphSubmissionError ? (
                    <Alert
                      severity="error"
                      data-testid="workflow-graph-submit-error"
                    >
                      {graphSubmissionError.message}
                    </Alert>
                  ) : null}

                  {isEditingGraph && graphDraft && childTypeDefinition ? (
                    <WorkItemGraphEditor
                      draft={graphDraft}
                      participation={graphData?.participation ?? null}
                      childTypeDefinition={childTypeDefinition}
                      organizationId={organizationId}
                      projectId={projectId}
                      disabled={isSubmittingGraph}
                    />
                  ) : graphData ? (
                    <WorkflowGraphSurface
                      graphData={graphData}
                      allowFullscreen
                    />
                  ) : graphProjection ? (
                    <WorkflowGraphSurface
                      projection={graphProjection}
                      organizationId={organizationId}
                      projectId={projectId}
                      allowFullscreen
                    />
                  ) : (
                    <Alert severity="warning">
                      Diagram data is unavailable.
                    </Alert>
                  )}
                </Box>

                {graphLoadError ? (
                  <Alert severity="warning">
                    Diagram links could not be refreshed. The page is showing
                    the available Diagram context.
                  </Alert>
                ) : null}

                <Divider />

                <Box data-testid="workflow-detail-description">
                  <Typography variant="overline" color="text.secondary">
                    Description
                  </Typography>
                  <WorkItemReadView
                    htmlCssRenderingContext="page"
                    sections={workflow.sections}
                  />
                </Box>
              </Stack>
            }
            sidebar={
              !isEditingGraph ? (
                <TaskDetailSidebar
                  organizationId={organizationId}
                  workItemId={workflow.id}
                  projectId={projectId}
                  featureAncestors={featureAncestors}
                  relatedEntities={relatedEntities}
                  proposals={proposals}
                />
              ) : null
            }
          />
        ) : activeTab === "conversations" ? (
          <ConversationListTab
            organizationId={organizationId}
            projectId={projectId}
            entityName={workflow.name}
            workflowAboutId={workflow.id}
            workflowAboutType="task"
            conversationPathForId={conversationPathForId}
          />
        ) : isPlatformAdmin && activeTab === "data-debug" ? (
          <DataDebugTab
            organizationId={organizationId}
            projectId={projectId}
            entityId={workflow.id}
            entityType="task"
          />
        ) : (
          <AdminTab
            metadataItems={adminMetadataItems}
            actions={
              <Button
                startIcon={<DeleteIcon />}
                onClick={onDeleteClick}
                variant="outlined"
                color="error"
                disabled={isDeletingWorkflow}
                size="small"
                data-testid="workflow-delete-button"
              >
                Delete
              </Button>
            }
          />
        )}
        <Dialog
          open={isDeleteDialogOpen}
          onClose={onCancelDelete}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Delete Diagram</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete this Diagram? This action cannot
              be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancelDelete} disabled={isDeletingWorkflow}>
              Cancel
            </Button>
            <Button
              onClick={onConfirmDelete}
              variant="contained"
              color="error"
              disabled={isDeletingWorkflow}
              autoFocus
              data-testid="workflow-admin-confirm-delete-button"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog
          open={isNavigationPromptOpen}
          onClose={onStay}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Discard unsaved graph changes?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This workflow has local graph changes that have not been reviewed.
              Leave this page and discard them?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onStay} data-testid="workflow-graph-stay">
              Stay
            </Button>
            <Button
              onClick={onDiscardNavigation}
              color="warning"
              variant="contained"
              data-testid="workflow-graph-discard-navigation"
            >
              Discard and leave
            </Button>
          </DialogActions>
        </Dialog>
      </DetailPageContainer>
    </>
  );
};
