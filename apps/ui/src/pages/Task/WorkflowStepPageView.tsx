import { WebPathService } from "@hey-hey/ui-common/services";
import React from "react";
import type { Options } from "nuqs";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import LoopIcon from "@mui/icons-material/Loop";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type PlanContextEntryDto,
  TargetEntityType,
} from "@hey-hey/ui-common/api";
import {
  DiscussCapsuleAction,
  WorkItemReadView,
} from "@hey-hey/ui-common/components";
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
import type {
  NormalizedWorkflowStepEdge,
  WorkflowWorkItem,
} from "./workflowStepEdges";

type WorkflowStepPageActiveTab =
  "step" | "conversations" | "data-debug" | "admin";

type WorkflowStepPageTabChange = (
  value:
    | WorkflowStepPageActiveTab
    | ((old: WorkflowStepPageActiveTab) => WorkflowStepPageActiveTab | null)
    | null,
  options?: Options,
) => void | Promise<URLSearchParams>;

// Diagram Elements retain TASK identity for proposals and durable task URLs.
const WORKFLOW_STEP_ENTITY_TYPE = TargetEntityType.Task;

export type LinkedDiagramState =
  | { status: "absent" | "loading" | "unavailable" }
  | { status: "ready"; diagram: WorkflowWorkItem };

interface WorkflowStepPageViewProps {
  linkedDiagram: LinkedDiagramState;
  organizationId: string;
  projectId: string;
  task: WorkflowWorkItem;
  parentWorkflow?: WorkflowWorkItem | null;
  project?: { id: string; name?: string } | null;
  graphData: WorkflowGraphSurfaceData | null;
  featureAncestors: BreadcrumbFeatureAncestor[];
  relatedEntities: ContextRelatedEntityDto[];
  proposals: EntityContextDtoProposalsInner[];
  parentPlan?: PlanContextEntryDto;
  isPlatformAdmin: boolean;
  conversationPathForId: (conversationId: string) => string;
  activeTab: WorkflowStepPageActiveTab;
  onTabChange: WorkflowStepPageTabChange;
  flowLinks: NormalizedWorkflowStepEdge[];
  fulfillmentLinks: NormalizedWorkflowStepEdge[];
  isTreeVisible: boolean;
  onToggleTree: () => void;
  edgeLoadError?: Error | null;
  enableEntityLinks?: boolean;
  isDeleteDialogOpen: boolean;
  isDeletingStep: boolean;
  onDeleteClick: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
}

const flowIconByType = {
  STANDARD: <ArrowForwardIcon fontSize="small" />,
  CONDITIONAL: <CallSplitIcon fontSize="small" />,
  LOOP: <LoopIcon fontSize="small" />,
};

const formatEdgeDirection = (edge: NormalizedWorkflowStepEdge): string => {
  if (edge.directionFromStep === "self") {
    return "Self loop";
  }

  return edge.directionFromStep === "outbound" ? "Outgoing" : "Incoming";
};

const edgeTargetLabel = (edge: NormalizedWorkflowStepEdge): string =>
  edge.connectedNodeName ?? edge.connectedNodeId;

const renderFlowLinkRow = (
  edge: NormalizedWorkflowStepEdge,
): React.ReactNode => (
  <Box
    key={edge.id}
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      p: 1.5,
    }}
  >
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
      {flowIconByType[edge.type as keyof typeof flowIconByType]}
      <Chip size="small" label={edge.type} />
      <Typography variant="body2" color="text.secondary">
        {formatEdgeDirection(edge)}
      </Typography>
    </Stack>
    <Typography variant="body2">{edgeTargetLabel(edge)}</Typography>
    {edge.predicate ? (
      <Typography variant="caption" color="text.secondary">
        Predicate: {String(edge.predicate)}
      </Typography>
    ) : null}
  </Box>
);

const renderFulfillmentRow = (
  edge: NormalizedWorkflowStepEdge,
): React.ReactNode => (
  <Box
    key={edge.id}
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      p: 1.5,
    }}
  >
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
      <CheckCircleIcon fontSize="small" color="success" />
      <Chip size="small" color="success" label="FULFILLED_BY" />
      <Typography variant="body2" color="text.secondary">
        {formatEdgeDirection(edge)}
      </Typography>
    </Stack>
    <Typography variant="body2">{edgeTargetLabel(edge)}</Typography>
  </Box>
);

export const WorkflowStepPageView: React.FC<WorkflowStepPageViewProps> = ({
  organizationId,
  projectId,
  task,
  parentWorkflow,
  linkedDiagram,
  project,
  graphData,
  featureAncestors,
  relatedEntities,
  proposals,
  parentPlan,
  isPlatformAdmin,
  conversationPathForId,
  activeTab,
  onTabChange,
  flowLinks,
  fulfillmentLinks,
  isTreeVisible,
  onToggleTree,
  edgeLoadError,
  enableEntityLinks = true,
  isDeleteDialogOpen,
  isDeletingStep,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
}) => {
  const stepCount = graphData?.steps.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;
  const tabs: DetailPageTab[] = [
    { value: "step", label: "Diagram Element" },
    { value: "conversations", label: "Conversations" },
    { value: "admin", label: "Admin" },
  ];
  if (isPlatformAdmin) {
    tabs.push({ value: "data-debug", label: "Data Debug" });
  }
  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archivedAt: task.archivedAt,
  });

  return (
    <>
      {activeTab === "step" ? (
        <DiscussCapsuleAction
          entityId={task.id}
          entityType={WORKFLOW_STEP_ENTITY_TYPE}
          entityTitle={task.name}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : null}
      <TaskBreadcrumbs
        projectId={projectId}
        projectName={project?.name}
        task={task}
        parent={parentWorkflow}
        plan={parentPlan}
        featureAncestors={featureAncestors}
        linksEnabled={enableEntityLinks}
      />
      <DetailPageContainer>
        <DetailPageHeader
          title={task.name || "Diagram Element"}
          subtitle="Diagram Element"
        />
        <DetailPageTabs
          value={activeTab}
          onChange={onTabChange}
          tabs={tabs}
          overflow="menu"
        />
        {activeTab === "step" ? (
          <DetailPageBody
            widthStrategy="equal-split"
            gap={0}
            sidebarSide="right"
            contextualRail={{
              id: `workflow-step-contextual-rail-${task.id}`,
              label: "Feature Tree",
              expanded: isTreeVisible,
              onToggle: onToggleTree,
            }}
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
                data-testid="workflow-step-page"
              >
                {parentWorkflow ? (
                  <Box
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 2,
                    }}
                    data-testid="workflow-step-parent-workflow"
                  >
                    <Typography variant="overline" color="text.secondary">
                      Part of diagram
                    </Typography>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      alignItems={{ xs: "flex-start", sm: "center" }}
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Typography variant="h6">
                        {parentWorkflow.name}
                      </Typography>
                      {enableEntityLinks ? (
                        <Button
                          component={RouterLink}
                          to={WebPathService.task({
                            projectId,
                            taskId: parentWorkflow.id,
                          })}
                          size="small"
                          endIcon={<OpenInNewIcon />}
                        >
                          Open Diagram
                        </Button>
                      ) : null}
                    </Stack>
                  </Box>
                ) : (
                  <Alert severity="warning">
                    Part of diagram context is unavailable for this element.
                  </Alert>
                )}

                {linkedDiagram.status !== "absent" ? (
                  <Box
                    data-testid="workflow-step-linked-diagram"
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 2,
                    }}
                  >
                    <Typography variant="overline" color="text.secondary">
                      Links to diagram
                    </Typography>
                    {linkedDiagram.status === "ready" ? (
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Typography variant="h6">
                          {linkedDiagram.diagram.name}
                        </Typography>
                        {enableEntityLinks ? (
                          <Button
                            component={RouterLink}
                            to={WebPathService.task({
                              projectId,
                              taskId: linkedDiagram.diagram.id,
                            })}
                          >
                            Open linked Diagram
                          </Button>
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography role="status">
                        {linkedDiagram.status === "loading"
                          ? "Loading linked Diagram…"
                          : "Linked Diagram is unavailable."}
                      </Typography>
                    )}
                  </Box>
                ) : null}
                <Box
                  sx={{ minWidth: 0, maxWidth: "100%" }}
                  data-testid="workflow-step-graph"
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

                  {graphData ? (
                    <WorkflowGraphSurface
                      graphData={graphData}
                      allowFullscreen
                      disableLinks={!enableEntityLinks}
                      highlightedStepId={task.id}
                    />
                  ) : (
                    <Alert severity="warning">
                      Diagram data is unavailable for this element.
                    </Alert>
                  )}
                </Box>

                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Body
                  </Typography>
                  <WorkItemReadView
                    htmlCssRenderingContext="page"
                    sections={task.sections}
                    sectionSelection={{
                      status: "resolved",
                      typeKey: task.type,
                      sections: [{ key: "description", label: "Description" }],
                    }}
                  />
                </Box>

                <Divider />

                <Box data-testid="workflow-step-flow-links">
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    mb={1.5}
                  >
                    <Typography variant="h6">Flow Links</Typography>
                    <Chip size="small" label={flowLinks.length} />
                  </Stack>
                  {flowLinks.length > 0 ? (
                    <Stack spacing={1.25}>
                      {flowLinks.map(renderFlowLinkRow)}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No Diagram flow links attached to this element.
                    </Typography>
                  )}
                </Box>

                <Box data-testid="workflow-step-fulfillment-links">
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    mb={1.5}
                  >
                    <Typography variant="h6">Fulfillment Metadata</Typography>
                    <Chip size="small" label={fulfillmentLinks.length} />
                  </Stack>
                  {fulfillmentLinks.length > 0 ? (
                    <Stack spacing={1.25}>
                      {fulfillmentLinks.map(renderFulfillmentRow)}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No fulfillment target is attached to this step.
                    </Typography>
                  )}
                </Box>

                {edgeLoadError ? (
                  <Alert severity="warning">
                    Diagram links could not be refreshed. The page is showing
                    the available step context.
                  </Alert>
                ) : null}
              </Stack>
            }
            sidebar={
              <TaskDetailSidebar
                organizationId={organizationId}
                workItemId={task.id}
                projectId={projectId}
                featureAncestors={featureAncestors}
                relatedEntities={relatedEntities}
                proposals={proposals}
              />
            }
          />
        ) : activeTab === "conversations" ? (
          <ConversationListTab
            organizationId={organizationId}
            projectId={projectId}
            entityName={task.name}
            workflowAboutId={task.id}
            workflowAboutType="task"
            conversationPathForId={conversationPathForId}
          />
        ) : isPlatformAdmin && activeTab === "data-debug" ? (
          <DataDebugTab
            organizationId={organizationId}
            projectId={projectId}
            entityId={task.id}
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
                disabled={isDeletingStep}
                size="small"
                data-testid="workflow-step-delete-button"
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
          <DialogTitle>Delete Diagram Element</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete this Diagram element? This action
              cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancelDelete} disabled={isDeletingStep}>
              Cancel
            </Button>
            <Button
              onClick={onConfirmDelete}
              variant="contained"
              color="error"
              disabled={isDeletingStep}
              autoFocus
              data-testid="workflow-step-admin-confirm-delete-button"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      </DetailPageContainer>
    </>
  );
};
