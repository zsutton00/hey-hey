import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import type { Options } from "nuqs";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TargetEntityType,
  TaskPriority as Priority,
  WorkStatus,
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type MaterializedWorkItemSection,
  type PlanContextEntryDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  CapsuleAction,
  DependentFutures,
  DiscussCapsuleAction,
  EntityGrid,
  EntityListItem,
  InteractionComponent,
  WorkItemEditor,
  WorkItemMetadata,
  WorkItemReadView,
  WorkItemEntityFilters,
  WorkItemUnsavedChangesBridge,
  taskAdapter,
  useFilteredWorkItems,
  type UseTaskGenerationCapsuleActionResult,
} from "@hey-hey/ui-common/components";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import { createNavigationLineageEntry, type Stable } from "@hey-hey/ui-common";
import { WebPathService } from "@hey-hey/ui-common/services";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import TasksIcon from "@mui/icons-material/Assignment";

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
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import {
  TaskBreadcrumbs,
  type BreadcrumbFeatureAncestor,
} from "../../components/TaskBreadcrumbs";
import { NewTaskModal, type NewTaskFormData } from "../../components/Tasks";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";
import {
  isFilesTabSupported,
  WorkItemFilesTab,
} from "../../components/Tabs/WorkItemFilesTab";
import {
  canWorkItemTypeOwnAgentSessions,
  getWorkItemTypeDisplayName,
  getWorkItemTypePluralDisplayName,
  workItemTypeOffersStatusChoice,
  workItemTypeSurfacesLifecycleScalars,
  type WorkItemSectionSelection,
} from "../../types/workItemTypes";
import {
  buildWorkItemRoleNavigationGroups,
  getWorkItemRoleNavigationTooltip,
  resolveWorkItemRoleNavigationTypeKey,
} from "../../types/workItemNavigation";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { SetReadyActionCapsule } from "./SetReadyActionCapsule";
import { TaskAgentSessionsTab } from "./TaskAgentSessionsTab";
import { TaskDetailSidebar } from "./TaskDetailSidebar";

export type TaskPageTabChange = (
  value: string | null | ((old: string) => string | null),
  options?: Options,
) => void | Promise<URLSearchParams>;

export interface TaskPageViewProps {
  // identifiers
  organizationId: string;
  projectId: string;
  initiativeId: string;
  taskId: string;

  // task data
  task: TaskResponseDto;
  parent: TaskResponseDto | null | undefined;
  children: TaskResponseDto[];
  project: { id: string; name?: string } | null | undefined;
  taskWithServiceRelations: TaskResponseDto | null;
  taskServiceIds: string[];
  workItemTypeDefinition?: WorkItemTypeDefinitionDto;
  activeChildTypeDefinition?: WorkItemTypeDefinitionDto;
  workItemSectionSelection: WorkItemSectionSelection;
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;
  activeWorkItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;

  // capability flags / loading
  isPlatformAdmin: boolean;
  isTaskLoading: boolean;
  isRefining: boolean;
  isUpdatingTaskServices: boolean;

  // tab counts
  childTaskCount: number | undefined;
  codingSessionCount: number | undefined;
  agentSessionCount: number | undefined;

  // capsule actions
  taskGenerationAction: UseTaskGenerationCapsuleActionResult;

  // sidebar context
  featureAncestors: BreadcrumbFeatureAncestor[];
  relatedEntities: ContextRelatedEntityDto[];
  proposals: EntityContextDtoProposalsInner[];
  parentPlan?: PlanContextEntryDto;

  // relationship for data-debug
  relationshipEntityId: string;
  relationshipEntityType: "plan" | "task";

  // conversations
  conversationPathForId: (conversationId: string) => string;

  // registry-driven children tab config
  allowedChildTypes: readonly string[];

  // view state
  activeTab: string;
  activeType: string | null;
  isEditing: boolean;
  isNewTaskModalOpen: boolean;
  isCreatingChildTask: boolean;
  isDeleteDialogOpen: boolean;
  isDeletingTask: boolean;
  isTreeVisible: boolean;

  // callbacks
  onEdit: Stable<() => void>;
  onDone?: (taskId: string) => void;
  onTabChange: TaskPageTabChange;
  onTitleChange: (newTitle: string) => Promise<void>;
  onStatusChange: (newStatus: WorkStatus) => Promise<void>;
  onPriorityChange: (newPriority: Priority) => Promise<void>;
  onDueDateChange: (newDueDate: string | null) => Promise<void>;
  onAssigneeChange: (newAssigneeId: string | null) => Promise<void>;
  onTaskServicesChange: (nextServiceIds: string[]) => Promise<void>;
  onOpenNewTaskModal: () => void;
  onCloseNewTaskModal: () => void;
  onSubmitNewTask: (formData: NewTaskFormData) => Promise<void>;
  onDeleteClick: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onToggleTree: () => void;

  /**
   * Optional override for the body rendered when `activeTab === 'agent-sessions'`.
   * When omitted, the smart `<TaskAgentSessionsTab>` is rendered as before. The
   * project-setup demo uses this to mount a presentational sessions list driven
   * by synthetic data, so the scene never reaches the network.
   */
  agentSessionsTabBody?: React.ReactNode;
  hideBreadcrumbs?: boolean;
  trackingContextOverride?: React.ComponentProps<
    typeof TrackingProvider
  >["context"];
}

export const TaskPageView: React.FC<TaskPageViewProps> = ({
  organizationId,
  projectId,
  initiativeId,
  taskId,
  task,
  parent,
  children,
  project,
  taskWithServiceRelations,
  taskServiceIds,
  workItemTypeDefinition,
  activeChildTypeDefinition,
  workItemSectionSelection,
  workItemTypeDefinitions,
  activeWorkItemTypeDefinitions,
  isPlatformAdmin,
  isTaskLoading,
  isRefining,
  isUpdatingTaskServices,
  childTaskCount,
  codingSessionCount,
  agentSessionCount,
  taskGenerationAction,
  featureAncestors,
  relatedEntities,
  proposals,
  parentPlan,
  relationshipEntityId,
  relationshipEntityType,
  conversationPathForId,
  allowedChildTypes,
  activeTab,
  activeType,
  isEditing,
  isNewTaskModalOpen,
  isCreatingChildTask,
  isDeleteDialogOpen,
  isDeletingTask,
  isTreeVisible,
  onEdit,
  onDone,
  onTabChange,
  onToggleTree,
  onTitleChange,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onAssigneeChange,
  onTaskServicesChange,
  onOpenNewTaskModal,
  onCloseNewTaskModal,
  onSubmitNewTask,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
  hideBreadcrumbs = false,
  trackingContextOverride,
  agentSessionsTabBody,
}) => {
  const { t } = useTranslation();
  const isPreviewPresentation = usePreviewPresentation();

  const activeTask = taskWithServiceRelations ?? task;
  const isTypeDefinitionResolved =
    workItemSectionSelection.status === "resolved" &&
    workItemTypeDefinition?.key === task.type;
  const typeDisplayName = isTypeDefinitionResolved
    ? getWorkItemTypeDisplayName(workItemTypeDefinition)
    : undefined;
  const parentTypeDisplayName = parent
    ? getWorkItemTypeDisplayName(workItemTypeDefinitions.get(parent.type))
    : undefined;
  const surfacesLifecycleScalars =
    isTypeDefinitionResolved &&
    workItemTypeSurfacesLifecycleScalars(workItemTypeDefinition);
  const offersStatusChoice =
    isTypeDefinitionResolved &&
    workItemTypeOffersStatusChoice(workItemTypeDefinition);
  const canOwnAgentSessions =
    isTypeDefinitionResolved &&
    canWorkItemTypeOwnAgentSessions(workItemTypeDefinition);
  const hasAllowedChildTypes =
    isTypeDefinitionResolved && allowedChildTypes.length > 0;

  const childNavigationGroups = useMemo(
    () =>
      buildWorkItemRoleNavigationGroups(
        activeWorkItemTypeDefinitions,
        allowedChildTypes,
      ),
    [activeWorkItemTypeDefinitions, allowedChildTypes],
  );
  const filesTabSupported = isFilesTabSupported({
    status: workItemSectionSelection.status,
    typeKey: workItemTypeDefinition?.key,
  });

  const activeChildTypeKey = resolveWorkItemRoleNavigationTypeKey(
    childNavigationGroups,
    activeTab,
    activeType,
  );
  const activeChildTypeDefinitionFromRegistry = activeChildTypeKey
    ? activeWorkItemTypeDefinitions.get(activeChildTypeKey)
    : undefined;
  const selectedChildTypeDefinition =
    activeChildTypeDefinition ?? activeChildTypeDefinitionFromRegistry;
  const activeChildNavigationGroup = childNavigationGroups.find((group) =>
    group.items.some((item) => item.key === activeChildTypeKey),
  );
  const isActiveChildTab =
    activeChildTypeKey !== undefined &&
    allowedChildTypes.includes(activeChildTypeKey);

  const [childSearchTerm, setChildSearchTerm] = useState("");
  const [childStatusFilter, setChildStatusFilter] = useState<WorkStatus | "">(
    "",
  );
  const [childSortBy, setChildSortBy] = useState("status");

  const visibleChildren = useFilteredWorkItems<TaskResponseDto>(
    children,
    childSearchTerm,
    childStatusFilter,
    childSortBy,
  );

  const activeChildTypeName = getWorkItemTypeDisplayName(
    selectedChildTypeDefinition,
  );
  const activeChildTypePluralName = getWorkItemTypePluralDisplayName(
    selectedChildTypeDefinition,
  );
  const createButtonLabel = activeChildTypeName
    ? `Add ${activeChildTypeName}`
    : undefined;
  const tabs = useMemo<DetailPageTab[]>(() => {
    if (!isTypeDefinitionResolved || !typeDisplayName) return [];

    const childRoleTabs: DetailPageTab[] = childNavigationGroups.map(
      (group) => ({
        value: group.role,
        label: group.label,
        tooltip: getWorkItemRoleNavigationTooltip(group.items),
      }),
    );

    const built: DetailPageTab[] = [{ value: "task", label: typeDisplayName }];

    if (canOwnAgentSessions) {
      built.push({
        value: "agent-sessions",
        label: `Agent Sessions${codingSessionCount ? ` (${codingSessionCount})` : ""}`,
      });
    }

    built.push(...childRoleTabs);

    if (filesTabSupported) {
      built.push({ value: "files", label: "Files" });
    }

    built.push(
      {
        value: "documents",
        label: `Design Docs${
          task?.designDocCount ? ` (${task.designDocCount})` : ""
        }`,
      },
      {
        value: "conversations",
        label: `Conversations${agentSessionCount ? ` (${agentSessionCount})` : ""}`,
      },
      { value: "admin", label: "Admin" },
    );

    if (isPlatformAdmin) {
      built.push({ value: "data-debug", label: "Data Debug" });
    }

    return built;
  }, [
    agentSessionCount,
    childNavigationGroups,
    canOwnAgentSessions,
    codingSessionCount,
    isPlatformAdmin,
    filesTabSupported,
    isTypeDefinitionResolved,
    task?.designDocCount,
    typeDisplayName,
  ]);

  const displayedTab = activeChildNavigationGroup?.role ?? activeTab;
  const childTypeSegments = activeChildNavigationGroup?.items.map((item) => ({
    value: item.key,
    label:
      item.key === activeChildTypeKey && childTaskCount
        ? `${item.label} (${childTaskCount})`
        : item.label,
  }));
  const handleChildTypeChange = (typeKey: string): void => {
    onTabChange(`children:${typeKey}`);
  };

  // Keep the mutation owner mounted through optimistic completion and its
  // response. The capsule itself hides when no action is available.
  const showStatusActionCapsule = surfacesLifecycleScalars;
  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: task?.createdAt,
    updatedAt: task?.updatedAt,
    archivedAt: task?.archivedAt,
  });

  return (
    <TrackingProvider
      context={{
        page: {
          name: "task",
          path: WebPathService.task({
            projectId,
            initiativeId,
            taskId,
          }),
        },
        task: {
          id: taskId,
          name: task.name,
          status: task.status,
          priority: task.priority!,
        },
        attentionEntity: {
          id: taskId,
          type: "task",
          lineage: [createNavigationLineageEntry("task", taskId)],
          name: task.name,
          status: task.status,
        },
        ...trackingContextOverride,
      }}
    >
      <WorkItemUnsavedChangesBridge>
        {activeTab === "task" && !isEditing && !isRefining && (
          <CapsuleAction
            id="edit-task"
            label={t("common.edit", "Edit")}
            icon={EditIcon}
            actionGroup="page"
            tier="page"
            order={100}
            behavior="click"
            onClick={onEdit}
            disabled={isTaskLoading}
          />
        )}
        {activeTab === "task" && showStatusActionCapsule && (
          <SetReadyActionCapsule
            organizationId={organizationId}
            projectId={projectId}
            task={activeTask}
            pulse
          />
        )}
        {activeTab === "task" && !isEditing && !isRefining && (
          <DiscussCapsuleAction
            entityId={taskId}
            entityType={TargetEntityType.Task}
            entityTitle={task.name}
            organizationId={organizationId}
            projectId={projectId}
          />
        )}
        {!hideBreadcrumbs && (
          <TaskBreadcrumbs
            projectId={projectId}
            projectName={project?.name}
            task={task}
            parent={parent}
            plan={parentPlan}
            featureAncestors={featureAncestors}
            taskTypeName={typeDisplayName}
            parentTypeName={parentTypeDisplayName}
          />
        )}
        <DetailPageContainer>
          <InteractionComponent
            draggable={false}
            disablePreview={true}
            entityId={taskId}
            entityType={TargetEntityType.Task}
            hasProposalSupport={!isEditing && activeTab === "task"}
            organizationId={organizationId}
            projectId={projectId}
            entityTitle={task.name}
            size="medium"
            indicatorPlacement="bottom-left"
          >
            <DetailPageHeader
              hideTitleOnMobile={!isEditing}
              title={
                isEditing ? (
                  <Box height={56} width="70%">
                    <TextField
                      fullWidth
                      value={task.name}
                      onChange={(e) => onTitleChange(e.target.value)}
                      variant="outlined"
                      size="small"
                      disabled={isTaskLoading}
                      placeholder={
                        typeDisplayName ? `${typeDisplayName} title` : "Title"
                      }
                    />
                  </Box>
                ) : (
                  task.name || typeDisplayName || "Untitled work item"
                )
              }
              metadataComponent={
                surfacesLifecycleScalars || offersStatusChoice ? (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 2,
                    }}
                  >
                    <WorkItemMetadata
                      fields={{
                        status: {
                          mode: "editable",
                          value: task.status,
                          onChange: onStatusChange,
                        },
                        ...(surfacesLifecycleScalars && {
                          priority: {
                            mode: "editable",
                            value: task.priority ?? Priority.Low,
                            onChange: onPriorityChange,
                          },
                          dueDate: {
                            mode: "editable",
                            value: task.dueDate ?? null,
                            onChange: onDueDateChange,
                          },
                          assignee: {
                            mode: "editable",
                            value: task.assigneeId ?? null,
                            onChange: onAssigneeChange,
                          },
                        }),
                      }}
                      currentTaskId={task.id}
                      taskType={task.type}
                      organizationId={organizationId}
                      projectId={projectId}
                      taskServices={
                        surfacesLifecycleScalars && taskWithServiceRelations
                          ? {
                              serviceIds: taskServiceIds,
                              onChange: onTaskServicesChange,
                            }
                          : undefined
                      }
                      disabled={isUpdatingTaskServices}
                      size="small"
                    />
                  </Box>
                ) : undefined
              }
            />
            {!isRefining && tabs.length > 0 && (
              <DetailPageTabs
                value={displayedTab}
                onChange={onTabChange}
                tabs={tabs}
                overflow="menu"
              />
            )}
            {childTypeSegments && (
              <Box
                data-testid="entity-page-child-type-tabs"
                sx={{ mt: 2, mb: 1, maxWidth: "100%", minWidth: 0 }}
              >
                <SegmentedToggle
                  segments={childTypeSegments}
                  value={
                    activeChildTypeKey ?? childTypeSegments[0]?.value ?? ""
                  }
                  onChange={handleChildTypeChange}
                  mobileDropdown
                />
              </Box>
            )}

            <AnimatePresence mode="wait">
              {activeTab === "task" && (
                <motion.div
                  key="task"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {isEditing ? (
                    <Box sx={{ position: "relative" }}>
                      <WorkItemEditor
                        entityType="task"
                        workItemId={taskId}
                        organizationId={organizationId}
                        projectId={projectId}
                        initiativeId={initiativeId}
                        title={task.name}
                        onDone={onDone}
                      />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        minHeight: 400,
                        position: "relative",
                      }}
                    >
                      <DetailPageBody
                        widthStrategy="equal-split"
                        gap={0}
                        sidebarSide="right"
                        contextualRail={{
                          id: `task-contextual-rail-${task.id}`,
                          label: t("features.featureTree", "Feature Tree"),
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
                          <WorkItemReadView
                            htmlCssRenderingContext="page"
                            sections={
                              task.sections as
                                MaterializedWorkItemSection[] | undefined
                            }
                            sectionSelection={workItemSectionSelection}
                          />
                        }
                        sidebar={
                          <Box>
                            <DependentFutures
                              key={task.id}
                              organizationId={organizationId}
                              projectId={projectId}
                              taskId={task.id}
                            />
                            <TaskDetailSidebar
                              organizationId={organizationId}
                              workItemId={taskId}
                              projectId={projectId}
                              featureAncestors={featureAncestors}
                              relatedEntities={relatedEntities}
                              proposals={proposals}
                            />
                          </Box>
                        }
                      />
                    </Box>
                  )}
                </motion.div>
              )}

              {hasAllowedChildTypes && isActiveChildTab && (
                <motion.div
                  key={activeTab}
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <Box sx={{ p: 3 }}>
                    {!isPreviewPresentation &&
                      activeChildTypeKey &&
                      createButtonLabel &&
                      children.length > 0 && (
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "flex-end",
                            mb: 2,
                          }}
                        >
                          <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={onOpenNewTaskModal}
                            data-testid="task-children-create-button"
                          >
                            {createButtonLabel}
                          </Button>
                        </Box>
                      )}
                    {children.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <WorkItemEntityFilters
                          searchTerm={childSearchTerm}
                          onSearchChange={setChildSearchTerm}
                          statusFilter={childStatusFilter}
                          onStatusFilterChange={setChildStatusFilter}
                          sortBy={childSortBy}
                          onSortByChange={setChildSortBy}
                        />
                      </Box>
                    )}
                    <EntityGrid<TaskResponseDto>
                      items={visibleChildren}
                      loading={isTaskLoading}
                      renderItem={(child) => {
                        const props = taskAdapter.toEntityListItemProps(child, {
                          projectId,
                          initiativeId: child.initiativeId,
                        });
                        return (
                          <InteractionComponent
                            entityId={child.id}
                            entityType={TargetEntityType.Task}
                            entitySubtype={child.type}
                            hasProposalSupport={
                              child.hasProposalSupport ?? false
                            }
                            entityTitle={child.name}
                            organizationId={organizationId}
                            projectId={projectId}
                          >
                            <EntityListItem {...props} />
                          </InteractionComponent>
                        );
                      }}
                      keyExtractor={(child) => child.id}
                      emptyMessage={
                        activeChildTypePluralName
                          ? `No ${activeChildTypePluralName} yet`
                          : "No items yet"
                      }
                      showCreateButton={
                        !isPreviewPresentation && Boolean(createButtonLabel)
                      }
                      onCreateItem={onOpenNewTaskModal}
                      createButtonLabel={createButtonLabel}
                    />
                  </Box>
                </motion.div>
              )}

              {activeTab === "documents" && (
                <motion.div
                  key="documents"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <DesignDocsTab
                    organizationId={organizationId}
                    projectId={projectId}
                    taskId={taskId}
                    enableFilters={true}
                    emptyMessage="No design documents linked to this task"
                  />
                </motion.div>
              )}

              {canOwnAgentSessions && activeTab === "agent-sessions" && (
                <motion.div
                  key="agent-sessions"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {agentSessionsTabBody ?? (
                    <TaskAgentSessionsTab
                      organizationId={organizationId}
                      projectId={projectId}
                      taskId={taskId}
                      taskType={activeTask.type}
                      relatedEntities={relatedEntities}
                      taskName={activeTask.name}
                      taskStatus={activeTask.status}
                      initiativeId={initiativeId}
                      onTaskStatusChange={onStatusChange}
                      loading={!organizationId}
                      enableFilters={false}
                      emptyMessage="No coding sessions found for this task yet."
                    />
                  )}
                </motion.div>
              )}

              {filesTabSupported && activeTab === "files" && (
                <motion.div
                  key="files"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <WorkItemFilesTab
                    organizationId={organizationId}
                    projectId={projectId}
                    entityId={taskId}
                    typeKey={workItemTypeDefinition?.key ?? task.type}
                  />
                </motion.div>
              )}

              {isPlatformAdmin && activeTab === "data-debug" && (
                <motion.div
                  key="data-debug"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <DataDebugTab
                    organizationId={organizationId}
                    projectId={projectId}
                    entityId={relationshipEntityId}
                    entityType={relationshipEntityType}
                  />
                </motion.div>
              )}

              {activeTab === "conversations" && (
                <motion.div
                  key="conversations"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <ConversationListTab
                    organizationId={organizationId}
                    projectId={projectId}
                    entityName={task.name}
                    workflowAboutId={taskId}
                    workflowAboutType="task"
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
                        startIcon={<DeleteIcon />}
                        onClick={onDeleteClick}
                        variant="outlined"
                        color="error"
                        disabled={isDeletingTask || isTaskLoading}
                        size="small"
                        data-testid="task-delete-button"
                      >
                        Delete
                      </Button>
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </InteractionComponent>

          {canOwnAgentSessions && task?.status === WorkStatus.Active && (
            <CapsuleAction
              id={taskGenerationAction.actionId}
              label={t(taskGenerationAction.label)}
              icon={TasksIcon}
              behavior="expand"
              tier="page"
              order={1}
              inProgress={taskGenerationAction.inProgress}
              renderContent={taskGenerationAction.renderContent}
              title={t(taskGenerationAction.title)}
              menuItems={taskGenerationAction.menuItems}
              resumable={taskGenerationAction.resumable}
              expandable={taskGenerationAction.expandable}
            />
          )}

          {hasAllowedChildTypes && (
            <NewTaskModal
              open={isNewTaskModalOpen}
              onClose={onCloseNewTaskModal}
              onSubmit={onSubmitNewTask}
              isLoading={isCreatingChildTask}
              initiativeId={initiativeId}
              sectionSelection={
                activeChildTypeKey && selectedChildTypeDefinition
                  ? {
                      status: "resolved",
                      typeKey: activeChildTypeKey,
                      sections: selectedChildTypeDefinition.sections,
                    }
                  : { status: "unavailable", reason: "unresolved" }
              }
            />
          )}
          <Dialog
            open={isDeleteDialogOpen}
            onClose={onCancelDelete}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>Delete {typeDisplayName ?? "work item"}</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Are you sure you want to delete this task? This action cannot be
                undone.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={onCancelDelete} disabled={isDeletingTask}>
                Cancel
              </Button>
              <Button
                onClick={onConfirmDelete}
                variant="contained"
                color="error"
                disabled={isDeletingTask}
                autoFocus
                data-testid="task-admin-confirm-delete-button"
              >
                Delete
              </Button>
            </DialogActions>
          </Dialog>
        </DetailPageContainer>
      </WorkItemUnsavedChangesBridge>
    </TrackingProvider>
  );
};
