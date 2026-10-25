import {
  indexWorkItemTypeDefinitions,
  WORK_ITEM_TYPE_KEYS,
} from "../../types/workItemTypes";
import {
  AgentEdgeType,
  AgentSessionType,
  EntityType,
  ReportRelatedEntityType,
  ReportType,
  WorkItemTypeLifecycleStatus,
  type AgentEdgeResponseDto,
  type ConversationResponseDto,
  type GoalPmRoutingCreation,
  type GoalPmRoutingSelectionPayload,
  type LocalGoalPmConversationInventoryItem,
  type ContextRelatedEntityDto,
  type TaskResponseDto,
  type TrackedEntitySnapshot,
  type WorkItemTypeDefinitionDto,
  WorkStatus,
  WorkflowName,
} from "@hey-hey/ui-common/api";
import type {
  EntityDependency,
  EntityListItemProps,
  GoalPmConversationLink,
} from "@hey-hey/ui-common/components";
import {
  activateCapabilityCatalogMachine,
  buildDefaultSurfaceSelection,
  buildEntityConversationSessionConfig,
  Card,
  designDocAdapter,
  planAdapter,
  EntityListItem,
  formatStatus,
  getCapabilityCatalogLoadState,
  getGoalConversationSurfaceId,
  InteractionComponent,
  readSurfaceSelection,
  ReportCard,
  resolveAgentBridgeRecoveryState,
  useMachineResolution,
  taskAdapter,
  subscribeCapabilityCatalog,
  type ModelSelectorMachineSelectionProps,
  type SurfaceSelection,
  WorkItemMetadata,
  writeSurfaceSelection,
} from "@hey-hey/ui-common/components";
import {
  useAgentSessions,
  useGoalPmRoutingEnactment,
  useConversations,
  useDesignDoc,
  isPlanWorkItem,
  useDetachFromGoal,
  useProject,
  useReports,
  useTaskHierarchy,
  useWorkItem,
  useWorkItems,
  useWorkItemTypes,
  useWorkItemTypeByKey,
  useWorkItemUpdateMethods,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
} from "@hey-hey/ui-common/context";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { getPathService, WebPathService } from "@hey-hey/ui-common/services";
import {
  deriveGoalStatus,
  goalStatusChipDescriptor,
} from "@hey-hey/ui-common/utils";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { GoalPrimaryConversation } from "../../components/Conversation";
import { GoalDescriptionEditor } from "./GoalDescriptionEditor";
import { GoalConversationToc } from "./GoalConversationToc";
import {
  SegmentedToggle,
  type Segment,
} from "../../components/SegmentedToggle";
import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { DataDebugTab } from "../../components/Tabs/DataDebugTab";
import { useSuppressLayoutMainBottomSpacing } from "../../components/Layout/LayoutMainBottomSpacingContext";
import { useRemainingViewportHeight } from "../../hooks/useRemainingViewportHeight";

const trackedEntityHref = (
  entity: TrackedEntitySnapshot,
  projectId: string,
): string | null => {
  switch (entity.targetEntityType) {
    case EntityType.Task:
      return WebPathService.task({ projectId, taskId: entity.targetEntityId });
    case EntityType.DesignDoc:
      return WebPathService.designDoc({
        projectId,
        designDocId: entity.targetEntityId,
      });
    case EntityType.Service:
      return WebPathService.service({
        projectId,
        serviceId: entity.targetEntityId,
      });
    case EntityType.Initiative:
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: entity.targetEntityId,
      });
    case EntityType.Conversation:
      return WebPathService.conversation({
        projectId,
        conversationId: entity.targetEntityId,
      });
    default:
      return null;
  }
};

const trackedEntityFilterStatus = (
  entity: TrackedEntitySnapshot,
  trackedTasksById: ReadonlyMap<
    string,
    Pick<TaskResponseDto, "type" | "status">
  >,
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
): WorkStatus | undefined => {
  if (entity.targetEntityType !== EntityType.Task) {
    return entity.status;
  }

  const task = trackedTasksById.get(entity.targetEntityId);
  const definition = task ? workItemTypeDefinitions.get(task.type) : undefined;
  if (
    !task ||
    !definition ||
    definition.allowedStatuses.length === 0 ||
    !definition.allowedStatuses.includes(task.status)
  ) {
    return undefined;
  }

  return task.status;
};

const relatedEntityHref = (
  entity: ContextRelatedEntityDto,
  projectId: string,
): string | null => {
  switch (entity.entityType) {
    case EntityType.Task:
      return WebPathService.task({ projectId, taskId: entity.entityId });
    case EntityType.DesignDoc:
      return WebPathService.designDoc({
        projectId,
        designDocId: entity.entityId,
      });
    case EntityType.Service:
      return WebPathService.service({ projectId, serviceId: entity.entityId });
    case EntityType.Initiative:
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: entity.entityId,
      });
    case EntityType.Conversation:
      return WebPathService.conversation({
        projectId,
        conversationId: entity.entityId,
      });
    default:
      return null;
  }
};

interface MappedRelationship {
  edgeType: AgentEdgeType;
  direction: "outgoing" | "incoming";
}

const mapRelationship = (
  relationship: ContextRelatedEntityDto["relationship"],
): MappedRelationship | null => {
  switch (relationship) {
    case "depends-on":
      return { edgeType: AgentEdgeType.DependsOn, direction: "outgoing" };
    case "blocks":
      return { edgeType: AgentEdgeType.DependsOn, direction: "incoming" };
    case "supersedes":
      return { edgeType: AgentEdgeType.Supersedes, direction: "outgoing" };
    case "superseded-by":
      return { edgeType: AgentEdgeType.Supersedes, direction: "incoming" };
    case "derives-from":
      return { edgeType: AgentEdgeType.DerivesFrom, direction: "outgoing" };
    case "contradicts":
      return { edgeType: AgentEdgeType.Contradicts, direction: "outgoing" };
    case "related-to":
      return { edgeType: AgentEdgeType.RelatedTo, direction: "outgoing" };
    default:
      return null;
  }
};

const buildEdgeDependencies = (
  edges: AgentEdgeResponseDto[],
  taskId: string,
  projectId: string,
): EntityDependency[] => {
  const dependencies: EntityDependency[] = [];
  for (const edge of edges) {
    const isSource = edge.sourceNodeId === taskId;
    const endpointId = isSource ? edge.targetNodeId : edge.sourceNodeId;
    const endpointType = isSource
      ? edge.targetEntityType
      : edge.sourceEntityType;
    const endpointName = isSource ? edge.targetNodeName : edge.sourceNodeName;
    const relationship =
      edge.type === AgentEdgeType.DependsOn
        ? isSource
          ? "depends-on"
          : "blocks"
        : edge.type === AgentEdgeType.Supersedes
          ? isSource
            ? "supersedes"
            : "superseded-by"
          : edge.type === AgentEdgeType.DerivesFrom
            ? "derives-from"
            : edge.type === AgentEdgeType.Contradicts
              ? "contradicts"
              : edge.type === AgentEdgeType.RelatedTo
                ? "related-to"
                : undefined;
    if (!relationship) continue;
    const mapped = mapRelationship(relationship);
    if (!mapped || !endpointType || !endpointName) continue;
    const href = relatedEntityHref(
      {
        entityId: endpointId,
        entityType: endpointType as EntityType,
        displayName: endpointName,
        relationship: "related-to",
      } as ContextRelatedEntityDto,
      projectId,
    );
    if (!href) continue;
    dependencies.push({
      edgeType: mapped.edgeType,
      direction: mapped.direction,
      targetTitle: endpointName,
      href,
    });
  }
  return dependencies;
};

interface TrackedEntityRowProps {
  entity: TrackedEntitySnapshot;
  organizationId: string;
  projectId: string;
  task?: TaskResponseDto;
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;
  onRemoveFromGoal: (entity: TrackedEntitySnapshot) => void;
}

const TRACKED_STATUS_FILTER_STORAGE_PREFIX = "goal-tracked-status-filter:v1";

const trackedStatusFilterStorageKey = (
  projectId: string,
  goalId: string,
): string | null =>
  projectId && goalId
    ? `${TRACKED_STATUS_FILTER_STORAGE_PREFIX}:${projectId}:${goalId}`
    : null;

const isWorkStatus = (value: unknown): value is WorkStatus =>
  typeof value === "string" &&
  Object.values(WorkStatus).includes(value as WorkStatus);

const readTrackedStatusSelection = (
  storageKey: string | null,
): WorkStatus[] | null => {
  if (!storageKey || typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;

    const statuses = [...new Set(parsed.filter(isWorkStatus))];
    return statuses.length > 0 || parsed.length === 0 ? statuses : null;
  } catch {
    return null;
  }
};

const writeTrackedStatusSelection = (
  storageKey: string | null,
  statuses: WorkStatus[],
): void => {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(statuses));
  } catch {
    // Ignore quota / privacy-mode errors — filtering remains in local state.
  }
};

const TRACKED_ENTITY_KIND_LABELS: Record<string, string> = {
  [EntityType.Task]: "Task",
  [EntityType.DesignDoc]: "Design doc",
  [EntityType.Service]: "Service",
  [EntityType.Initiative]: "Initiative",
  [EntityType.Conversation]: "Conversation",
};

type TrackedEntityIcon = NonNullable<EntityListItemProps["entityKindIcon"]>;

const TRACKED_ENTITY_KIND_ICONS: Record<string, TrackedEntityIcon> = {
  [EntityType.Task]: "task",
  [EntityType.DesignDoc]: "design_doc",
  [EntityType.Service]: "service",
  [EntityType.Initiative]: "initiative",
  [EntityType.Conversation]: "conversation",
};

const trackedEntityKind = (entityType: string): string =>
  TRACKED_ENTITY_KIND_LABELS[entityType] ?? "Item";

const trackedEntityKindIcon = (entityType: string): TrackedEntityIcon =>
  TRACKED_ENTITY_KIND_ICONS[entityType] ?? "design_doc";

const TrackedEntityRow: React.FC<TrackedEntityRowProps> = ({
  entity,
  organizationId,
  projectId,
  task,
  workItemTypeDefinitions,
  onRemoveFromGoal,
}) => {
  const presentationRegistry = useWorkItemTypeByKey(
    organizationId,
    projectId,
    task?.type,
  );
  const pathService = getPathService();
  const isTask = entity.targetEntityType === EntityType.Task;
  const isDesignDoc = entity.targetEntityType === EntityType.DesignDoc;
  const { data: designDoc } = useDesignDoc(
    organizationId,
    isDesignDoc ? entity.targetEntityId : undefined,
    { enabled: isDesignDoc && !!organizationId },
  );

  const adapterProps = useMemo<EntityListItemProps | null>(() => {
    if (isTask && task) {
      if (isPlanWorkItem(task)) {
        return planAdapter.toEntityListItemProps(task, {
          projectId,
          pathService,
          showEntityKind: true,
        });
      }
      const workItemTypeDefinition = workItemTypeDefinitions.get(task.type);
      const resolvedDefinition =
        workItemTypeDefinition?.key === task.type
          ? workItemTypeDefinition
          : undefined;
      const props = taskAdapter.toEntityListItemProps(task, {
        projectId,
        initiativeId: task.initiativeId ?? undefined,
        pathService,
        showEntityKind: true,
        workItemTypeDefinition: resolvedDefinition,
        workItemTypeEffectiveSource:
          presentationRegistry.workItemTypeSummary?.effectiveSource,
      });
      const resolvedKindLabel =
        props.entityKindLabel ?? resolvedDefinition?.name.trim();
      return {
        ...props,
        entityKindLabel: resolvedKindLabel || "Task",
        entityKindIcon: props.entityKindIcon ?? "task",
        status:
          resolvedDefinition && resolvedDefinition.allowedStatuses.length > 0
            ? props.status
            : undefined,
      };
    }
    if (isDesignDoc && designDoc) {
      const props = designDocAdapter.toEntityListItemProps(designDoc, {
        projectId,
        pathService,
        showEntityKind: true,
      });
      return {
        ...props,
        entityKindLabel: props.entityKindLabel ?? "Design doc",
        entityKindIcon: props.entityKindIcon ?? "design_doc",
      };
    }
    return null;
  }, [
    isTask,
    task,
    isDesignDoc,
    designDoc,
    projectId,
    pathService,
    workItemTypeDefinitions,
    presentationRegistry.workItemTypeSummary?.effectiveSource,
  ]);

  const dependencies =
    adapterProps?.dependencies ??
    (task
      ? buildEdgeDependencies(task.edges ?? [], task.id, projectId)
      : undefined);
  const rowContent = adapterProps ? (
    <EntityListItem {...adapterProps} dependencies={dependencies} />
  ) : (
    <EntityListItem
      title={entity.title}
      entityKindLabel={trackedEntityKind(entity.targetEntityType)}
      entityKindIcon={trackedEntityKindIcon(entity.targetEntityType)}
      status={
        isTask
          ? undefined
          : entity.status
            ? formatStatus(entity.status)
            : undefined
      }
      href={trackedEntityHref(entity, projectId) ?? undefined}
    />
  );
  const supportsGoalRemoval = isTask;

  return (
    <Box
      sx={{ width: "100%" }}
      data-testid={`goal-tracked-entity-${entity.targetEntityId}`}
    >
      {supportsGoalRemoval ? (
        <InteractionComponent
          entityId={entity.targetEntityId}
          entityType={entity.targetEntityType}
          entitySubtype={task?.type}
          entityTitle={entity.title}
          organizationId={organizationId}
          projectId={projectId}
          hasProposalSupport
          draggable={false}
          contextualActions={[
            {
              action: "remove_from_goal",
              label: "Remove from goal",
              testId: "goal-tracked-remove-from-goal",
              onSelect: () => onRemoveFromGoal(entity),
            },
          ]}
        >
          {rowContent}
        </InteractionComponent>
      ) : (
        rowContent
      )}
    </Box>
  );
};

export interface GoalPageProps {
  organizationId?: string;
  projectId?: string;
  taskId?: string;
  preview?: boolean;
}

type GoalSubtab = "overview" | "conversations" | "tracked-items" | "data-debug";

const GOAL_SUBTAB_SEGMENTS: readonly Segment<GoalSubtab>[] = [
  { value: "overview", label: "Overview" },
  { value: "conversations", label: "Conversations" },
  { value: "tracked-items", label: "Tracked Items" },
];

const surfaceSelectionsEqual = (
  left: SurfaceSelection | null,
  right: SurfaceSelection | null,
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    left.fastMode === right.fastMode
  );
};

export const GoalPage: React.FC<GoalPageProps> = ({
  organizationId: organizationIdProp,
  projectId: projectIdProp,
  taskId: taskIdProp,
  preview = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routeParams = useParams<{
    projectId: string;
    taskId: string;
  }>();
  const projectId = projectIdProp ?? routeParams.projectId ?? "";
  const taskId = taskIdProp ?? routeParams.taskId ?? "";
  const { currentOrgId } = useUserIdentity() || {};
  const organizationId = organizationIdProp ?? currentOrgId ?? "";
  const { mutate: enactGoalPmChoice } = useGoalPmRoutingEnactment();
  const { isPlatformAdmin } = usePlatformAdminAccess();

  const { data: project } = useProject(organizationId, projectId ?? "", {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  const {
    task,
    isLoading: isTaskLoading,
    error: taskError,
  } = useTaskHierarchy(organizationId, projectId ?? "", taskId ?? "", {
    enabled: !!organizationId && !!projectId && !!taskId,
    refetchOnMount: true,
  });

  const { workItem: goalWorkItem, refetch: refetchGoalWorkItem } = useWorkItem(
    organizationId,
    "task",
    taskId ?? "",
    {
      projectId,
      enabled: !!organizationId && !!projectId && !!taskId,
      refetchOnMount: true,
      preferStale: true,
    },
  );

  const goalTask =
    (goalWorkItem as TaskResponseDto | null) ??
    (task as TaskResponseDto | null);

  const [selectedGoalSubtab, setSelectedGoalSubtab] =
    useState<GoalSubtab>("overview");
  const [isContextualRailVisible, setIsContextualRailVisible] = useState(true);

  const handleToggleContextualRail = useCallback(() => {
    setIsContextualRailVisible((previous) => !previous);
  }, []);

  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId ?? "",
    undefined,
    { initiativeId: goalTask?.initiativeId ?? undefined },
  );
  const { detach } = useDetachFromGoal({ organizationId, projectId });

  const goalDescription = useMemo(
    () =>
      goalTask?.sections
        ?.find((section) => section.key === "description")
        ?.materializedMarkdown?.trim() ?? "",
    [goalTask?.sections],
  );
  const goalConversationSurfaceId = useMemo(
    () => getGoalConversationSurfaceId(taskId),
    [taskId],
  );
  const machineResolution = useMachineResolution();
  const selectedGoalMachineId =
    machineResolution.selectedMachine?.machineId ?? null;
  activateCapabilityCatalogMachine(selectedGoalMachineId);
  const catalogState = useSyncExternalStore(
    subscribeCapabilityCatalog,
    () => getCapabilityCatalogLoadState(selectedGoalMachineId),
    () => getCapabilityCatalogLoadState(selectedGoalMachineId),
  );
  const [goalConversationSelection, setGoalConversationSelection] =
    useState<SurfaceSelection | null>(
      () =>
        readSurfaceSelection(goalConversationSurfaceId) ??
        buildDefaultSurfaceSelection(),
    );
  useEffect(() => {
    const nextSelection =
      readSurfaceSelection(goalConversationSurfaceId) ??
      buildDefaultSurfaceSelection();
    setGoalConversationSelection((currentSelection) =>
      surfaceSelectionsEqual(currentSelection, nextSelection)
        ? currentSelection
        : nextSelection,
    );
  }, [catalogState, goalConversationSurfaceId, selectedGoalMachineId]);
  const handleGoalConversationSelectionChange = useCallback(
    (selection: SurfaceSelection) => {
      setGoalConversationSelection(selection);
      writeSurfaceSelection(goalConversationSurfaceId, selection);
    },
    [goalConversationSurfaceId],
  );
  const goalMachineSelection = useMemo<ModelSelectorMachineSelectionProps>(
    () => ({
      machines: machineResolution.machines,
      machineMode: machineResolution.mode,
      selectedMachineId: selectedGoalMachineId,
      onSelectMachine: machineResolution.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machineResolution.isReady,
        machines: machineResolution.machines,
        selectedMachineId: selectedGoalMachineId,
      }),
    }),
    [
      machineResolution.isReady,
      machineResolution.machines,
      machineResolution.mode,
      machineResolution.setSelectedMachineId,
      selectedGoalMachineId,
    ],
  );
  const [selectedGoalConversationId, setSelectedGoalConversationId] =
    useQueryState("conversation", parseAsString);
  // Session a Goal PM outcome reported for the conversation it activated, used
  // until the session list refetch includes it.
  const [activatedGoalConversation, setActivatedGoalConversation] = useState<{
    conversationId: string;
    agentSessionId: string;
  } | null>(null);
  const {
    data: goalConversationsData,
    isLoading: areGoalConversationsLoading,
    isReady: areGoalConversationsReady,
    error: goalConversationsError,
    markStale: refreshGoalConversations,
  } = useConversations(organizationId, projectId, {
    workflowAboutId: taskId || undefined,
    workflowAboutType: "task",
    enabled: !!organizationId && !!projectId && !!taskId,
  });
  const {
    agentSessions: goalConversationSessions,
    markStale: refreshGoalConversationSessions,
  } = useAgentSessions(organizationId, projectId, {
    entityType: EntityType.Task,
    entityId: taskId,
    type: AgentSessionType.EntityConversation,
    enabled: !!organizationId && !!projectId && !!taskId,
  });
  const goalConversations = useMemo(
    () => (goalConversationsData ?? []) as ConversationResponseDto[],
    [goalConversationsData],
  );
  const goalConversationInventory = useMemo<
    LocalGoalPmConversationInventoryItem[]
  >(
    () =>
      goalConversations.flatMap((conversation) => {
        const title = conversation.title;
        if (!title?.trim()) return [];
        return [
          {
            conversationId: conversation.id,
            title,
            owner: {
              entityType: EntityType.Task,
              entityId: taskId,
              taskType: "GOAL",
            },
            workflowName: conversation.workflowName,
          },
        ];
      }),
    [goalConversations, taskId],
  );
  const activeGoalConversationSession = useMemo(() => {
    const goalPmConversation = goalConversations.find(
      (conversation) => conversation.workflowName === WorkflowName.GoalPm,
    );
    const goalPmSession = goalPmConversation
      ? goalConversationSessions.find(
          (session) => session.conversationId === goalPmConversation.id,
        )
      : null;
    return selectedGoalConversationId
      ? (goalConversationSessions.find(
          (session) => session.conversationId === selectedGoalConversationId,
        ) ?? null)
      : (goalPmSession ?? null);
  }, [goalConversations, goalConversationSessions, selectedGoalConversationId]);
  const activeGoalConversationId =
    activeGoalConversationSession?.conversationId ?? null;
  const activeGoalConversation = goalConversations.find(
    (conversation) => conversation.id === activeGoalConversationId,
  );
  const handleGoalConversationSelect = useCallback(
    (conversationId: string) => {
      const session = goalConversationSessions.find(
        (candidate) => candidate.conversationId === conversationId,
      );
      if (session) {
        setNewConversationDraft("");
        setTransferredGoalRequest("");
        void setSelectedGoalConversationId(conversationId);
      }
    },
    [goalConversationSessions, setSelectedGoalConversationId],
  );
  const goalPmConversationLink = useMemo<GoalPmConversationLink>(
    () => ({
      href: (conversationId) =>
        `${WebPathService.goal({ projectId, taskId })}?${new URLSearchParams({
          conversation: conversationId,
        })}`,
      onOpen: handleGoalConversationSelect,
    }),
    [projectId, taskId, handleGoalConversationSelect],
  );
  const handleGoalConversationArchived = useCallback(
    (conversationId: string) => {
      if (activeGoalConversationId === conversationId) {
        void setSelectedGoalConversationId(null);
      }
      refreshGoalConversations();
    },
    [
      activeGoalConversationId,
      refreshGoalConversations,
      setSelectedGoalConversationId,
    ],
  );
  const currentGoalIdRef = useRef(taskId);
  currentGoalIdRef.current = taskId;
  const [newConversationError, setNewConversationError] = useState<
    string | null
  >(null);
  const [newConversationDraft, setNewConversationDraft] = useState("");
  const [transferredGoalRequest, setTransferredGoalRequest] = useState("");
  const [pendingGoalPmRequest, setPendingGoalPmRequest] = useState("");
  // A conversation param arriving with the page (deep link / reload) is kept
  // for the initial goal; switching goals drops the previous goal's thread.
  const previousGoalIdRef = useRef(taskId);
  // Only a URL-restored id is validated against the goal's conversations;
  // ids written in-page may precede the conversation list refetch.
  const restoredGoalConversationIdRef = useRef(selectedGoalConversationId);
  useEffect(() => {
    if (previousGoalIdRef.current === taskId) return;
    previousGoalIdRef.current = taskId;
    restoredGoalConversationIdRef.current = null;
    setActivatedGoalConversation(null);
    void setSelectedGoalConversationId(null);
    setNewConversationDraft("");
    setTransferredGoalRequest("");
    setPendingGoalPmRequest("");
    setNewConversationError(null);
  }, [taskId, setSelectedGoalConversationId]);
  useEffect(() => {
    const restoredId = restoredGoalConversationIdRef.current;
    if (
      !restoredId ||
      !areGoalConversationsReady ||
      areGoalConversationsLoading
    )
      return;
    restoredGoalConversationIdRef.current = null;
    if (
      selectedGoalConversationId === restoredId &&
      !goalConversations.some((conversation) => conversation.id === restoredId)
    )
      void setSelectedGoalConversationId(null);
  }, [
    areGoalConversationsReady,
    areGoalConversationsLoading,
    goalConversations,
    selectedGoalConversationId,
    setSelectedGoalConversationId,
  ]);
  const handleGoalPmAction = useCallback(
    async (
      selection: GoalPmRoutingSelectionPayload,
      sourceConversationId: string,
      draftText: string = "",
      cardCreation?: GoalPmRoutingCreation,
    ) => {
      setNewConversationError(null);
      try {
        const result = await enactGoalPmChoice({
          organizationId,
          projectId,
          goalId: taskId,
          sourceConversationId,
          input: {
            selection,
            ...(pendingGoalPmRequest
              ? { pendingRequest: pendingGoalPmRequest }
              : {}),
            ...(cardCreation
              ? { creation: cardCreation }
              : selectedGoalMachineId && goalConversationSelection
                ? {
                    creation: {
                      config: buildEntityConversationSessionConfig(
                        goalConversationSelection,
                      ),
                      provider: goalConversationSelection.provider,
                      machineId: selectedGoalMachineId,
                      ...(goalConversationSelection.fastMode !== undefined
                        ? { fastMode: goalConversationSelection.fastMode }
                        : {}),
                    },
                  }
                : {}),
          },
        });
        if (currentGoalIdRef.current !== taskId) return result;
        const outcome = result.answer.outcome;
        refreshGoalConversations();
        refreshGoalConversationSessions();
        if (outcome?.entityType === "CONVERSATION") {
          setNewConversationDraft(draftText);
          setTransferredGoalRequest("");
          if (outcome.agentSessionId)
            setActivatedGoalConversation({
              conversationId: outcome.entityId,
              agentSessionId: outcome.agentSessionId,
            });
          void setSelectedGoalConversationId(outcome.entityId);
        } else if (outcome?.entityType === "PROPOSAL") {
          navigate(`/projects/${projectId}/proposals/${outcome.entityId}`);
        } else if (outcome?.entityType === "TASK") {
          await refetchGoalWorkItem();
        }
        if (
          result.answer.state === "COMPLETED" &&
          result.answer.selectedOption.kind !== "refineSearch"
        )
          setPendingGoalPmRequest("");
        return result;
      } catch (error) {
        if (currentGoalIdRef.current === taskId)
          setNewConversationError(
            error instanceof Error
              ? error.message
              : "Unable to apply this choice.",
          );
        throw error;
      }
    },
    [
      enactGoalPmChoice,
      organizationId,
      projectId,
      taskId,
      pendingGoalPmRequest,
      selectedGoalMachineId,
      goalConversationSelection,
      refreshGoalConversations,
      refreshGoalConversationSessions,
      setSelectedGoalConversationId,
      navigate,
      refetchGoalWorkItem,
    ],
  );
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  const handleDescriptionSave = useCallback(
    async (description: string) => {
      if (!goalTask?.id) return;

      setIsSavingDescription(true);
      try {
        await updateTask(goalTask.id, {
          sections: [
            {
              key: "description",
              content: description.trim(),
              order: 0,
            },
          ],
        });
        await refetchGoalWorkItem();
      } finally {
        setIsSavingDescription(false);
      }
    },
    [goalTask?.id, refetchGoalWorkItem, updateTask],
  );

  const handleRemoveFromGoal = useCallback(
    async (entity: TrackedEntitySnapshot) => {
      try {
        await detach({
          goalId: taskId,
          targetEntityId: entity.targetEntityId,
          targetEntityType: entity.targetEntityType,
        });
        await refetchGoalWorkItem();
      } catch (error) {
        console.error("Failed to remove tracked work from goal:", error);
      }
    },
    [detach, refetchGoalWorkItem, taskId],
  );

  const trackedEntities = useMemo(
    () => goalTask?.trackedEntities ?? [],
    [goalTask?.trackedEntities],
  );
  const trackedTaskIds = useMemo(
    () => [
      ...new Set(
        trackedEntities
          .filter((entity) => entity.targetEntityType === EntityType.Task)
          .map((entity) => entity.targetEntityId),
      ),
    ],
    [trackedEntities],
  );
  const { workItems: hydratedTrackedTasks, isLoading: isTrackedTasksLoading } =
    useWorkItems(organizationId, "task", projectId, undefined, {
      taskIds: trackedTaskIds,
      includeEdges: true,
      enabled: !!organizationId && !!projectId && trackedTaskIds.length > 0,
    });
  const trackedTasksById = useMemo(
    () => new Map(hydratedTrackedTasks.map((task) => [task.id, task])),
    [hydratedTrackedTasks],
  );
  const { workItemTypes } = useWorkItemTypes(organizationId, {
    projectId,
    status: WorkItemTypeLifecycleStatus.Active,
  });
  const workItemTypeDefinitions = useMemo(
    () => indexWorkItemTypeDefinitions(workItemTypes),
    [workItemTypes],
  );
  const trackedStatusOptions = useMemo(() => {
    const options = new Set<WorkStatus>();
    for (const entity of trackedEntities) {
      const status = trackedEntityFilterStatus(
        entity,
        trackedTasksById,
        workItemTypeDefinitions,
      );
      if (status) options.add(status);
    }
    return [...options];
  }, [trackedEntities, trackedTasksById, workItemTypeDefinitions]);
  const trackedStatusFilterKey = useMemo(
    () => trackedStatusFilterStorageKey(projectId, taskId),
    [projectId, taskId],
  );
  const [selectedTrackedStatuses, setSelectedTrackedStatuses] = useState<
    WorkStatus[] | null
  >(() => readTrackedStatusSelection(trackedStatusFilterKey));
  useEffect(() => {
    setSelectedTrackedStatuses(
      readTrackedStatusSelection(trackedStatusFilterKey),
    );
  }, [trackedStatusFilterKey]);
  const normalizedSelectedTrackedStatuses = useMemo(() => {
    if (selectedTrackedStatuses === null) return null;

    const representedStatuses = new Set(trackedStatusOptions);
    const normalizedStatuses = selectedTrackedStatuses.filter((status) =>
      representedStatuses.has(status),
    );
    return normalizedStatuses.length > 0 || selectedTrackedStatuses.length === 0
      ? normalizedStatuses
      : null;
  }, [selectedTrackedStatuses, trackedStatusOptions]);
  const effectiveSelectedTrackedStatuses =
    normalizedSelectedTrackedStatuses ?? trackedStatusOptions;
  const showsAllTrackedEntities =
    normalizedSelectedTrackedStatuses === null ||
    trackedStatusOptions.length === 0 ||
    trackedStatusOptions.every((status) =>
      effectiveSelectedTrackedStatuses.includes(status),
    );
  const handleTrackedStatusFilterChange = useCallback(
    (event: SelectChangeEvent<WorkStatus[]>) => {
      const nextStatuses = [
        ...new Set(
          (typeof event.target.value === "string"
            ? event.target.value.split(",")
            : event.target.value) as WorkStatus[],
        ),
      ];
      setSelectedTrackedStatuses(nextStatuses);
      writeTrackedStatusSelection(trackedStatusFilterKey, nextStatuses);
    },
    [trackedStatusFilterKey],
  );
  const visibleTrackedEntities = useMemo(
    () =>
      showsAllTrackedEntities
        ? trackedEntities
        : trackedEntities.filter((entity) => {
            const status = trackedEntityFilterStatus(
              entity,
              trackedTasksById,
              workItemTypeDefinitions,
            );
            return (
              status !== undefined &&
              effectiveSelectedTrackedStatuses.includes(status)
            );
          }),
    [
      trackedEntities,
      trackedTasksById,
      workItemTypeDefinitions,
      effectiveSelectedTrackedStatuses,
      showsAllTrackedEntities,
    ],
  );

  const derivedStatus = useMemo(() => {
    if (!goalTask) return null;
    return deriveGoalStatus({
      dueDate: goalTask.dueDate,
      trackedEntities: goalTask.trackedEntities,
    });
  }, [goalTask]);

  const { reports } = useReports(organizationId, {
    reportType: ReportType.GoalProgress,
    entityType: ReportRelatedEntityType.Task,
    entityId: taskId ?? "",
    sortBy: "createdAt",
    sortDirection: "desc",
    enabled: !!organizationId && !!taskId,
  });

  const latestGoalReport = reports[0] ?? null;

  const goalSubtabSegments = useMemo<readonly Segment<GoalSubtab>[]>(
    () =>
      isPlatformAdmin
        ? [
            ...GOAL_SUBTAB_SEGMENTS,
            {
              value: "data-debug",
              label: t("goals.tabDataDebug", "Data Debug"),
            },
          ]
        : GOAL_SUBTAB_SEGMENTS,
    [isPlatformAdmin, t],
  );
  const resolvedGoalSubtab: GoalSubtab =
    !isPlatformAdmin && selectedGoalSubtab === "data-debug"
      ? "overview"
      : selectedGoalSubtab;

  const handleStatusChange = useCallback(
    async (newStatus: TaskResponseDto["status"]) => {
      if (!goalTask?.id) return;

      try {
        await updateTask(goalTask.id, { status: newStatus });
      } catch (error) {
        console.error("Failed to update goal status:", error);
      }
    },
    [goalTask?.id, updateTask],
  );

  const handleDueDateChange = useCallback(
    async (newDueDate: string | null) => {
      if (!goalTask?.id) return;

      try {
        await updateTask(goalTask.id, { dueDate: newDueDate });
        await refetchGoalWorkItem();
      } catch (error) {
        console.error("Failed to update goal due date:", error);
      }
    },
    [goalTask?.id, refetchGoalWorkItem, updateTask],
  );

  // On desktop the goal workspace owns its scroll areas: <main> stops
  // scrolling and the container fills exactly the viewport height left below
  // the page chrome, so no fixed chrome offset is needed.
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const bounded = !preview && !isMobile;
  useSuppressLayoutMainBottomSpacing(bounded);
  const { containerRef: boundedContainerRef, height: boundedHeight } =
    useRemainingViewportHeight(bounded, 0);

  const breadcrumbs = (
    <PageBreadcrumbs
      sx={{ mb: 2 }}
      items={[
        { label: "Projects", to: "/projects" },
        {
          label: project?.name ?? "Project",
          to: `/projects/${projectId}`,
          type: "project",
        },
        {
          label: t("goals.title", "Goals"),
          to: `/projects/${projectId}/goals`,
          type: "goal",
        },
        {
          label: goalTask?.name ?? t("goals.loading", "Loading goal..."),
          isCurrent: true,
          type: "goal",
        },
      ]}
    />
  );

  if (!projectId || !taskId) {
    return (
      <>
        {breadcrumbs}
        <DetailPageContainer>
          <Alert severity="error">
            {t(
              "goals.missingParams",
              "Missing required route parameters. Please check the goal URL.",
            )}
          </Alert>
        </DetailPageContainer>
      </>
    );
  }

  if (taskError) {
    return (
      <>
        {breadcrumbs}
        <DetailPageContainer>
          <Alert severity="error">
            {taskError.message ?? t("goals.loadError", "Failed to load goal")}
          </Alert>
        </DetailPageContainer>
      </>
    );
  }

  if (isTaskLoading && !goalTask) {
    return (
      <>
        {breadcrumbs}
        <DetailPageContainer>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 200,
            }}
          >
            <CircularProgress />
          </Box>
        </DetailPageContainer>
      </>
    );
  }

  if (!goalTask) {
    return (
      <>
        {breadcrumbs}
        <DetailPageContainer>
          <Alert severity="warning">
            {t(
              "goals.notFound",
              "Goal not found. It may have been removed or the link is invalid.",
            )}
          </Alert>
        </DetailPageContainer>
      </>
    );
  }

  const pageComposition = preview
    ? { kind: "observational" as const }
    : {
        kind: "canonical" as const,
        descriptor: createCanonicalPageDescriptor("goal", taskId, null, {
          kind: "goal",
          label: goalTask.name,
        }),
      };

  const goalConversationViewer = (
    <Box
      data-testid="goal-conversation-viewer"
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        height: { xs: "auto", md: "100%" },
      }}
    >
      <Box
        data-testid="goal-conversation"
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          overflowX: "hidden",
          overflowY: "hidden",
          maxHeight: { xs: "calc(100dvh - 280px)", md: "none" },
        }}
      >
        {!preview && goalConversationsError && (
          <Alert
            severity="error"
            data-testid="goal-conversation-inventory-error"
          >
            Goal conversations could not be loaded. Goal PM routing is
            unavailable.
          </Alert>
        )}
        {!preview && areGoalConversationsReady && (
          <GoalPrimaryConversation
            organizationId={organizationId}
            projectId={projectId}
            goalId={taskId}
            goalTask={goalTask}
            runtimeSelection={goalConversationSelection}
            onRuntimeSelectionChange={handleGoalConversationSelectionChange}
            machineSelection={goalMachineSelection}
            key={taskId}
            selectedAgentSessionId={
              activeGoalConversationSession?.id ??
              (activatedGoalConversation?.conversationId ===
              selectedGoalConversationId
                ? activatedGoalConversation?.agentSessionId
                : undefined)
            }
            onConversationReady={refreshGoalConversations}
            initialDraft={newConversationDraft}
            initialUserMessage={transferredGoalRequest || undefined}
            onInitialUserMessageSent={() => setTransferredGoalRequest("")}
            onGoalPmAction={handleGoalPmAction}
            onGoalPmRequestSubmitted={setPendingGoalPmRequest}
            goalPmConversationLink={goalPmConversationLink}
            goalPm={
              (
                activeGoalConversation
                  ? activeGoalConversation.workflowName === WorkflowName.GoalPm
                  : !selectedGoalConversationId
              )
                ? { conversationInventory: goalConversationInventory }
                : undefined
            }
          />
        )}
      </Box>
    </Box>
  );

  const goalConversationTocProps = {
    organizationId,
    projectId,
    conversations: goalConversations,
    activeConversationId: activeGoalConversationId,
    isLoading: areGoalConversationsLoading,
    onConversationSelect: handleGoalConversationSelect,
    onConversationArchived: handleGoalConversationArchived,
  };

  const goalConversationToc = (
    <GoalConversationToc {...goalConversationTocProps} />
  );

  const goalRightRailConversationToc = (
    <GoalConversationToc {...goalConversationTocProps} scrollOwner="parent" />
  );

  const goalRelatedWorkContent = (
    <Stack
      spacing={2}
      data-testid="goal-related-work"
      sx={{
        flex: "0 0 auto",
        minWidth: 0,
        height: "auto",
      }}
    >
      {latestGoalReport && (
        <Card
          title={t("goals.latestReport", "Latest progress report")}
          dataTestId="goal-latest-report"
        >
          <Stack spacing={1.25} sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="goal-latest-report-date"
            >
              {new Date(latestGoalReport.createdAt).toLocaleString()}
            </Typography>
            <ReportCard
              report={latestGoalReport}
              organizationId={organizationId}
              projectId={projectId}
              embeddedInGoalPage
            />
          </Stack>
        </Card>
      )}

      <Card
        title={t("goals.trackedEntities", "Tracked work")}
        dataTestId="goal-tracked-entities"
        action={
          trackedEntities.length > 0 ? (
            <FormControl
              size="small"
              sx={{ minWidth: 180 }}
              disabled={trackedStatusOptions.length === 0}
            >
              <InputLabel id="goal-tracked-status-filter-label">
                Filter by status
              </InputLabel>
              <Select<WorkStatus[]>
                labelId="goal-tracked-status-filter-label"
                multiple
                value={effectiveSelectedTrackedStatuses}
                label="Filter by status"
                data-testid="goal-tracked-status-filter"
                onChange={handleTrackedStatusFilterChange}
                input={<OutlinedInput label="Filter by status" />}
                renderValue={(selected: WorkStatus[]) =>
                  selected.map(formatStatus).join(", ")
                }
              >
                {trackedStatusOptions.map((status) => (
                  <MenuItem key={status} value={status}>
                    <Checkbox
                      checked={effectiveSelectedTrackedStatuses.includes(
                        status,
                      )}
                      size="small"
                    />
                    {formatStatus(status)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : undefined
        }
      >
        <Stack spacing={1.25} sx={{ minWidth: 0 }}>
          {trackedTaskIds.length > 0 && isTrackedTasksLoading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                py: 2,
              }}
              data-testid="goal-tracked-entities-loading"
            >
              <CircularProgress size={24} />
            </Box>
          ) : trackedEntities.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              fontStyle="italic"
              data-testid="goal-tracked-entities-empty"
            >
              {t(
                "goals.trackedEntitiesEmpty",
                "This goal isn't tracking any work yet.",
              )}
            </Typography>
          ) : (
            <Stack spacing={0}>
              {visibleTrackedEntities.map((entity, index) => (
                <TrackedEntityRow
                  key={`${entity.targetEntityType}-${entity.targetEntityId}-${index}`}
                  entity={entity}
                  organizationId={organizationId}
                  projectId={projectId}
                  task={
                    entity.targetEntityType === EntityType.Task
                      ? (trackedTasksById.get(entity.targetEntityId) as
                          TaskResponseDto | undefined)
                      : undefined
                  }
                  workItemTypeDefinitions={workItemTypeDefinitions}
                  onRemoveFromGoal={handleRemoveFromGoal}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );

  const goalRightRail = (
    <Stack
      spacing={2}
      data-testid="goal-right-rail"
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      {goalRightRailConversationToc}
      {goalRelatedWorkContent}
    </Stack>
  );

  const contextualRail = {
    id: `goal-contextual-rail-${taskId}`,
    label: "Goal context",
    expanded: isContextualRailVisible,
    onToggle: handleToggleContextualRail,
    sx: {
      position: "relative",
      top: -30,
    },
  };

  const overviewGoalContent = (
    <Box
      data-testid="goal-detail-grid"
      sx={{
        display: "flex",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <DetailPageBody
        widthStrategy="equal-split"
        gap={3}
        sidebarSide="right"
        fillHeight
        contextualRail={contextualRail}
        content={goalConversationViewer}
        sidebar={goalRightRail}
      />
    </Box>
  );

  const conversationGoalContent = (
    <Box
      data-testid="goal-conversation-view"
      sx={{
        display: "flex",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <DetailPageBody
        widthStrategy="equal-split"
        gap={3}
        sidebarSide="right"
        fillHeight
        contextualRail={contextualRail}
        content={goalConversationViewer}
        sidebar={
          <Box sx={{ minHeight: 0, minWidth: 0 }}>{goalConversationToc}</Box>
        }
      />
    </Box>
  );

  const trackedItemsGoalContent = (
    <Box
      data-testid="goal-tracked-items-view"
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      {goalRelatedWorkContent}
    </Box>
  );

  return (
    <CanonicalPageBoundary composition={pageComposition}>
      <>
        {breadcrumbs}
        <DetailPageContainer
          ref={bounded ? boundedContainerRef : undefined}
          rootSx={
            bounded
              ? {
                  boxSizing: "border-box",
                  height:
                    boundedHeight === null ? undefined : `${boundedHeight}px`,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                }
              : undefined
          }
          paperSx={{
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            // When bounded, the card is the outer scroller: anything that does
            // not fit (header, short viewports) scrolls inside it
            // rather than being clipped.
            ...(bounded
              ? {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflowY: "auto",
                }
              : {}),
          }}
        >
          {newConversationError ? (
            <Alert
              severity="error"
              onClose={() => setNewConversationError(null)}
              data-testid="goal-new-conversation-error"
            >
              {newConversationError}
            </Alert>
          ) : null}
          <Box data-testid="goal-compact-header">
            <DetailPageHeader
              title={
                <Stack
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <Typography
                    component="h2"
                    variant="h4"
                    data-testid="goal-title"
                  >
                    {goalTask.name}
                  </Typography>
                  {derivedStatus &&
                    (() => {
                      const descriptor =
                        goalStatusChipDescriptor(derivedStatus);
                      return (
                        <Chip
                          label={t(descriptor.i18nKey, descriptor.fallback)}
                          color={descriptor.color}
                          size="small"
                          data-testid="goal-status-badge"
                        />
                      );
                    })()}
                </Stack>
              }
              metadataComponent={
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                  data-testid="goal-metadata-row"
                  sx={{ minWidth: 0, width: "100%", overflow: "hidden" }}
                >
                  <WorkItemMetadata
                    fields={{
                      status: {
                        mode: "editable",
                        value: goalTask.status,
                        onChange: handleStatusChange,
                      },
                      dueDate: {
                        mode: "editable",
                        value: goalTask.dueDate ?? null,
                        onChange: handleDueDateChange,
                        allowClear: true,
                      },
                    }}
                    currentTaskId={goalTask.id}
                    taskType={WORK_ITEM_TYPE_KEYS.Goal}
                    organizationId={organizationId}
                    projectId={projectId}
                    disabled={preview}
                    size="small"
                    rootClassName="goal-editable-metadata"
                  />

                  <GoalDescriptionEditor
                    description={goalDescription}
                    disabled={preview}
                    isSaving={isSavingDescription}
                    onSave={handleDescriptionSave}
                  />
                </Stack>
              }
            />
          </Box>
          <Stack
            spacing={1.5}
            sx={{
              minWidth: 0,
              minHeight: 0,
              flex: bounded ? 1 : undefined,
              // Floor so the panes stay usable; below it the card scrolls.
              ...(bounded ? { minHeight: 560 } : {}),
            }}
          >
            <SegmentedToggle<GoalSubtab>
              mobileDropdown
              segments={goalSubtabSegments}
              value={resolvedGoalSubtab}
              onChange={setSelectedGoalSubtab}
              sx={{
                alignSelf: "flex-start",
                width: { xs: "100%", md: "auto" },
              }}
            />

            {resolvedGoalSubtab === "overview" && overviewGoalContent}
            {resolvedGoalSubtab === "conversations" && conversationGoalContent}
            {resolvedGoalSubtab === "tracked-items" && trackedItemsGoalContent}
            {resolvedGoalSubtab === "data-debug" && (
              <DataDebugTab
                organizationId={organizationId}
                projectId={projectId}
                entityId={taskId}
                entityType={EntityType.Task}
              />
            )}
          </Stack>
        </DetailPageContainer>
      </>
    </CanonicalPageBoundary>
  );
};
