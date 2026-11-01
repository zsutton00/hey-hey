import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { TERMS } from "@hey-hey/ui-common/i18n";
import {
  EntityType,
  TaskPriority as Priority,
  WorkStatus,
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type PlanContextEntryDto,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import { useTaskGenerationCapsuleAction } from "@hey-hey/ui-common/components";
import {
  useFullEntityContext,
  useInitiative,
  useProject,
  useTaskHierarchy,
  useWorkItem,
  useWorkItems,
  useAllowedChildWorkItemTypes,
  useWorkItemTypeByKey,
  useWorkItemUpdateMethods,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
} from "@hey-hey/ui-common/context";
import { WebPathService } from "@hey-hey/ui-common/services";
import { taskContentToSectionInputs } from "@hey-hey/ui-common/utils";
import BackIcon from "@mui/icons-material/ArrowBack";

import { type NewTaskFormData } from "../../components/Tasks";
import {
  canWorkItemTypeOwnAgentSessions,
  indexWorkItemTypeDefinitions,
  selectActiveWorkItemTypeDefinitions,
  selectResolvedWorkItemSections,
} from "../../types/workItemTypes";
import {
  buildWorkItemRoleNavigationGroups,
  resolveWorkItemRoleNavigationTypeKey,
} from "../../types/workItemNavigation";
import { logger } from "../../utils/logger";
import { isTaskRefining } from "../../utils/statusUtils";
import { buildTaskNavigationLineage } from "./taskNavigationLineage";
import { TaskPageView, type TaskPageTabChange } from "./TaskPageView";
import { isFilesTabSupported } from "../../components/Tabs/WorkItemFilesTab";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";

export interface TaskPageProps {
  organizationId: string;
  projectId: string;
  initiativeId?: string;
  taskId: string;
  preview?: boolean;
}

export const TaskPage: React.FC<TaskPageProps> = ({
  organizationId,
  projectId,
  initiativeId = "",
  taskId,
  preview = false,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [isEditing, setIsEditing] = useState<boolean | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isCreatingChildTask, setIsCreatingChildTask] = useState(false);
  const [isUpdatingTaskServices, setIsUpdatingTaskServices] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [treeVisibilityOverride, setTreeVisibilityOverride] = useState<{
    taskId: string;
    visible: boolean;
  } | null>(null);
  const previousRefiningStateRef = useRef<boolean | null>(null);

  const planScopedPlanId = useMemo(() => {
    if (preview) return "";
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("planId")?.trim() || "";
  }, [location.search, preview]);
  const relationshipEntityId = planScopedPlanId || taskId;
  const relationshipEntityType = "task";

  const [routeActiveTab, setRouteActiveTab] = useQueryState(
    "tab",
    parseAsString.withDefault("task"),
  );
  const [previewActiveTab, setPreviewActiveTab] = useState("task");
  const activeTab = preview ? previewActiveTab : routeActiveTab;
  const [activeType, setActiveType] = useQueryState("type", parseAsString);
  const setActiveTab = useCallback<TaskPageTabChange>(
    (value, options) => {
      if (preview) {
        setPreviewActiveTab((previous) => {
          const next = typeof value === "function" ? value(previous) : value;
          return next ?? "task";
        });
        return;
      }
      return setRouteActiveTab(value, options);
    },
    [preview, setRouteActiveTab],
  );

  const {
    data: initiative,
    isLoading: isInitiativeLoading,
    error: initiativeError,
  } = useInitiative(organizationId, initiativeId, {
    enabled: !!organizationId && !!initiativeId,
  });

  const {
    hierarchy,
    isLoading: isTaskLoading,
    error: taskError,
  } = useTaskHierarchy(organizationId, projectId, taskId, {
    enabled: !!organizationId && !!taskId,
    refetchOnMount: true,
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

  const relatedEntities: ContextRelatedEntityDto[] =
    fullEntityContext?.relatedEntities ?? [];
  const proposals: EntityContextDtoProposalsInner[] =
    fullEntityContext?.proposals ?? [];
  const parentPlan: PlanContextEntryDto | undefined =
    fullEntityContext?.planContext?.parentPlan;

  const { task, parent } = hierarchy ?? {};
  const { ancestors: featureAncestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task,
    parent,
    fallbackHierarchy: fullEntityContext?.featureHierarchy,
  });
  const isTreeVisible =
    treeVisibilityOverride?.taskId === taskId
      ? treeVisibilityOverride.visible
      : task?.type !== "mockup";

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
  const workItemTypeDefinitions = useMemo(
    () => indexWorkItemTypeDefinitions(workItemTypes),
    [workItemTypes],
  );
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
  const canOwnAgentSessions =
    workItemSectionSelection.status === "resolved" &&
    canWorkItemTypeOwnAgentSessions(workItemTypeDefinition);

  const childNavigationLog = JSON.stringify(
    {
      page: "task",
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
    logger.info("ui", `[child tabs] TaskPage state\n${childNavigationLog}`);
  }, [childNavigationLog]);

  const { workItem: workItemTask, refetch: refetchWorkItemTask } = useWorkItem(
    organizationId,
    "task",
    taskId,
    {
      includeServiceRelations: true,
      projectId,
      enabled: !!organizationId && !!taskId,
      refetchOnMount: true,
    },
  );

  const { workItems: childTasksWithEdges } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      parentTaskId: taskId,
      taskType: activeChildTypeKey,
      includeEdges: true,
      includeSectionKeys: ["description"],
      enabled: childQueryEnabled,
    },
  );
  const taskWithServiceRelations =
    (workItemTask as TaskResponseDto | null) ?? null;
  const taskServiceIds = useMemo(
    () =>
      Array.from(
        new Set(
          (taskWithServiceRelations?.serviceRelations ?? []).map(
            (relation) => relation.serviceId,
          ),
        ),
      ),
    [taskWithServiceRelations?.serviceRelations],
  );

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      `/projects/${projectId}/resolve-agent-session/${conversationId}`,
    [projectId],
  );

  useEffect(() => {
    if (activeTab === "prompts") {
      void setActiveTab("agent-sessions");
      return;
    }
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    if (!isPlatformAdmin && activeTab === "data-debug") {
      void setActiveTab("task");
    }
  }, [activeTab, isPlatformAdmin, setActiveTab]);

  useEffect(() => {
    if (
      activeTab === "files" &&
      !isFilesTabSupported({
        status: workItemSectionSelection.status,
        typeKey: workItemTypeDefinition?.key,
      })
    ) {
      void setActiveTab("task");
    }
  }, [
    activeTab,
    setActiveTab,
    workItemSectionSelection.status,
    workItemTypeDefinition?.key,
  ]);

  useEffect(() => {
    const childTypeKey = activeTab.startsWith("children:")
      ? activeTab.slice("children:".length)
      : undefined;
    const isUnavailableChildTab =
      childTypeKey !== undefined &&
      allowedChildTypes !== undefined &&
      !allowedChildTypes.includes(childTypeKey);
    const isUnavailableCodingTab =
      activeTab === "agent-sessions" && !canOwnAgentSessions;

    if (isUnavailableChildTab || isUnavailableCodingTab) {
      if (isUnavailableChildTab) {
        const rejection = {
          page: "task",
          organizationId,
          projectId,
          taskId,
          parentType: task?.type,
          rejectedChildType: childTypeKey,
          allowedChildTypes,
        };
        logger.warn(
          "ui",
          `[child tabs] TaskPage rejected child route\n${JSON.stringify(rejection, null, 2)}`,
        );
      }
      void setActiveTab("task");
    }
  }, [
    activeTab,
    allowedChildTypes,
    canOwnAgentSessions,
    organizationId,
    projectId,
    setActiveTab,
    task?.type,
    taskId,
  ]);

  useEffect(() => {
    if (isEditing === null && task) {
      const editingParam = preview
        ? null
        : new URLSearchParams(location.search).get("editing");
      setIsEditing(editingParam === "true" || isTaskRefining(task));
    }
  }, [isEditing, task, location.search, preview]);

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

  const childTaskCount = isTaskLoading ? undefined : task?.childCounts?.total;

  const { createTask: createChildTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      initiativeId: initiativeId || undefined,
      parentTaskId: taskId,
      enabled: false,
    },
  );
  const { remove: removeTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { initiativeId: initiativeId || undefined, enabled: false },
  );

  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId,
    undefined,
    { initiativeId: initiativeId || undefined },
  );

  const handleReturn = useCallback(() => {
    if (projectId && initiativeId) {
      navigate(WebPathService.initiativeDetail({ projectId, initiativeId }));
      return;
    }

    if (projectId) {
      navigate(WebPathService.returnToProject(projectId));
      return;
    }

    navigate("/");
  }, [navigate, projectId, initiativeId]);

  const handleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
    setActiveTab("task");
  }, [setActiveTab]);

  const handleDoneEditing = useCallback(
    (completedTaskId: string) => {
      if (completedTaskId !== taskId) {
        return;
      }

      setIsEditing(false);
      if (preview) {
        return;
      }

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
    [location.pathname, location.search, navigate, preview, taskId],
  );

  const handleTabChange = useCallback(
    (nextValue: Parameters<TaskPageTabChange>[0]) => {
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

      if (isEditing && nextValue !== "task") {
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

  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    if (isDeletingTask) return;
    setIsDeleteDialogOpen(false);
  }, [isDeletingTask]);

  const handleConfirmDelete = useCallback(async () => {
    if (!task?.id) return;

    try {
      setIsDeletingTask(true);
      await removeTask(task.id);
      setIsDeleteDialogOpen(false);
      handleReturn();
    } catch (error) {
      console.error("Failed to delete task:", error);
    } finally {
      setIsDeletingTask(false);
    }
  }, [handleReturn, removeTask, task?.id]);

  const handleToggleTree = useCallback(() => {
    setTreeVisibilityOverride({ taskId, visible: !isTreeVisible });
  }, [isTreeVisible, taskId]);

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
          `[child creation] TaskPage withheld creation because ${activeChildTypeKey} has no initial status`,
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
          initiativeId,
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
    [
      activeChildTypeKey,
      createChildTask,
      initiativeId,
      taskId,
      activeChildTypeDefinition,
    ],
  );

  const handleStatusChange = useCallback(
    async (newStatus: WorkStatus) => {
      if (!task?.id) return;

      try {
        await updateTask(task.id, { status: newStatus });
      } catch (error) {
        console.error("Failed to update task status:", error);
        throw error;
      }
    },
    [task?.id, updateTask],
  );

  const handlePriorityChange = useCallback(
    async (newPriority: Priority) => {
      if (!task?.id) return;

      try {
        await updateTask(task.id, { priority: newPriority });
      } catch (error) {
        console.error("Failed to update task priority:", error);
      }
    },
    [task?.id, updateTask],
  );

  const handleDueDateChange = useCallback(
    async (newDueDate: string | null) => {
      if (!task?.id) return;

      try {
        await updateTask(task.id, { dueDate: newDueDate ?? undefined });
      } catch (error) {
        console.error("Failed to update task due date:", error);
      }
    },
    [task?.id, updateTask],
  );

  const handleAssigneeChange = useCallback(
    async (newAssigneeId: string | null) => {
      if (!task?.id) return;

      try {
        await updateTask(task.id, { assigneeId: newAssigneeId ?? undefined });
      } catch (error) {
        console.error("Failed to update task assignee:", error);
      }
    },
    [task?.id, updateTask],
  );

  const handleTaskServicesChange = useCallback(
    async (nextServiceIds: string[]) => {
      if (!organizationId || !task?.id) {
        return;
      }

      const currentServiceIdsSet = new Set(taskServiceIds);
      const nextServiceIdsSet = new Set(nextServiceIds);
      const addedServiceIds = nextServiceIds.filter(
        (serviceId) => !currentServiceIdsSet.has(serviceId),
      );
      const removedServiceIds = taskServiceIds.filter(
        (serviceId) => !nextServiceIdsSet.has(serviceId),
      );

      if (addedServiceIds.length === 0 && removedServiceIds.length === 0) {
        return;
      }

      try {
        setIsUpdatingTaskServices(true);
        await Promise.all([
          ...addedServiceIds.map((serviceId) =>
            unifiedApiClient.client.createServiceLink({
              organizationId,
              serviceId,
              serviceLinkDto: {
                entityType: "task",
                entityId: task.id,
              },
            }),
          ),
          ...removedServiceIds.map((serviceId) =>
            unifiedApiClient.client.removeServiceLink({
              organizationId,
              serviceId,
              entityType: "task",
              entityId: task.id,
            }),
          ),
        ]);
        await refetchWorkItemTask();
      } catch (error) {
        console.error("Failed to update task services:", error);
      } finally {
        setIsUpdatingTaskServices(false);
      }
    },
    [organizationId, refetchWorkItemTask, task?.id, taskServiceIds],
  );

  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      if (!task?.id) return;

      try {
        await updateTask(task.id, { name: newTitle });
      } catch (error) {
        console.error("Failed to update task title:", error);
      }
    },
    [task?.id, updateTask],
  );

  const taskGenerationAction = useTaskGenerationCapsuleAction({
    aboutId: taskId,
    aboutType: "task",
    aboutTitle: task?.name,
    projectId,
    organizationId,
    status: task?.status,
    actionId: "tasks-from-adr",
    label: TERMS.Tasks,
    title: "adr.taskGeneration.title",
  });

  if (!projectId || !taskId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required route parameters. Please check the task URL.
        </Alert>
      </Box>
    );
  }

  if (taskError || (initiativeId && initiativeError)) {
    const message =
      taskError?.message || initiativeError?.message || "Failed to load task";
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {message}
        </Alert>
        <Box textAlign="center">
          <Button
            startIcon={<BackIcon />}
            onClick={handleReturn}
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
    isEditing === null ||
    (initiativeId && isInitiativeLoading && !initiative);

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
          Loading task details...
        </Typography>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Task data not found. It may have been removed or the link is invalid.
        </Alert>
        <Box textAlign="center">
          <Button
            startIcon={<BackIcon />}
            onClick={handleReturn}
            variant="outlined"
          >
            Go back
          </Button>
        </Box>
      </Box>
    );
  }

  const activeTask = taskWithServiceRelations ?? task;
  const codingSessionCount =
    task?.codingSessionCount ?? activeTask?.codingSessionCount ?? undefined;
  const agentSessionCount =
    task?.agentSessionCount ?? activeTask?.agentSessionCount ?? undefined;
  const isRefining = isTaskRefining(task);
  const pageComposition: CanonicalPageComposition = preview
    ? { kind: "observational" }
    : {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "task",
          taskId,
          buildTaskNavigationLineage({
            taskId,
            parentTaskId: parent?.id,
            planId: parentPlan?.id,
            stageId: fullEntityContext?.planContext?.parentStage?.id,
          }),
          {
            kind: "task",
            label: activeTask.name,
            taskType: activeTask.type,
          },
        ),
      };

  return (
    <CanonicalPageBoundary composition={pageComposition}>
      <TaskPageView
        organizationId={organizationId}
        projectId={projectId}
        initiativeId={initiativeId}
        taskId={taskId}
        task={task}
        parent={parent}
        children={childTasksWithEdges as TaskResponseDto[]}
        workItemTypeDefinition={workItemTypeDefinition}
        workItemSectionSelection={workItemSectionSelection}
        workItemTypeDefinitions={workItemTypeDefinitions}
        activeWorkItemTypeDefinitions={activeWorkItemTypeDefinitions}
        activeChildTypeDefinition={activeChildTypeDefinition}
        activeType={activeType}
        allowedChildTypes={allowedChildTypes ?? []}
        project={project}
        taskWithServiceRelations={taskWithServiceRelations}
        taskServiceIds={taskServiceIds}
        isPlatformAdmin={isPlatformAdmin}
        isTaskLoading={isTaskLoading}
        isRefining={isRefining}
        isUpdatingTaskServices={isUpdatingTaskServices}
        isTreeVisible={isTreeVisible}
        onToggleTree={handleToggleTree}
        childTaskCount={childTaskCount}
        codingSessionCount={codingSessionCount}
        agentSessionCount={agentSessionCount}
        taskGenerationAction={taskGenerationAction}
        featureAncestors={featureAncestors}
        relatedEntities={relatedEntities}
        proposals={proposals}
        parentPlan={parentPlan}
        relationshipEntityId={relationshipEntityId}
        relationshipEntityType={relationshipEntityType}
        conversationPathForId={conversationPathForId}
        activeTab={activeTab}
        isEditing={!!isEditing}
        isNewTaskModalOpen={isNewTaskModalOpen}
        isCreatingChildTask={isCreatingChildTask}
        isDeleteDialogOpen={isDeleteDialogOpen}
        isDeletingTask={isDeletingTask}
        onEdit={handleEdit}
        onDone={handleDoneEditing}
        onTabChange={handleTabChange}
        onTitleChange={handleTitleChange}
        onStatusChange={handleStatusChange}
        onPriorityChange={handlePriorityChange}
        onDueDateChange={handleDueDateChange}
        onAssigneeChange={handleAssigneeChange}
        onTaskServicesChange={handleTaskServicesChange}
        onOpenNewTaskModal={handleOpenNewTaskModal}
        onCloseNewTaskModal={handleCloseNewTaskModal}
        onSubmitNewTask={handleSubmitNewTask}
        onDeleteClick={handleOpenDeleteDialog}
        onCancelDelete={handleCloseDeleteDialog}
        onConfirmDelete={handleConfirmDelete}
        hideBreadcrumbs={preview}
        trackingContextOverride={
          preview
            ? {
                page: {
                  name: "task-preview",
                  path: `/projects/${projectId}/tasks/${taskId}/preview`,
                  section: "preview",
                },
                attentionEntity: undefined,
              }
            : undefined
        }
      />
    </CanonicalPageBoundary>
  );
};
