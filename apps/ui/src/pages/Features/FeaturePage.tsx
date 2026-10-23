import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { Alert, Box } from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import {
  EntityType,
  TargetEntityType,
  WorkStatus,
  type ContextRelatedEntityDto,
  type CreateFeatureDto,
  type EntityContextDtoProposalsInner,
  type FeatureTag,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import {
  type GraphConversationLaunchInput,
  useEntityConversationLauncher,
} from "@hey-hey/ui-common/components";
import {
  useFullEntityContext,
  useProject,
  useProjectPlans,
  useWorkItems,
  useAllowedChildWorkItemTypes,
  useWorkItemTypeByKey,
  useWorkItemUpdateMethods,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { taskContentToSectionInputs } from "@hey-hey/ui-common/utils";

import { type NewTaskFormData } from "../../components/Tasks";
import { useTaskListPaging } from "../../components/Tabs/useTaskListPaging";
import {
  selectActiveWorkItemTypeDefinitions,
  selectResolvedWorkItemSections,
} from "../../types/workItemTypes";
import {
  buildWorkItemRoleNavigationGroups,
  resolveWorkItemRoleNavigationTypeKey,
} from "../../types/workItemNavigation";
import { logger } from "../../utils/logger";
import { isTaskRefining } from "../../utils/statusUtils";
import {
  FeaturePageView,
  type FeaturePageActiveTab,
  type FeaturePageConfirmAction,
} from "./FeaturePageView";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";

export interface FeaturePageProps {
  task: TaskResponseDto;
}

export const FeaturePage: React.FC<FeaturePageProps> = ({ task }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const projectId = params.projectId ?? "";
  const taskId = params.taskId ?? "";
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [isEditing, setIsEditing] = useState<boolean | null>(null);
  const [isTreeVisible, setIsTreeVisible] = useState(true);
  const [isTreeModalOpen, setIsTreeModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isNewFeatureModalOpen, setIsNewFeatureModalOpen] = useState(false);
  const [isDiscussTasksOpen, setIsDiscussTasksOpen] = useState(false);
  const [isCreatingChildTask, setIsCreatingChildTask] = useState(false);
  const [isCreatingSubfeature, setIsCreatingSubfeature] = useState(false);
  const [confirmAction, setConfirmAction] =
    useState<FeaturePageConfirmAction>(null);
  const [isSubmittingAdminAction, setIsSubmittingAdminAction] = useState(false);
  const previousRefiningStateRef = useRef<boolean | null>(null);

  const planScopedPlanId = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("planId")?.trim() || "";
  }, [location.search]);
  const relationshipEntityId = planScopedPlanId || taskId;
  const relationshipEntityType: "plan" | "task" = planScopedPlanId
    ? "plan"
    : "task";

  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsString.withDefault("feature"),
  );
  const [activeType, setActiveType] = useQueryState("type", parseAsString);
  const taskListPaging = useTaskListPaging({ keyPrefix: "tasks" });

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

  const relatedEntities: ContextRelatedEntityDto[] =
    fullEntityContext?.relatedEntities ?? [];
  const proposals: EntityContextDtoProposalsInner[] =
    fullEntityContext?.proposals ?? [];
  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
    fallbackHierarchy: fullEntityContext?.featureHierarchy,
  });

  const { plans: projectPlans, isLoading: isPlansLoading } = useProjectPlans(
    organizationId,
    projectId,
    {
      enabled:
        !!organizationId && !!projectId && !!taskId && activeTab === "plans",
    },
  );

  const featurePlans = useMemo(
    () => projectPlans.filter((plan) => plan.parentTaskId === taskId),
    [projectPlans, taskId],
  );

  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(organizationId, projectId, task?.type);
  const workItemSectionSelection = useMemo(
    () =>
      selectResolvedWorkItemSections({
        typeKey: task?.type,
        definition: workItemTypeDefinition,
        isFetched: isWorkItemTypeFetched,
      }),
    [isWorkItemTypeFetched, task?.type, workItemTypeDefinition],
  );
  const {
    workItemTypes,
    allowedChildTypes: derivedAllowedChildTypes,
    isReady: isChildRelationshipReady,
    error: childRelationshipError,
  } = useAllowedChildWorkItemTypes(organizationId, projectId, task?.type ?? "");
  const activeWorkItemTypeDefinitions = useMemo(
    () => selectActiveWorkItemTypeDefinitions(workItemTypes, projectId),
    [projectId, workItemTypes],
  );
  const allowedChildTypes =
    workItemSectionSelection.status === "resolved"
      ? derivedAllowedChildTypes
      : undefined;
  const childNavigationGroups = useMemo(
    () =>
      buildWorkItemRoleNavigationGroups(
        activeWorkItemTypeDefinitions,
        allowedChildTypes ?? [],
      ),
    [activeWorkItemTypeDefinitions, allowedChildTypes],
  );
  const activeChildTypeKey = resolveWorkItemRoleNavigationTypeKey(
    childNavigationGroups,
    activeTab,
    activeType,
  );
  const isStandardTaskTab = activeChildTypeKey === WORK_ITEM_TYPE_KEYS.Standard;
  const activeChildTypeDefinition = activeChildTypeKey
    ? activeWorkItemTypeDefinitions.get(activeChildTypeKey)
    : undefined;
  const isActiveChildType = (typeKey: string | undefined): typeKey is string =>
    typeKey !== undefined && allowedChildTypes?.includes(typeKey) === true;
  const childQueryEnabled =
    !!organizationId &&
    !!projectId &&
    !!taskId &&
    isActiveChildType(activeChildTypeKey);
  const childRouteDecision =
    activeChildTypeKey === undefined
      ? "not-applicable"
      : allowedChildTypes === undefined
        ? "waiting"
        : allowedChildTypes.includes(activeChildTypeKey)
          ? "accepted"
          : "rejected";
  const childRegistryDefinitions = useMemo(
    () =>
      workItemTypes.map(
        ({ definition, status, projectId: definitionProjectId }) => ({
          key: definition.key,
          status,
          projectId: definitionProjectId,
          allowedParentTypes: definition.allowedParentTypes ?? [],
        }),
      ),
    [workItemTypes],
  );

  const childNavigationLog = JSON.stringify(
    {
      page: "feature",
      organizationId,
      projectId,
      taskId,
      parentType: task?.type ?? null,
      definitionStatus: workItemSectionSelection.status,
      registry: {
        isReady: isChildRelationshipReady,
        error:
          childRelationshipError instanceof Error
            ? childRelationshipError.message
            : childRelationshipError,
        definitions: childRegistryDefinitions,
      },
      derivedAllowedChildTypes: derivedAllowedChildTypes ?? null,
      effectiveAllowedChildTypes: allowedChildTypes ?? null,
      activeTab,
      activeChildTypeKey: activeChildTypeKey ?? null,
      routeDecision: childRouteDecision,
      childQueryEnabled,
    },
    null,
    2,
  );

  useEffect(() => {
    logger.info("ui", `[child tabs] FeaturePage state\n${childNavigationLog}`);
  }, [childNavigationLog]);

  useEffect(() => {
    if (!isPlatformAdmin && activeTab === "data-debug") {
      void setActiveTab("feature");
    }
  }, [isPlatformAdmin, activeTab, setActiveTab]);

  useEffect(() => {
    const childTypeKey = activeTab.startsWith("children:")
      ? activeTab.slice("children:".length)
      : undefined;
    if (
      childTypeKey !== undefined &&
      allowedChildTypes !== undefined &&
      !allowedChildTypes.includes(childTypeKey)
    ) {
      const rejection = {
        page: "feature",
        organizationId,
        projectId,
        taskId,
        parentType: task?.type,
        rejectedChildType: childTypeKey,
        allowedChildTypes,
      };
      logger.warn(
        "ui",
        `[child tabs] FeaturePage rejected child route\n${JSON.stringify(rejection, null, 2)}`,
      );
      void setActiveTab("feature");
    }
  }, [
    activeTab,
    allowedChildTypes,
    organizationId,
    projectId,
    setActiveTab,
    task?.type,
    taskId,
  ]);

  useEffect(() => {
    if (isEditing === null && task) {
      const editingParam = new URLSearchParams(location.search).get("editing");
      setIsEditing(editingParam === "true" || isTaskRefining(task));
    }
  }, [isEditing, task, location.search]);

  useEffect(() => {
    if (!task) return;

    const currentRefiningState = isTaskRefining(task);

    if (
      isEditing &&
      previousRefiningStateRef.current === true &&
      currentRefiningState === false
    ) {
      setIsEditing(false);
    }

    previousRefiningStateRef.current = currentRefiningState;
  }, [task, isEditing]);

  const { createTask: createChildTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      parentTaskId: taskId,
      enabled: false,
    },
  );

  const {
    workItems: childItemsForTab,
    isLoading: isChildItemsLoading,
    isFetched: isChildItemsFetched,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    parentTaskId: taskId,
    taskType: activeChildTypeKey,
    ...(isStandardTaskTab
      ? {
          page: taskListPaging.page,
          limit: 50,
          sortBy: taskListPaging.sortBy,
          sortDir: taskListPaging.sortDir,
          status: taskListPaging.status
            ? (taskListPaging.status as WorkStatus)
            : undefined,
        }
      : {}),
    includeEdges: true,
    includeSectionKeys: ["description"],
    enabled: childQueryEnabled,
  });

  const isChildrenLoading =
    !!activeChildTypeKey &&
    (allowedChildTypes === undefined ||
      isChildItemsLoading ||
      !isChildItemsFetched);

  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId,
  );

  const handleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
    setActiveTab("feature");
  }, [setActiveTab]);

  const handleDoneEditing = useCallback(
    (completedTaskId: string) => {
      if (completedTaskId !== taskId) {
        return;
      }

      setIsEditing(false);
      const searchParams = new URLSearchParams(location.search);
      searchParams.delete("editing");
      navigate(
        {
          pathname: location.pathname,
          search: searchParams.toString(),
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate, taskId],
  );

  const handleTabChange = useCallback(
    (nextValue: Parameters<typeof setActiveTab>[0]) => {
      if (typeof nextValue === "function" || nextValue === null) {
        return void setActiveTab(nextValue);
      }

      const selectedRoleGroup = childNavigationGroups.find(
        (group) => group.role === nextValue,
      );
      if (selectedRoleGroup) {
        void setActiveTab(selectedRoleGroup.role);
        void setActiveType(
          resolveWorkItemRoleNavigationTypeKey(
            childNavigationGroups,
            selectedRoleGroup.role,
            null,
          ) ?? null,
        );
        return;
      }

      if (nextValue.startsWith("children:")) {
        const selectedTypeKey = nextValue.slice("children:".length);
        const selectedTypeGroup = childNavigationGroups.find((group) =>
          group.items.some((item) => item.key === selectedTypeKey),
        );
        if (selectedTypeGroup) {
          void setActiveTab(selectedTypeGroup.role);
          void setActiveType(selectedTypeKey);
          return;
        }
      }

      if (isEditing && nextValue !== "feature") {
        setIsEditing(false);
      }

      return void setActiveTab(nextValue);
    },
    [childNavigationGroups, isEditing, setActiveTab, setActiveType],
  );

  const handleOpenNewTaskModal = useCallback(() => {
    setIsNewTaskModalOpen(true);
  }, []);

  const handleCloseNewTaskModal = useCallback(() => {
    setIsNewTaskModalOpen(false);
  }, []);

  const handleOpenNewFeatureModal = useCallback(() => {
    setIsNewFeatureModalOpen(true);
  }, []);

  const handleCloseNewFeatureModal = useCallback(() => {
    setIsNewFeatureModalOpen(false);
  }, []);

  const discussTasksLauncher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });

  const handleOpenDiscussTasks = useCallback(() => {
    setIsDiscussTasksOpen(true);
  }, []);

  const handleCloseDiscussTasks = useCallback(() => {
    if (discussTasksLauncher.isLoading) return;
    setIsDiscussTasksOpen(false);
  }, [discussTasksLauncher.isLoading]);

  const handleSubmitDiscussTasks = useCallback(
    async (submission: GraphConversationLaunchInput): Promise<boolean> => {
      const ok = await discussTasksLauncher.launch({
        ...submission,
        context: {
          entityId: taskId,
          entityType: TargetEntityType.Task,
        },
      });
      if (ok) {
        setIsDiscussTasksOpen(false);
      }
      return ok;
    },
    [discussTasksLauncher, taskId],
  );

  const { createTask: createSubfeature, remove: removeFeature } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskType: WORK_ITEM_TYPE_KEYS.Feature,
      enabled: false,
    },
  );

  const handleCreateSubfeature = useCallback(
    async (formData: CreateFeatureDto) => {
      try {
        setIsCreatingSubfeature(true);
        await createSubfeature({
          ...formData,
          type: WORK_ITEM_TYPE_KEYS.Feature,
          parentTaskId: taskId,
        });
        setIsNewFeatureModalOpen(false);
      } catch (error) {
        console.error("Failed to create subfeature:", error);
      } finally {
        setIsCreatingSubfeature(false);
      }
    },
    [createSubfeature, taskId],
  );

  const handleToggleTree = useCallback(() => {
    setIsTreeVisible((prev) => !prev);
  }, []);

  const handleOpenTreeModal = useCallback(() => {
    setIsTreeModalOpen(true);
  }, []);

  const handleCloseTreeModal = useCallback(() => {
    setIsTreeModalOpen(false);
  }, []);

  const handleSubmitNewTask = useCallback(
    async (formData: NewTaskFormData) => {
      const sectionSelection =
        activeChildTypeKey && activeChildTypeDefinition
          ? ({
              status: "resolved",
              typeKey: activeChildTypeKey,
              sections: activeChildTypeDefinition.sections,
            } as const)
          : ({ status: "unavailable", reason: "unresolved" } as const);

      if (
        sectionSelection.status !== "resolved" ||
        !activeChildTypeDefinition
      ) {
        return;
      }

      const initialStatus = activeChildTypeDefinition.allowedStatuses[0];
      if (!initialStatus) {
        logger.warn(
          "ui",
          `[child creation] FeaturePage withheld creation because ${activeChildTypeKey} has no initial status`,
        );
        return;
      }

      try {
        setIsCreatingChildTask(true);
        const { sectionContent = {}, ...taskFields } = formData;
        await createChildTask({
          ...taskFields,
          sections: taskContentToSectionInputs(sectionContent, {
            includeEmpty: false,
            selection: sectionSelection,
          }),
          parentTaskId: taskId,
          type: activeChildTypeKey,
          status: initialStatus,
        });
        setIsNewTaskModalOpen(false);
      } catch (error) {
        console.error("Failed to create child task:", error);
      } finally {
        setIsCreatingChildTask(false);
      }
    },
    [activeChildTypeDefinition, activeChildTypeKey, createChildTask, taskId],
  );

  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      if (!task?.id) return;
      try {
        await updateTask(task.id, { name: newTitle });
      } catch (error) {
        console.error("Failed to update feature title:", error);
      }
    },
    [task?.id, updateTask],
  );

  const handleArchiveClick = useCallback(() => {
    setConfirmAction("archive");
  }, []);

  const handleDeleteClick = useCallback(() => {
    setConfirmAction("delete");
  }, []);

  const handleCancelAdminAction = useCallback(() => {
    if (isSubmittingAdminAction) return;
    setConfirmAction(null);
  }, [isSubmittingAdminAction]);

  const handleTagChanged = useCallback(
    async (tag: FeatureTag) => {
      if (!task?.id) return;
      await updateTask(task.id, { tag });
    },
    [task?.id, updateTask],
  );

  const handleConfirmAdminAction = useCallback(async () => {
    if (!task?.id || !confirmAction) return;

    try {
      setIsSubmittingAdminAction(true);
      if (confirmAction === "archive") {
        await updateTask(task.id, { status: WorkStatus.Archived });
        setConfirmAction(null);
      } else {
        await removeFeature(task.id, {
          onSuccess: () => {
            if (projectId) {
              navigate(`/projects/${projectId}/features`);
            } else {
              navigate("/");
            }
          },
          onError: (error) => {
            console.error("Failed to delete feature:", error);
          },
        });
        setConfirmAction(null);
      }
    } catch (error) {
      console.error("Failed to perform admin action:", error);
    } finally {
      setIsSubmittingAdminAction(false);
    }
  }, [confirmAction, navigate, projectId, removeFeature, task?.id, updateTask]);

  const children = useMemo<TaskResponseDto[]>(
    () => childItemsForTab as TaskResponseDto[],
    [childItemsForTab],
  );

  if (!projectId || !taskId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {t(
            "features.missingParams",
            "Missing required route parameters. Please check the feature URL.",
          )}
        </Alert>
      </Box>
    );
  }

  if (isEditing === null) return null;

  const isRefining = isTaskRefining(task);

  return (
    <FeaturePageView
      organizationId={organizationId}
      projectId={projectId}
      taskId={taskId}
      task={task}
      featureAncestors={featureAncestors}
      workItemTypeDefinition={workItemTypeDefinition}
      workItemSectionSelection={workItemSectionSelection}
      activeWorkItemTypeDefinitions={activeWorkItemTypeDefinitions}
      activeChildTypeDefinition={activeChildTypeDefinition}
      activeType={activeType}
      allowedChildTypes={allowedChildTypes ?? []}
      children={children}
      taskListPaging={taskListPaging}
      isChildrenLoading={isChildrenLoading}
      featurePlans={featurePlans}
      isPlansLoading={isPlansLoading}
      project={project}
      relatedEntities={relatedEntities}
      proposals={proposals}
      isPlatformAdmin={isPlatformAdmin}
      isRefining={isRefining}
      isDiscussTasksOpen={isDiscussTasksOpen}
      discussTasksLoading={discussTasksLauncher.isLoading}
      discussTasksError={discussTasksLauncher.error}
      onClearDiscussTasksError={discussTasksLauncher.clearError}
      onSubmitDiscussTasks={handleSubmitDiscussTasks}
      onOpenDiscussTasks={handleOpenDiscussTasks}
      onCloseDiscussTasks={handleCloseDiscussTasks}
      relationshipEntityId={relationshipEntityId}
      relationshipEntityType={relationshipEntityType}
      activeTab={activeTab as FeaturePageActiveTab}
      isEditing={isEditing}
      isTreeVisible={isTreeVisible}
      isTreeModalOpen={isTreeModalOpen}
      isNewTaskModalOpen={isNewTaskModalOpen}
      isNewFeatureModalOpen={isNewFeatureModalOpen}
      confirmAction={confirmAction}
      isSubmittingAdminAction={isSubmittingAdminAction}
      isCreatingChildTask={isCreatingChildTask}
      isCreatingSubfeature={isCreatingSubfeature}
      onEdit={handleEdit}
      onDone={handleDoneEditing}
      onTabChange={handleTabChange}
      onTitleChange={handleTitleChange}
      onToggleTree={handleToggleTree}
      onOpenTreeModal={handleOpenTreeModal}
      onCloseTreeModal={handleCloseTreeModal}
      onOpenNewTaskModal={handleOpenNewTaskModal}
      onCloseNewTaskModal={handleCloseNewTaskModal}
      onSubmitNewTask={handleSubmitNewTask}
      onOpenNewFeatureModal={handleOpenNewFeatureModal}
      onCloseNewFeatureModal={handleCloseNewFeatureModal}
      onCreateSubfeature={handleCreateSubfeature}
      onArchiveClick={handleArchiveClick}
      onDeleteClick={handleDeleteClick}
      onCancelAdminAction={handleCancelAdminAction}
      onConfirmAdminAction={handleConfirmAdminAction}
      onTagChanged={handleTagChanged}
    />
  );
};
