import { WebPathService } from "@hey-hey/ui-common";
import { TERMS } from "@hey-hey/ui-common/i18n";
import type {
  ConversationResponseDto,
  Priority,
  TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { ProjectStatus, WorkStatus } from "@hey-hey/ui-common/api";
import {
  CapsuleAction,
  InitiativeEditorWalkthrough,
  TagEditor,
  useTaskGenerationCapsuleAction,
  WorkItemEditor,
  WorkItemMetadata,
  WorkItemReadView,
} from "@hey-hey/ui-common/components";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
  TrackingProvider,
  WalkthroughProvider,
  WalkthroughType,
} from "@hey-hey/ui-common/context";
import {
  useInitiative,
  useInitiatives,
  useProject,
  useWorkItems,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { contentToSectionInputs } from "@hey-hey/ui-common/utils";
import ArchiveIcon from "@mui/icons-material/Archive";
import EditIcon from "@mui/icons-material/Edit";
import TasksIcon from "@mui/icons-material/Assignment";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  TextField,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { buildInitiativePresentationSnapshot } from "./initiativePagePresentation";
import {
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  PageBreadcrumbs,
  type DetailPageTab,
} from "../../components/Layout";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import { TaskTab } from "../../components/Tabs/TaskTab";
import { NewTaskModal, type NewTaskFormData } from "../../components/Tasks";
import {
  AppEntityType,
  getBreadcrumbs,
  PageKind,
} from "../../utils/breadcrumbs";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import {
  getStatusColor,
  getStatusLabel,
  isTaskRefining,
} from "../../utils/statusUtils";
import { SetReadyActionCapsule } from "./SetReadyActionCapsule";
import { CreateInitiativePlanActionCapsule } from "./CreateInitiativePlanActionCapsule";

export interface InitiativePageProps {
  organizationId: string;
  projectId: string;
  initiativeId: string;
  preview?: boolean;
}

const PLAN_CREATION_ELIGIBLE_STATUSES = new Set<WorkStatus>([
  WorkStatus.Active,
  WorkStatus.Backlog,
]);

export const InitiativePage: React.FC<InitiativePageProps> = ({
  organizationId: currentOrgId,
  projectId,
  initiativeId,
  preview = false,
}) => {
  const navigate = useNavigate();
  const { isPlatformAdmin } = usePlatformAdminAccess();

  // State for task creation modal
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);

  // State for delete/archive confirmation dialog
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);

  // Edit mode state management
  const [isEditing, setIsEditing] = useState<boolean | null>(null);
  const previousRefiningStateRef = useRef<boolean | null>(null);

  // Tab state management
  const [routeActiveTab, setRouteActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral([
      "initiative",
      "tasks",
      "documents",
      "data-debug",
      "conversations",
      "admin",
    ] as const).withDefault("initiative"),
  );
  const [previewActiveTab, setPreviewActiveTab] =
    useState<typeof routeActiveTab>("initiative");
  const activeTab = preview ? previewActiveTab : routeActiveTab;
  const setActiveTab = useCallback(
    (
      value: Parameters<typeof setRouteActiveTab>[0],
      options?: Parameters<typeof setRouteActiveTab>[1],
    ) => {
      if (preview) {
        setPreviewActiveTab((previous) => {
          const next = typeof value === "function" ? value(previous) : value;
          return next ?? "initiative";
        });
        return;
      }
      return setRouteActiveTab(value, options);
    },
    [preview, setRouteActiveTab],
  );

  // Fetch initiative data
  const {
    data: initiative,
    isLoading,
    isFetched,
    error,
    update: updateInitiative,
  } = useInitiative(currentOrgId!, initiativeId!);

  // Get remove method for deleting initiatives
  const { remove: removeInitiative } = useInitiatives(
    currentOrgId!,
    projectId!,
    undefined,
    {
      enabled: !!currentOrgId && !!projectId,
    },
  );

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      WebPathService.conversation({ projectId: projectId!, conversationId }),
    [projectId],
  );

  // Get createTask from useWorkItems for creating new tasks via modal
  const { createTask, workItems } = useWorkItems(
    currentOrgId!,
    "task",
    projectId!,
    undefined,
    {
      initiativeId: initiativeId!,
      parentTaskId: null,
      includeSectionKeys: ["description"],
    },
  );

  // Auto-enter edit mode if initiative is refining
  useEffect(() => {
    if (isEditing === null && initiative) {
      setIsEditing(isTaskRefining(initiative));
    }
  }, [isEditing, initiative]);

  // Auto-exit edit mode when refining completes
  useEffect(() => {
    if (!initiative) return;

    const currentRefiningState = isTaskRefining(initiative);

    // Exit edit mode only when transitioning from refining to not refining
    if (
      isEditing &&
      previousRefiningStateRef.current === true &&
      currentRefiningState === false
    ) {
      setIsEditing(false);
    }

    previousRefiningStateRef.current = currentRefiningState;
  }, [initiative, isEditing]);

  useEffect(() => {
    if (!isPlatformAdmin && activeTab === "data-debug") {
      void setActiveTab("initiative");
    }
  }, [activeTab, isPlatformAdmin, setActiveTab]);

  const handleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
    setActiveTab("initiative");
  }, [setActiveTab]);

  const handleDoneEditing = useCallback(
    (completedInitiativeId: string) => {
      if (completedInitiativeId !== initiativeId) {
        return;
      }

      setIsEditing(false);
    },
    [initiativeId],
  );

  const handleNewTask = useCallback(() => {
    setIsNewTaskModalOpen(true);
  }, []);

  const handleCloseTaskModal = useCallback(() => {
    setIsNewTaskModalOpen(false);
  }, []);

  const handleSubmitTask = useCallback(
    async (formData: NewTaskFormData) => {
      try {
        await createTask({
          initiativeId: initiativeId!,
          name: formData.name,
          sections: contentToSectionInputs(
            {
              description: formData.description ?? "",
              acceptanceCriteria: formData.acceptanceCriteria ?? "",
            },
            { includeEmpty: false },
          ),
          priority: formData.priority,
          status: formData.status,
        });

        setIsNewTaskModalOpen(false);
        // TODO: Show success toast or refresh task list
      } catch (error) {
        console.error("Failed to create task:", error);
        // TODO: Show error toast
      }
    },
    [createTask, initiativeId],
  );

  const handleTaskGenerationConversationCreated = (
    conversation: ConversationResponseDto,
  ) => {
    // TODO: Navigate to conversation or handle task generation conversation
    console.log("Task generation conversation created:", conversation.id);
  };

  const handleTaskGenerationError = (error: unknown) => {
    // TODO: Handle task generation error (show toast, etc.)
    console.error("Task generation error:", error);
  };

  const { t } = useTranslation();

  const taskGenerationAction = useTaskGenerationCapsuleAction({
    aboutId: initiativeId!,
    aboutType: "initiative",
    aboutTitle: initiative?.name,
    projectId: projectId!,
    organizationId: currentOrgId!,
    status: initiative?.status,
    actionId: "tasks-from-adr",
    label: TERMS.Tasks,
    title: "adr.taskGeneration.title",
  });

  const handleStatusChange = useCallback(
    async (newStatus: WorkStatus) => {
      if (!initiative?.id) return;

      try {
        await updateInitiative({ status: newStatus });
      } catch (error) {
        console.error("Failed to update initiative status:", error);
      }
    },
    [initiative?.id, updateInitiative],
  );

  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      if (!currentOrgId || !initiative) return;

      try {
        await updateInitiative({ name: newTitle });
      } catch (error) {
        console.error("Failed to update initiative:", error);
      }
    },
    [currentOrgId, initiative, updateInitiative],
  );

  const handleTagsChange = useCallback(
    async (tags: string[]) => {
      if (!currentOrgId || !initiative) return;

      try {
        await updateInitiative({ tags });
      } catch (error) {
        console.error("Failed to update initiative tags:", error);
      }
    },
    [currentOrgId, initiative, updateInitiative],
  );

  const handleDueDateChange = useCallback(
    async (dueDate: string | null) => {
      if (!currentOrgId || !initiative) return;

      try {
        await updateInitiative({ dueDate: dueDate ?? undefined });
      } catch (error) {
        console.error("Failed to update initiative due date:", error);
      }
    },
    [currentOrgId, initiative, updateInitiative],
  );

  const handlePriorityChange = useCallback(
    async (newPriority: Priority) => {
      if (!initiative?.id) return;

      try {
        await updateInitiative({ priority: newPriority });
      } catch (error) {
        console.error("Failed to update initiative priority:", error);
      }
    },
    [initiative?.id, updateInitiative],
  );

  const handleAssigneeChange = useCallback(
    async (newAssigneeId: string | null) => {
      if (!initiative?.id) return;

      try {
        await updateInitiative({ assigneeId: newAssigneeId || undefined });
      } catch (error) {
        console.error("Failed to update initiative assignee:", error);
      }
    },
    [initiative?.id, updateInitiative],
  );

  const handleArchiveClick = useCallback(() => {
    setIsConfirmDialogOpen(true);
  }, []);

  const handleConfirmAction = useCallback(async () => {
    if (!initiative) return;

    try {
      await removeInitiative(initiativeId!, {
        onSuccess: () => {
          // Navigate back to initiatives list
          navigate(`/projects/${projectId}/initiatives`);
        },
        onError: (error) => {
          console.error("Failed to delete initiative:", error);
        },
      });
    } catch (error) {
      console.error("Action failed:", error);
    }
  }, [initiative, removeInitiative, initiativeId, navigate, projectId]);

  const handleCancelAction = useCallback(() => {
    setIsConfirmDialogOpen(false);
  }, []);

  const getProgressFromStatus = (status: WorkStatus): number => {
    switch (status) {
      case "REFINING_DESCRIPTION":
        return 33;
      case "REFINING_DETAILS":
        return 66;
      case "REFINING_ACCEPTANCE_CRITERIA":
        return 90;
      case "ACTIVE":
      case "COMPLETED":
        return 100;
      default:
        return 0;
    }
  };

  if (!projectId || !initiativeId || !currentOrgId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required parameters. Please check the URL and try again.
        </Alert>
      </Box>
    );
  }

  const isPageLoading = isLoading || isEditing === null || !isFetched;

  if (isPageLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          p: 4,
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          Loading initiative...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error.message ??
            "Failed to load initiative details. Please try again later."}
        </Alert>
      </Box>
    );
  }

  if (!initiative) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Initiative not found. It may have been removed or the link is invalid.
        </Alert>
      </Box>
    );
  }

  const isRefining = isTaskRefining(initiative);
  const isArchived = initiative.status === "ARCHIVED";

  // Prepare tabs data
  const tabs: DetailPageTab[] = [
    { value: "initiative", label: "Initiative" },
    {
      value: "tasks",
      label: workItems?.length
        ? `${TERMS.Tasks} (${workItems.length})`
        : TERMS.Tasks,
    },
    { value: "documents", label: "Design Documents" },
    { value: "conversations", label: "Conversations" },
    { value: "admin", label: "Admin" },
  ];
  if (isPlatformAdmin) {
    tabs.push({ value: "data-debug", label: "Data Debug" });
  }

  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: initiative.createdAt,
    updatedAt: initiative.updatedAt,
  });

  // Prepare smart breadcrumbs
  const breadcrumbs = getBreadcrumbs(
    AppEntityType.Initiative,
    PageKind.Detail,
    {
      projectId: projectId || "",
      projectName: project?.name,
      initiativeId: initiativeId || "",
      initiativeName: initiative?.name,
      projectStatus: project?.status,
      onboardingComplete: project?.status === ProjectStatus.Active,
      useWorkstreamsTrail: true,
    },
  );
  const pageComposition: CanonicalPageComposition = preview
    ? { kind: "observational" }
    : {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "initiative",
          initiativeId,
          null,
          buildInitiativePresentationSnapshot(initiative.name),
        ),
      };

  return (
    <WalkthroughProvider>
      <TrackingProvider
        context={{
          page: {
            name: "initiative",
            path: WebPathService.initiativeDetail({
              projectId: projectId!,
              initiativeId,
            }),
          },
          initiative: {
            id: initiativeId,
            name: initiative.name,
            status: initiative.status,
            priority: initiative.priority,
          },
          attentionEntity: preview
            ? undefined
            : {
                id: initiativeId,
                type: "initiative",
                name: initiative.name,
                status: initiative.status,
                originatingProjectId: initiative.originatingProjectId,
                linkedProjectIds: initiative.linkedProjectIds,
              },
        }}
      >
        <CanonicalPageBoundary composition={pageComposition}>
          {activeTab === "initiative" && !isEditing && !isRefining && (
            <CapsuleAction
              id="edit-initiative"
              label={t("common.edit", "Edit")}
              icon={EditIcon}
              behavior="click"
              actionGroup="page"
              tier="page"
              order={100}
              onClick={handleEdit}
              disabled={isLoading}
              iconStyle={{ backgroundColor: "#2563EB", color: "#fff" }}
            />
          )}
          <SetReadyActionCapsule
            initiative={initiative}
            onStatusChange={handleStatusChange}
            disabled={isLoading}
          />
          {PLAN_CREATION_ELIGIBLE_STATUSES.has(initiative.status) && (
            <CreateInitiativePlanActionCapsule
              organizationId={currentOrgId}
              projectId={projectId!}
              initiativeId={initiativeId!}
              initiativeName={initiative.name}
            />
          )}
          {/* Breadcrumbs */}
          {!preview && <PageBreadcrumbs sx={{ mb: 2 }} items={breadcrumbs} />}
          <DetailPageContainer>
            {/* Header */}
            <DetailPageHeader
              title={
                isEditing ? (
                  <TextField
                    fullWidth
                    value={initiative.name}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    variant="outlined"
                    size="small"
                    disabled={isLoading}
                    placeholder="Initiative title"
                  />
                ) : (
                  initiative.name
                )
              }
              metadataComponent={
                <Box
                  sx={{
                    display: "flex",
                    gap: 2,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <WorkItemMetadata
                    fields={{
                      status: {
                        mode: "editable",
                        value: initiative.status,
                        onChange: handleStatusChange,
                      },
                      priority: {
                        mode: "editable",
                        value: initiative.priority,
                        onChange: handlePriorityChange,
                      },
                      dueDate: {
                        mode: "editable",
                        value: initiative.dueDate ?? null,
                        onChange: handleDueDateChange,
                      },
                      assignee: {
                        mode: "editable",
                        value: initiative.assigneeId ?? null,
                        onChange: handleAssigneeChange,
                      },
                    }}
                    organizationId={currentOrgId!}
                    projectId={projectId}
                    size="small"
                    rootSx={{
                      flex: "1",
                    }}
                  />
                </Box>
              }
            />
            <DetailPageTabs
              value={activeTab}
              onChange={setActiveTab}
              tabs={tabs}
            />

            {isTaskRefining(initiative) && (
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 2,
                  mb: 3,
                  mt: 2,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {getProgressFromStatus(initiative.status)}% refinement
                  complete
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minWidth: 200,
                    flex: 1,
                    maxWidth: 360,
                  }}
                >
                  <LinearProgress
                    variant="determinate"
                    value={getProgressFromStatus(initiative.status)}
                    sx={{
                      flex: 1,
                      height: 6,
                      borderRadius: 2,
                      backgroundColor: "rgba(0, 0, 0, 0.1)",
                      "& .MuiLinearProgress-bar": {
                        borderRadius: 2,
                        backgroundColor: "heyhey.main",
                      },
                    }}
                  />
                  <Chip
                    label={getStatusLabel(initiative.status)}
                    size="small"
                    color={getStatusColor(initiative.status)}
                    variant="outlined"
                  />
                </Box>
              </Box>
            )}

            <AnimatePresence mode="wait">
              {/* Initiative Tab */}
              {activeTab === "initiative" && (
                <motion.div
                  key="initiative"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {isEditing ? (
                    <Box sx={{ position: "relative" }}>
                      <Box
                        sx={{
                          p: 3,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        {/* Tags */}
                        <TagEditor
                          tags={initiative.tags || []}
                          onTagsChange={handleTagsChange}
                          disabled={isLoading}
                        />
                      </Box>

                      <WorkItemEditor
                        entityType="initiative"
                        workItemId={initiativeId}
                        organizationId={currentOrgId}
                        projectId={projectId}
                        initiativeId={initiativeId}
                        title={initiative.name}
                        onDone={handleDoneEditing}
                      />

                      {/* Walkthrough */}
                      <InitiativeEditorWalkthrough
                        autoStart={true}
                        walkthroughType={WalkthroughType.INITIATIVE_EDITOR}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ p: 3 }}>
                      <WorkItemReadView
                        sections={initiative.sections}
                        sectionSelection={{
                          status: "resolved",
                          typeKey: "initiative",
                          sections: [
                            { key: "description", label: "Description" },
                            {
                              key: "acceptanceCriteria",
                              label: "Acceptance Criteria",
                            },
                          ],
                        }}
                      />
                    </Box>
                  )}
                </motion.div>
              )}

              {/* Tasks Tab */}
              {activeTab === "tasks" && (
                <motion.div
                  key="tasks"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <TaskTab
                    projectId={projectId!}
                    initiativeId={initiativeId!}
                    initiativeName={initiative.name}
                    organizationId={currentOrgId}
                    tasks={workItems as TaskResponseDto[]}
                    loading={isLoading}
                    expandable={true}
                    enableFilters={true}
                    onNewTask={handleNewTask}
                    onTaskGenerationConversationCreated={
                      handleTaskGenerationConversationCreated
                    }
                    onTaskGenerationError={handleTaskGenerationError}
                  />
                </motion.div>
              )}

              {/* Design Documents Tab */}
              {activeTab === "documents" && (
                <motion.div
                  key="documents"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <DesignDocsTab
                    organizationId={currentOrgId}
                    projectId={projectId!}
                    initiativeId={initiativeId!}
                    enableFilters={true}
                    emptyMessage="No design documents linked to this initiative yet."
                  />
                </motion.div>
              )}

              {/* Data Debug Tab */}
              {isPlatformAdmin && activeTab === "data-debug" && (
                <motion.div
                  key="data-debug"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <DataDebugTab
                    organizationId={currentOrgId}
                    projectId={projectId}
                    entityId={initiativeId}
                    entityType="initiative"
                  />
                </motion.div>
              )}

              {/* Conversations Tab */}
              {activeTab === "conversations" && (
                <motion.div
                  key="conversations"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <ConversationListTab
                    organizationId={currentOrgId ?? ""}
                    projectId={projectId}
                    entityName={initiative.name}
                    workflowAboutId={initiativeId}
                    workflowAboutType="initiative"
                    conversationPathForId={conversationPathForId}
                  />
                </motion.div>
              )}

              {activeTab === "admin" && (
                <motion.div
                  key="admin"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <AdminTab
                    metadataItems={adminMetadataItems}
                    actions={
                      <Button
                        startIcon={<ArchiveIcon />}
                        onClick={handleArchiveClick}
                        variant="outlined"
                        disabled={isArchived}
                        size="small"
                      >
                        Archive{isArchived ? "d" : ""}
                      </Button>
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {initiative?.status === WorkStatus.Active && (
              <CapsuleAction
                id={taskGenerationAction.actionId}
                label={t(taskGenerationAction.label)}
                icon={TasksIcon}
                inProgress={taskGenerationAction.inProgress}
                renderContent={taskGenerationAction.renderContent}
                title={t(taskGenerationAction.title)}
                behavior="expand"
                tier="page"
                order={1}
                menuItems={taskGenerationAction.menuItems}
                resumable={taskGenerationAction.resumable}
                expandable={taskGenerationAction.expandable}
              />
            )}

            {/* New Task Modal */}
            <NewTaskModal
              open={isNewTaskModalOpen}
              onClose={handleCloseTaskModal}
              onSubmit={handleSubmitTask}
              initiativeId={initiativeId!}
            />

            {/* Confirmation Dialog for Delete/Archive */}
            <Dialog
              open={isConfirmDialogOpen}
              onClose={handleCancelAction}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle> Archive Initiative</DialogTitle>
              <DialogContent>
                <DialogContentText>
                  Are you sure you want to archive this initiative? It will be
                  marked as archived and will no longer appear in active
                  initiative lists.
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleCancelAction}>Cancel</Button>
                <Button
                  onClick={handleConfirmAction}
                  variant="contained"
                  color={"primary"}
                  autoFocus
                >
                  Archive
                </Button>
              </DialogActions>
            </Dialog>
          </DetailPageContainer>
        </CanonicalPageBoundary>
      </TrackingProvider>
    </WalkthroughProvider>
  );
};
