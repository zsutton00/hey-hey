import type { PlanWorkItem } from "@hey-hey/ui-common/data";
import { CreateFeaturePlanButton } from "../../components/Plans/CreateFeaturePlanButton";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import type { Options } from "nuqs";
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  EntityType,
  TargetEntityType,
  WorkStatus,
  WorkItemTypeRole,
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type CreateFeatureDto,
  type FeatureTag,
  type MaterializedWorkItemSection,
  type ProjectResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  CapsuleAction,
  Card,
  DiscussCapsuleAction,
  DiscussModal,
  EntityFilters,
  EntityGrid,
  EntityListItem,
  FeatureTagSelector,
  type GraphConversationLaunchInput,
  InteractionComponent,
  NewFeatureModal,
  PlanList,
  WorkItemEditor,
  WorkItemReadView,
  WorkItemEntityFilters,
  MINI_DEMO_TARGETS,
  type FilterConfig,
  type EntityConversationLaunchError,
  taskAdapter,
  useFilteredWorkItems,
} from "@hey-hey/ui-common/components";
import { createNavigationLineageEntry, type Stable } from "@hey-hey/ui-common";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import { WebPathService } from "@hey-hey/ui-common/services";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ExpandIcon from "@mui/icons-material/OpenInFull";
import ForumIcon from "@mui/icons-material/Forum";

import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  type DetailPageTab,
} from "../../components/Layout";
import { ContextRailCards } from "../../components/ContextRailCards";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import {
  TaskListPagination,
  type TaskListPaginationProps,
  type TaskListSortKey,
} from "../../components/Tabs/useTaskListPaging";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import {
  TaskBreadcrumbs,
  type BreadcrumbFeatureAncestor,
} from "../../components/TaskBreadcrumbs";
import { NewTaskModal, type NewTaskFormData } from "../../components/Tasks";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";
import {
  getWorkItemTypeDisplayName,
  getWorkItemTypePluralDisplayName,
  WORK_ITEM_TYPE_KEYS,
  type WorkItemSectionSelection,
} from "../../types/workItemTypes";
import {
  buildWorkItemRoleNavigationGroups,
  getWorkItemRoleNavigationTooltip,
  resolveWorkItemRoleNavigationTypeKey,
} from "../../types/workItemNavigation";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { SetReadyActionCapsule } from "../Task/SetReadyActionCapsule";
import { useFeatureTreeVisualizationReady } from "./useFeatureTreeVisualizationReady";

const FeatureTreeVisualization = lazy(
  () => import("@hey-hey/ui-common/feature-tree-visualization"),
);

export type FeaturePageActiveTab =
  | "feature"
  | WorkItemTypeRole
  | `children:${string}`
  | "plans"
  | "documents"
  | "conversations"
  | "data-debug"
  | "admin";

export type FeaturePageConfirmAction = "archive" | "delete" | null;

export interface FeatureTaskListPagingState {
  page: number;
  sortKey: TaskListSortKey;
  search: string;
  status: string;
  setSearch: (value: string) => void;
  setStatus: (value: string) => void;
  setSortKey: (value: TaskListSortKey) => void;
  getPaginationProps: (items: {
    itemCount: number;
    totalCount?: number;
  }) => TaskListPaginationProps;
}

export type FeaturePageTabChange = (
  value: string | ((old: string) => string | null) | null,
  options?: Options,
) => void | Promise<URLSearchParams>;

export interface FeaturePageViewProps {
  // identifiers
  organizationId: string;
  projectId: string;
  taskId: string;

  // feature data
  task: TaskResponseDto;
  featureAncestors: BreadcrumbFeatureAncestor[];
  workItemTypeDefinition?: WorkItemTypeDefinitionDto;
  activeChildTypeDefinition?: WorkItemTypeDefinitionDto;
  workItemSectionSelection: WorkItemSectionSelection;
  activeWorkItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;
  allowedChildTypes: readonly string[];
  children: TaskResponseDto[];
  taskListPaging: FeatureTaskListPagingState;
  isChildrenLoading: boolean;
  featurePlans: PlanWorkItem[];
  isPlansLoading: boolean;
  project: ProjectResponseDto | null | undefined;
  relatedEntities: ContextRelatedEntityDto[];
  proposals: EntityContextDtoProposalsInner[];

  // capability flags
  isPlatformAdmin: boolean;
  isRefining: boolean;

  // discuss-tasks launcher
  isDiscussTasksOpen: boolean;
  discussTasksLoading: boolean;
  discussTasksError: EntityConversationLaunchError | null;
  onClearDiscussTasksError: () => void;
  onSubmitDiscussTasks: (
    submission: GraphConversationLaunchInput,
  ) => Promise<boolean>;
  onOpenDiscussTasks: () => void;
  onCloseDiscussTasks: () => void;

  // relationship for data-debug
  relationshipEntityId: string;
  relationshipEntityType: "plan" | "task";

  // view state
  activeTab: FeaturePageActiveTab;
  activeType: string | null;
  isEditing: boolean;
  isTreeVisible: boolean;
  isTreeModalOpen: boolean;
  isNewTaskModalOpen: boolean;
  isNewFeatureModalOpen: boolean;
  confirmAction: FeaturePageConfirmAction;
  isSubmittingAdminAction: boolean;
  isCreatingChildTask: boolean;
  isCreatingSubfeature: boolean;

  // callbacks
  onEdit: Stable<() => void>;
  onDone?: (taskId: string) => void;
  onTabChange: FeaturePageTabChange;
  onTitleChange: (newTitle: string) => Promise<void>;
  onToggleTree: () => void;
  onOpenTreeModal: () => void;
  onCloseTreeModal: () => void;
  onOpenNewTaskModal: () => void;
  onCloseNewTaskModal: () => void;
  onSubmitNewTask: (formData: NewTaskFormData) => Promise<void>;
  onOpenNewFeatureModal: () => void;
  onCloseNewFeatureModal: () => void;
  onCreateSubfeature: (formData: CreateFeatureDto) => Promise<void>;
  onArchiveClick: () => void;
  onDeleteClick: () => void;
  onCancelAdminAction: () => void;
  onConfirmAdminAction: () => Promise<void>;
  onTagChanged: (tag: FeatureTag) => void;
}

export const FeaturePageView: React.FC<FeaturePageViewProps> = ({
  organizationId,
  projectId,
  taskId,
  task,
  featureAncestors,
  workItemTypeDefinition,
  activeChildTypeDefinition,
  workItemSectionSelection,
  activeWorkItemTypeDefinitions,
  allowedChildTypes,
  children,
  taskListPaging,
  isChildrenLoading,
  featurePlans,
  isPlansLoading,
  project,
  relatedEntities,
  proposals,
  isPlatformAdmin,
  isRefining,
  isDiscussTasksOpen,
  discussTasksLoading,
  discussTasksError,
  onClearDiscussTasksError,
  onSubmitDiscussTasks,
  onOpenDiscussTasks,
  onCloseDiscussTasks,
  relationshipEntityId,
  relationshipEntityType,
  activeTab,
  activeType,
  isEditing,
  isTreeVisible,
  isTreeModalOpen,
  isNewTaskModalOpen,
  isNewFeatureModalOpen,
  confirmAction,
  isSubmittingAdminAction,
  isCreatingChildTask,
  isCreatingSubfeature,
  onEdit,
  onDone,
  onTabChange,
  onTitleChange,
  onToggleTree,
  onOpenTreeModal,
  onCloseTreeModal,
  onOpenNewTaskModal,
  onCloseNewTaskModal,
  onSubmitNewTask,
  onOpenNewFeatureModal,
  onCloseNewFeatureModal,
  onCreateSubfeature,
  onArchiveClick,
  onDeleteClick,
  onCancelAdminAction,
  onConfirmAdminAction,
  onTagChanged,
}) => {
  const { t } = useTranslation();
  const isPreviewPresentation = usePreviewPresentation();
  const { hostRef: featureTreeHostRef, isReady: isFeatureTreeReady } =
    useFeatureTreeVisualizationReady(taskId);
  const isTypeDefinitionResolved =
    workItemSectionSelection.status === "resolved" &&
    workItemTypeDefinition?.key === task.type;
  const typeDisplayName = isTypeDefinitionResolved
    ? getWorkItemTypeDisplayName(workItemTypeDefinition)
    : undefined;
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

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      `/projects/${projectId}/resolve-agent-session/${conversationId}`,
    [projectId],
  );

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
  const isStandardTaskTab = activeChildTypeKey === WORK_ITEM_TYPE_KEYS.Standard;

  const [childSearchTerm, setChildSearchTerm] = useState("");
  const [childStatusFilter, setChildStatusFilter] = useState<WorkStatus | "">(
    "",
  );
  const [childSortBy, setChildSortBy] = useState("status");
  const [titleDraft, setTitleDraft] = useState(task.name);

  useEffect(() => {
    if (!isEditing) {
      setTitleDraft(task.name);
    }
  }, [isEditing, task.name]);

  const handleTitleBlur = useCallback(
    (newTitle: string) => {
      if (newTitle !== task.name) {
        void onTitleChange(newTitle);
      }
    },
    [onTitleChange, task.name],
  );

  const locallyFilteredChildren = useFilteredWorkItems<TaskResponseDto>(
    children,
    childSearchTerm,
    childStatusFilter,
    childSortBy,
  );
  const visibleChildren = isStandardTaskTab
    ? children.filter((child) =>
        child.name
          ?.toLowerCase()
          .includes(taskListPaging.search.trim().toLowerCase()),
      )
    : locallyFilteredChildren;
  const taskPaginationProps = taskListPaging.getPaginationProps({
    itemCount: children.length,
  });

  const taskFilters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t("tasks.filters.searchPlaceholder", "Search tasks..."),
      placeholder: t("tasks.filters.searchPlaceholder", "Search tasks..."),
    },
    {
      type: "select",
      key: "status",
      label: t("tasks.filters.status", "Status"),
      options: [
        {
          value: WorkStatus.Backlog,
          label: t("tasks.status.backlog", "Backlog"),
        },
        { value: WorkStatus.Active, label: t("tasks.status.active", "Active") },
        {
          value: WorkStatus.OnHold,
          label: t("tasks.status.onHold", "On Hold"),
        },
        {
          value: WorkStatus.Verifying,
          label: t("tasks.status.verifying", "Verifying"),
        },
        {
          value: WorkStatus.Completed,
          label: t("tasks.status.completed", "Completed"),
        },
        {
          value: WorkStatus.Cancelled,
          label: t("tasks.status.cancelled", "Cancelled"),
        },
        {
          value: WorkStatus.RefiningAcceptanceCriteria,
          label: t("tasks.status.refining", "Refining"),
        },
      ],
    },
  ];
  const taskSortOptions = [
    { value: "createdAt:desc", label: t("common.sortCreatedDesc", "Newest") },
    {
      value: "createdAt:asc",
      label: t("common.sortCreatedAsc", "Oldest first"),
    },
    {
      value: "updatedAt:desc",
      label: t("tasks.sortLastUpdated", "Last Updated"),
    },
    { value: "title:asc", label: t("common.sortNameAsc", "Name (A-Z)") },
    { value: "title:desc", label: t("common.sortNameDesc", "Name (Z-A)") },
    { value: "status:asc", label: t("tasks.sortStatus", "Status") },
    { value: "priority:asc", label: t("tasks.sortPriority", "Priority") },
  ];

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

    const built: DetailPageTab[] = [
      { value: "feature", label: typeDisplayName },
      ...childRoleTabs,
      {
        value: "plans",
        label: `${t("features.tab.plans", "Plans")}${featurePlans.length ? ` (${featurePlans.length})` : ""}`,
      },
      {
        value: "documents",
        label: t("features.tab.designDocs", "Design Docs"),
      },
      {
        value: "conversations",
        label: t("features.tab.conversations", "Conversations"),
      },
      { value: "admin", label: t("features.tab.admin", "Admin") },
    ];

    if (isPlatformAdmin) {
      built.push({ value: "data-debug", label: "Data Debug" });
    }

    return built;
  }, [
    t,
    childNavigationGroups,
    featurePlans.length,
    isPlatformAdmin,
    isTypeDefinitionResolved,
    typeDisplayName,
  ]);

  const displayedTab = activeChildNavigationGroup?.role ?? activeTab;
  const childTypeSegments = activeChildNavigationGroup?.items.map((item) => ({
    value: item.key,
    label:
      item.key === activeChildTypeKey && children.length > 0
        ? `${item.label} (${children.length})`
        : item.label,
  }));
  const handleChildTypeChange = useCallback(
    (typeKey: string) => {
      onTabChange(`children:${typeKey}`);
    },
    [onTabChange],
  );

  const showStatusActionCapsule = isRefining;
  const isArchived = task?.status === WorkStatus.Archived;
  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: task?.createdAt,
    updatedAt: task?.updatedAt,
    archivedAt: task?.archivedAt,
  });

  return (
    <TrackingProvider
      context={{
        page: {
          name: "feature",
          path: WebPathService.feature({
            projectId,
            featureId: taskId,
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
          name: task.name,
          status: task.status,
        },
      }}
    >
      <CanonicalPageBoundary
        composition={{
          kind: "canonical",
          descriptor: createCanonicalPageDescriptor(
            "task",
            taskId,
            [createNavigationLineageEntry("task", taskId)],
            {
              kind: "task",
              label: task.name,
              taskType: task.type,
            },
          ),
        }}
      >
        {activeTab === "feature" && !isEditing && !isRefining && (
          <CapsuleAction
            id="edit-feature"
            label={t("common.edit", "Edit")}
            icon={EditIcon}
            actionGroup="page"
            tier="page"
            order={100}
            behavior="click"
            onClick={onEdit}
            iconStyle={{ backgroundColor: "#2563EB", color: "#fff" }}
          />
        )}
        {activeTab === "feature" && showStatusActionCapsule && (
          <SetReadyActionCapsule
            organizationId={organizationId}
            projectId={projectId}
            task={task}
            pulse
          />
        )}
        {activeTab === "feature" && !isEditing && !isRefining && (
          <DiscussCapsuleAction
            entityId={taskId}
            entityType={TargetEntityType.Task}
            entityTitle={task.name}
            organizationId={organizationId}
            projectId={projectId}
          />
        )}
        <TaskBreadcrumbs
          projectId={projectId}
          projectName={project?.name}
          task={task}
          featureAncestors={featureAncestors}
          taskTypeName={typeDisplayName}
        />
        <DetailPageContainer>
          <InteractionComponent
            draggable={false}
            disablePreview={true}
            entityId={taskId}
            entityType={TargetEntityType.Task}
            hasProposalSupport={!isEditing && activeTab === "feature"}
            organizationId={organizationId}
            projectId={projectId}
            entityTitle={task.name}
            size="medium"
            indicatorPlacement="bottom-left"
          >
            <DetailPageHeader
              title={
                isEditing ? (
                  <Box height={56} width="70%">
                    <TextField
                      fullWidth
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={(e) => handleTitleBlur(e.currentTarget.value)}
                      data-testid="feature-title-input"
                      variant="outlined"
                      size="small"
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
                isTypeDefinitionResolved ? (
                  <FeatureTagSelector
                    value={task.tag}
                    onChange={onTagChanged}
                    disabled={isRefining}
                    size="small"
                  />
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
              {activeTab === "feature" && (
                <motion.div
                  key="feature"
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
                        title={task.name}
                        onDone={onDone}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ minHeight: 400 }}>
                      <DetailPageBody
                        widthStrategy="equal-split"
                        gap={0}
                        sidebarSide="right"
                        contextualRail={{
                          id: `feature-contextual-rail-${taskId}`,
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
                            sections={
                              task.sections as
                                MaterializedWorkItemSection[] | undefined
                            }
                            sectionSelection={workItemSectionSelection}
                          />
                        }
                        sidebar={
                          <>
                            <Card
                              title={t("features.featureTree", "Feature Tree")}
                              dataTestId="feature-tree-card"
                              action={
                                <IconButton
                                  onClick={onOpenTreeModal}
                                  size="small"
                                  aria-label={t("common.expand", "Expand")}
                                >
                                  <ExpandIcon fontSize="small" />
                                </IconButton>
                              }
                            >
                              <Box
                                ref={featureTreeHostRef}
                                sx={{
                                  position: "relative",
                                  width: "100%",
                                  overflowX: "auto",
                                  overflowY: "hidden",
                                }}
                              >
                                <Suspense fallback={<CircularProgress />}>
                                  <FeatureTreeVisualization
                                    organizationId={organizationId}
                                    projectId={projectId}
                                    dataSource="local-neighborhood"
                                    focusedFeatureId={taskId}
                                    activeFeatureId={taskId}
                                    focusNavigationEnabled={!isTreeModalOpen}
                                    fillHeight={false}
                                  />
                                </Suspense>
                              </Box>
                            </Card>
                            <ContextRailCards
                              proposals={proposals}
                              relatedEntities={relatedEntities}
                              organizationId={organizationId}
                              projectId={projectId}
                              conversationPathForId={conversationPathForId}
                              parentWorkItemId={taskId}
                              dataTestIdPrefix="feature"
                              relatedLoading={!isFeatureTreeReady}
                            />
                          </>
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
                  {isChildrenLoading ? (
                    <Box sx={{ p: 3 }} data-testid="feature-children-loading">
                      <LinearProgress />
                    </Box>
                  ) : (
                    <Box sx={{ p: 3 }}>
                      {!isPreviewPresentation &&
                        activeChildTypeKey &&
                        createButtonLabel &&
                        children.length > 0 && (
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ justifyContent: "flex-end", mb: 2 }}
                          >
                            <Button
                              variant="outlined"
                              startIcon={<ForumIcon />}
                              onClick={onOpenDiscussTasks}
                              data-testid="feature-children-discuss-button"
                              data-demo-target={
                                MINI_DEMO_TARGETS.featureChildrenDiscussButton
                              }
                            >
                              {t("tasks.discussTasks", "Discuss Tasks")}
                            </Button>
                            <Button
                              variant="contained"
                              startIcon={<AddIcon />}
                              onClick={
                                activeChildTypeKey === "FEATURE"
                                  ? onOpenNewFeatureModal
                                  : onOpenNewTaskModal
                              }
                              data-testid="feature-children-create-button"
                            >
                              {createButtonLabel}
                            </Button>
                          </Stack>
                        )}
                      {isStandardTaskTab ? (
                        <Box sx={{ mb: 2 }}>
                          <EntityFilters
                            filters={taskFilters}
                            values={{
                              search: taskListPaging.search,
                              status: taskListPaging.status,
                            }}
                            onChange={(key, value) => {
                              if (key === "search") {
                                taskListPaging.setSearch(value as string);
                              } else if (key === "status") {
                                taskListPaging.setStatus(value as string);
                              }
                            }}
                            sortOptions={taskSortOptions}
                            sortBy={taskListPaging.sortKey}
                            onSortChange={(value) =>
                              taskListPaging.setSortKey(
                                value as TaskListSortKey,
                              )
                            }
                            layout="row"
                            spacing={2}
                          />
                        </Box>
                      ) : children.length > 0 ? (
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
                      ) : null}
                      <EntityGrid<TaskResponseDto>
                        items={visibleChildren}
                        renderItem={(child) => {
                          const props = taskAdapter.toEntityListItemProps(
                            child,
                            {
                              projectId,
                              initiativeId: child.initiativeId,
                            },
                          );
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
                        onCreateItem={
                          activeChildTypeKey === "FEATURE"
                            ? onOpenNewFeatureModal
                            : onOpenNewTaskModal
                        }
                        createButtonLabel={createButtonLabel}
                      />
                      {isStandardTaskTab && (
                        <TaskListPagination {...taskPaginationProps} />
                      )}
                    </Box>
                  )}
                </motion.div>
              )}

              {activeTab === "plans" && (
                <motion.div
                  key="plans"
                  variants={tabTransitionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <Box sx={{ p: 3 }} data-testid="feature-plans-list">
                    <CreateFeaturePlanButton
                      organizationId={organizationId}
                      projectId={projectId}
                      featureId={taskId}
                    />
                    <PlanList
                      plans={featurePlans}
                      projectId={projectId}
                      organizationId={organizationId}
                      isLoading={isPlansLoading}
                      emptyMessage={t(
                        "features.noPlans",
                        "No plans linked to this feature yet.",
                      )}
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
                    emptyMessage={t(
                      "features.noDesignDocs",
                      "No design documents linked to this feature",
                    )}
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
                      <>
                        <Button
                          startIcon={<ArchiveIcon />}
                          onClick={onArchiveClick}
                          variant="outlined"
                          disabled={isArchived || isSubmittingAdminAction}
                          size="small"
                          data-testid="feature-archive-button"
                        >
                          {isArchived
                            ? t("features.admin.archived", "Archived")
                            : t("features.admin.archive", "Archive")}
                        </Button>
                        <Button
                          startIcon={<DeleteIcon />}
                          onClick={onDeleteClick}
                          variant="outlined"
                          color="error"
                          disabled={isSubmittingAdminAction}
                          size="small"
                          data-testid="feature-delete-button"
                        >
                          {t("features.admin.delete", "Delete")}
                        </Button>
                      </>
                    }
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
                    featureId={taskId}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </InteractionComponent>

          {hasAllowedChildTypes && (
            <>
              <NewTaskModal
                open={isNewTaskModalOpen}
                onClose={onCloseNewTaskModal}
                onSubmit={onSubmitNewTask}
                isLoading={isCreatingChildTask}
                initiativeId=""
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

              <NewFeatureModal
                open={isNewFeatureModalOpen}
                onClose={onCloseNewFeatureModal}
                onSubmit={onCreateSubfeature}
                isLoading={isCreatingSubfeature}
              />
            </>
          )}

          <DiscussModal
            open={isDiscussTasksOpen}
            onClose={onCloseDiscussTasks}
            onSubmit={onSubmitDiscussTasks}
            walkthroughEntity={null}
            isLoading={discussTasksLoading}
            entityTitle={task.name}
            organizationId={organizationId}
            projectId={projectId}
            focalEntity={{
              kind: "entity",
              entityType: EntityType.Task,
              entityId: taskId,
            }}
            fileReferenceScope={{ kind: "feature", featureId: taskId }}
            submitError={discussTasksError}
            onClearSubmitError={onClearDiscussTasksError}
            placeholder={t(
              "features.discussTasks.placeholder",
              "What tasks should we draft for this feature? Use @ to mention related entities.",
            )}
          />

          <Dialog
            open={confirmAction !== null}
            onClose={onCancelAdminAction}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>
              {confirmAction === "delete"
                ? t("features.admin.deleteTitle", "Delete Feature")
                : t("features.admin.archiveTitle", "Archive Feature")}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {confirmAction === "delete"
                  ? t(
                      "features.admin.deleteConfirm",
                      "Are you sure you want to delete this feature? This action cannot be undone.",
                    )
                  : t(
                      "features.admin.archiveConfirm",
                      "Are you sure you want to archive this feature? It will be marked as archived and will no longer appear in active feature lists.",
                    )}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={onCancelAdminAction}
                disabled={isSubmittingAdminAction}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                onClick={onConfirmAdminAction}
                variant="contained"
                color={confirmAction === "delete" ? "error" : "primary"}
                disabled={isSubmittingAdminAction}
                autoFocus
                data-testid="feature-admin-confirm-button"
              >
                {confirmAction === "delete"
                  ? t("features.admin.delete", "Delete")
                  : t("features.admin.archive", "Archive")}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={isTreeModalOpen}
            onClose={onCloseTreeModal}
            maxWidth={false}
            fullWidth
            slotProps={{
              paper: {
                sx: { height: "90vh", maxWidth: "95vw" },
              },
            }}
          >
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {t("features.featureTree", "Feature Tree")}
              <IconButton
                onClick={onCloseTreeModal}
                size="small"
                aria-label={t("common.close", "Close")}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, overflow: "hidden" }}>
              <Box sx={{ height: "100%", width: "100%" }}>
                <Suspense fallback={<CircularProgress />}>
                  <FeatureTreeVisualization
                    organizationId={organizationId}
                    projectId={projectId}
                    focusedFeatureId={taskId}
                    activeFeatureId={taskId}
                    focusNavigationEnabled={isTreeModalOpen}
                  />
                </Suspense>
              </Box>
            </DialogContent>
          </Dialog>
        </DetailPageContainer>
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};
