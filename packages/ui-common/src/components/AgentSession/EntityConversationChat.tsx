import { Box, Button, CircularProgress, Stack } from "@mui/material";
import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EntityType,
  MessageType,
  RunEntityReferenceEntityTypeEnum,
  WorkflowName,
  type AgentSessionDto,
  type CreateUserMessage,
  type LocalGoalPmConversationInventoryItem,
  type RunCreatePayloadGoalPm,
} from "../../api";
import { apiClient } from "../../clients/client.js";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { useLatestMessage } from "../../data/hooks/useLatestMessage";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { LocalPromptType } from "../../api";
import type {
  RunCreatePayloadEntityConversation,
  RunCreatePayloadVerifyFeature,
} from "../../api";
import { getErrorMessage } from "../../utils/errorUtils";
import { getWorkflowAboutTypeForEntityType } from "../../utils/agentSessionUtils";
import { log } from "../../utils/logger";
import type { GoalSnapshot } from "../InteractionComponent/types";
import {
  buildGoalEntityFields,
  getGoalSnapshotFromWorkItem,
} from "../InteractionComponent/goalSnapshot";
import { normalizeEntityType } from "../entityTypeUtils";
import {
  AgentConversationView,
  type AgentConversationViewProps,
} from "./AgentConversationView";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { useLatestProviderSessionId } from "./RunContextUsageCapsules";
import { SessionContextUsageCapsules } from "./SessionContextUsageCapsules";
import { useSessionContextSize } from "../../data/hooks/useSessionContextSize";
import { SessionErrorAlert } from "./SessionErrorAlert";
import {
  dispatchMethodAction,
  type MethodActionContext,
} from "./methodActionDispatch";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";
import { parseRunConversationMessageSubmission } from "./runtime/coding/run-conversation-message";
import { seedConversationGreeting } from "./runtime/hooks/seedConversationGreeting";
import {
  DISCUSS_SURFACE_ID,
  readSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";
import { supportsFastMode } from "./capabilityCatalog";
import { useAgentRunLifecycle, type RunLauncher } from "./useAgentRunLifecycle";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { buildRunEntityReference } from "./runEntityReference";
import {
  readEntityConversationSessionConfig,
  resolveEntityConversationRuntimeSelection,
} from "./entityConversationSessionConfig";
import { resolveAgentSessionMetadata } from "./resolveAgentSessionMetadata";
import { resolveFileReferenceScope } from "../SmarterTextAreaCard/fileReferences/types";
import type { ConversationScrollPolicy } from "../Conversation/ConversationViewer";

const LEGACY_RUN_WORK_ITEM_TYPES = new Set([
  "FEATURE",
  "BUG",
  "GOAL",
  "CONTRACT",
  "TASK_MONITOR",
  "WORKFLOW",
  "WORKFLOW_STEP",
]);

const getLegacyRunWorkItemType = (entityType: string): string | undefined => {
  const normalizedEntityType = entityType
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  const isCanonicalRunEntityType = Object.values(
    RunEntityReferenceEntityTypeEnum,
  ).includes(normalizedEntityType as RunEntityReferenceEntityTypeEnum);
  const normalizedPlatformEntityType = normalizeEntityType(entityType);
  const canBeLegacyWorkItemType =
    normalizedPlatformEntityType === null ||
    normalizedPlatformEntityType === EntityType.Task;
  return !isCanonicalRunEntityType &&
    canBeLegacyWorkItemType &&
    normalizedEntityType
    ? LEGACY_RUN_WORK_ITEM_TYPES.has(normalizedEntityType)
      ? normalizedEntityType
      : entityType.trim()
    : undefined;
};

// Composes the opening greeting from the anchor entity. Falls back to a generic
// string when no entity name is available.
const buildEntityGreetingText = (
  entityName?: string,
  entitySummary?: string,
): string => {
  if (!entityName) return "How can I help you?";
  const base = `I'm here to help you with "${entityName}"`;
  return entitySummary ? `${base} — ${entitySummary}` : `${base}.`;
};

export interface EntityConversationChatProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  entityId: string;
  entityType: string;
  /**
   * Constrains the conversation to the height supplied by its parent using a
   * legacy internal scrollport. Embedded conversations may opt into this
   * bounded composition; full-page callers should pass scrollPolicy instead.
   */
  scrollable?: boolean;
  /** Entity name used to compose the opening greeting row. */
  entityName?: string;
  /** Brief entity summary appended to the opening greeting when provided. */
  entitySummary?: string;
  /** Caller-owned persisted goal context, present only for GOAL tasks. */
  goalSnapshot?: GoalSnapshot;
  /**
   * The provider/model/effort selected by the embedding surface. GoalPage and
   * other fresh-session callers must pass this explicitly so the chat cannot
   * accidentally inherit another surface's browser memory.
   */
  runtimeSelection?: SurfaceSelection | null;
  /**
   * The exact machine binding to use for every start or follow-up request.
   * Callers persist this binding before rendering a locally executable chat.
   */
  machineId?: string;
  /** An embedding surface's explicitly owned scrollport. Takes precedence over scrollable. */
  scrollPolicy?: ConversationScrollPolicy;
  /**
   * When set, this message is posted as the second row immediately after the
   * greeting is seeded — greeting → initial message → agent reply. Intended for
   * DiscussModal-style callers that want to seed an opening prompt without a
   * race condition between greeting creation and message posting.
   */
  initialUserMessage?: string;
  onInitialUserMessageSent?: () => void;
  /** Draft to carry into a newly selected Goal conversation without sending it. */
  initialDraft?: string;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Whether starting a new conversation requires an explicit confirmation. */
  confirmBeforeNewConversation?: boolean;
  /**
   * Persists the caller's current runtime choice and machine binding before a
   * local start or follow-up is dispatched.
   */
  onBeforeLocalExecution?: () => Promise<void>;
  /** Editable model selection applied only to a newly created conversation. */
  newConversationModelSelector?: React.ReactNode;
  /** Controls rendered directly below the active reply composer. */
  actionsSlot?: ReactNode;
  /** Notifies embedding editors when the session has a persisted conversation. */
  onConversationReady?: (conversationId: string) => void;
  /** Routes this conversation through Goal PM with its authoritative goal-owned inventory. */
  goalPm?: {
    conversationInventory: LocalGoalPmConversationInventoryItem[];
  };
  onGoalPmAction?: AgentConversationViewProps["onGoalPmAction"];
  goalPmConversationLink?: AgentConversationViewProps["goalPmConversationLink"];
  onGoalPmRequestSubmitted?: (request: string) => void;
}

interface EntityConversationActiveProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  entityId: string;
  entityType: string;
  scrollable: boolean;
  scrollPolicy?: ConversationScrollPolicy;
  entityName?: string;
  entitySummary?: string;
  goalSnapshot?: GoalSnapshot;
  /** Null while the CLI's model catalog has not loaded: nothing can be sent. */
  runtimeSelection: SurfaceSelection | null;
  machineId: string;
  initialUserMessage?: string;
  onInitialUserMessageSent?: () => void;
  initialDraft?: string;
  launch: RunLauncher;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  confirmBeforeNewConversation: boolean;
  onBeforeLocalExecution?: () => Promise<void>;
  newConversationModelSelector?: React.ReactNode;
  actionsSlot?: ReactNode;
  onConversationReady?: (conversationId: string) => void;
  goalPm?: {
    conversationInventory: LocalGoalPmConversationInventoryItem[];
  };
  onGoalPmAction?: AgentConversationViewProps["onGoalPmAction"];
  goalPmConversationLink?: AgentConversationViewProps["goalPmConversationLink"];
  onGoalPmRequestSubmitted?: (request: string) => void;
}

const EntityConversationActive: React.FC<EntityConversationActiveProps> = ({
  organizationId,
  projectId,
  agentSession,
  entityId,
  entityType,
  scrollable,
  scrollPolicy,
  entityName,
  entitySummary,
  goalSnapshot,
  runtimeSelection,
  machineId,
  initialUserMessage,
  onInitialUserMessageSent,
  initialDraft,
  launch,
  onCreateNewConversation,
  confirmBeforeNewConversation,
  onBeforeLocalExecution,
  newConversationModelSelector,
  actionsSlot,
  onConversationReady,
  goalPm,
  onGoalPmAction,
  goalPmConversationLink,
  onGoalPmRequestSubmitted,
}) => {
  const [localConversationId, setLocalConversationId] = useState<string | null>(
    null,
  );
  const { mutate: createAgentSessionConversation } =
    useCreateAgentSessionConversation();
  const conversationId = localConversationId ?? agentSession.conversationId;
  const latestProviderSessionId = useLatestProviderSessionId(
    organizationId,
    projectId,
    conversationId,
  );
  const contextSize = useSessionContextSize({
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    seed: agentSession.contextSize,
    latestProviderSessionId,
  });
  const notifiedConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !conversationId ||
      notifiedConversationIdRef.current === conversationId
    ) {
      return;
    }
    notifiedConversationIdRef.current = conversationId;
    onConversationReady?.(conversationId);
  }, [conversationId, onConversationReady]);
  const context = useMemo(() => ({ projectId }), [projectId]);

  const capturedAt = useRef(new Date().toISOString());
  const contextMetadata = useMemo(
    () => ({
      capturedAt: capturedAt.current,
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    }),
    [organizationId, projectId, agentSession.id],
  );

  const normalizedEntityType = normalizeEntityType(entityType);
  const legacyRunWorkItemType = getLegacyRunWorkItemType(
    agentSession.entityType ?? entityType,
  );
  const isGenericTaskEntity =
    normalizedEntityType === EntityType.Task ||
    legacyRunWorkItemType !== undefined;
  const {
    workItem: loadedWorkItem,
    isFetched: isWorkItemFetched,
    error: workItemError,
    refetch: refetchWorkItem,
  } = useWorkItem(organizationId, "task", entityId, {
    projectId,
    enabled: isGenericTaskEntity && entityId.trim().length > 0,
  });
  const fileReferenceWorkItemType = isGenericTaskEntity
    ? loadedWorkItem?.type
    : entityType;
  const loadedWorkItemType = isGenericTaskEntity
    ? loadedWorkItem?.type
    : undefined;
  const effectiveWorkItemType = loadedWorkItemType ?? legacyRunWorkItemType;
  const loadedGoalSnapshot = useMemo<GoalSnapshot | undefined>(
    () =>
      isGenericTaskEntity
        ? getGoalSnapshotFromWorkItem(loadedWorkItem)
        : undefined,
    [isGenericTaskEntity, loadedWorkItem],
  );
  const effectiveGoalSnapshot = goalSnapshot ?? loadedGoalSnapshot;
  const isGoalContextReady =
    !isGenericTaskEntity ||
    effectiveGoalSnapshot !== undefined ||
    isWorkItemFetched !== false;
  const fileReferenceScope = resolveFileReferenceScope(
    fileReferenceWorkItemType,
    entityId,
  );

  // userMessage is absent here — lifecycle merges the actual text into the
  // payload via sendUserMessage before the start-run hits the wire.
  const verifyFeature = readEntityConversationSessionConfig(
    agentSession.config,
  )?.verifyFeature;
  const payload = useMemo<
    | RunCreatePayloadEntityConversation
    | RunCreatePayloadGoalPm
    | RunCreatePayloadVerifyFeature
    | null
  >(
    () =>
      entityId
        ? verifyFeature
          ? {
              entity: buildRunEntityReference(EntityType.Task, entityId),
              promptType: "verify_feature",
              concern: verifyFeature.concern,
              parentAgentSessionId: verifyFeature.parentAgentSessionId,
              impactedEntities: verifyFeature.impactedEntities,
              userMessage: "",
            }
          : goalPm
            ? {
                entity: {
                  entityType: EntityType.Task,
                  entityId,
                  taskType: "GOAL" as const,
                  ...(effectiveGoalSnapshot
                    ? buildGoalEntityFields(effectiveGoalSnapshot)
                    : {}),
                },
                promptType: "goal_pm" as const,
                userMessage: "",
                activeConversationId: conversationId ?? "",
                conversationInventory: goalPm.conversationInventory,
              }
            : {
                entity: {
                  ...buildRunEntityReference(
                    legacyRunWorkItemType ? EntityType.Task : entityType,
                    entityId,
                  ),
                  ...(effectiveWorkItemType
                    ? { taskType: effectiveWorkItemType }
                    : {}),
                  ...(effectiveGoalSnapshot
                    ? buildGoalEntityFields(effectiveGoalSnapshot)
                    : {}),
                },
                promptType: "entity_conversation",
                userMessage: "",
              }
        : null,
    [
      conversationId,
      effectiveGoalSnapshot,
      entityId,
      entityType,
      goalPm,
      verifyFeature,
      effectiveWorkItemType,
      legacyRunWorkItemType,
      loadedWorkItemType,
    ],
  );

  const lifecycle = useAgentRunLifecycle({
    apiClient,
    // Gate the start-run dispatch on a populated entity. The entity-conversation
    // page resolves `entityId` from a second fetch (conversation → workflowAboutId)
    // that lands after `conversationId`, so an ungated mount-time auto-fire would
    // dispatch with `entity.entityId: ""`. Wait until the entity hydrates; the
    // effect re-runs once `enabled` flips and carries the correct payload.
    enabled: Boolean(entityId) && isGoalContextReady,
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    agentSessionStatus: agentSession.status,
    agentSessionConversationId: conversationId,
    machineId,
    context,
    contextMetadata,
    config: agentSession.config,
    // Entity conversations default to graph-only mode. When an explicit Service
    // was selected at launch, the durable session carries that repository-bound
    // context into the first turn and every later follow-up.
    ...(agentSession.serviceIds && agentSession.serviceIds.length > 0
      ? { serviceIds: agentSession.serviceIds }
      : {}),
    ...(agentSession.launchServiceId
      ? { launchServiceId: agentSession.launchServiceId }
      : {}),
    ...(runtimeSelection
      ? {
          provider: runtimeSelection.provider,
          model: runtimeSelection.model,
          ...(runtimeSelection.reasoningEffort
            ? { reasoningEffort: runtimeSelection.reasoningEffort }
            : {}),
          ...(supportsFastMode(
            runtimeSelection.provider,
            runtimeSelection.model,
          )
            ? { fastMode: runtimeSelection.fastMode ?? false }
            : {}),
        }
      : {}),
    ...(payload
      ? {
          arm: {
            kind: "handler" as const,
            promptType: verifyFeature
              ? LocalPromptType.VerifyFeature
              : goalPm
                ? LocalPromptType.GoalPm
                : LocalPromptType.EntityConversation,
            payload,
          },
        }
      : {}),
    launch,
    // Runless model: no run fires on open. The greeting is seeded as a real
    // SYSTEM row (below) and the run is materialized only by the user's first
    // reply, via the centralized sendUserMessage decision.
    deferInitialDispatch: true,
  });

  const { sendUserMessage } = lifecycle;
  const interactionAccess = useAgentSessionInteractionAccess(machineId);
  const postingRef = useRef(false);

  const methodActionContext = useMemo<MethodActionContext | null>(
    () =>
      lifecycle.runId && conversationId && machineId
        ? {
            organizationId,
            projectId,
            conversationId,
            agentSessionId: agentSession.id,
          }
        : null,
    [
      agentSession.id,
      machineId,
      conversationId,
      lifecycle.runId,
      organizationId,
      projectId,
    ],
  );

  const attachedAgent = !runtimeSelection
    ? undefined
    : lifecycle.hasSentInitialPrompt && lifecycle.runId && machineId
      ? {
          organizationId,
          projectId,
          agentSessionId: agentSession.id,
          runId: lifecycle.runId,
          machineId,
          provider: runtimeSelection.provider,
        }
      : machineId
        ? {
            organizationId,
            projectId,
            machineId,
            provider: runtimeSelection.provider,
            catalogContext: agentSession.launchServiceId
              ? {
                  policy: "service_workspace" as const,
                  serviceId: agentSession.launchServiceId,
                }
              : { policy: "non_repository" as const },
          }
        : undefined;

  const handleDirectTrigger = useCallback(
    async (message: CreateUserMessage): Promise<void> => {
      if (!conversationId || message.type !== MessageType.User) return;

      const parsed = parseRunConversationMessageSubmission(message);
      if (!parsed) return;

      if (parsed.kind === "startup_plan_review") {
        log.error(
          "dynamic_form",
          "Unexpected startup_plan_review in entity conversation",
        );
        return;
      }

      if (parsed.kind === "permission_request") return;

      if (parsed.kind === "method_action") {
        if (
          !lifecycle.runId ||
          !methodActionContext ||
          !interactionAccess.isDeviceEnabled
        )
          return;
        try {
          await onBeforeLocalExecution?.();
          await dispatchMethodAction(
            parsed.method,
            interactionAccess.interactions,
            lifecycle.runId,
            methodActionContext,
          );
        } catch (error) {
          log.error("dynamic_form", "Method action submission failed", {
            method: parsed.method,
            error,
          });
        }
        return;
      }

      if (!runtimeSelection) {
        throw new Error(
          "The model catalog has not loaded yet. Wait for the model choices before sending.",
        );
      }
      if (postingRef.current) return;
      postingRef.current = true;
      try {
        if (goalPm) onGoalPmRequestSubmitted?.(parsed.promptText);
        await onBeforeLocalExecution?.();
        const result = await sendUserMessage(
          parsed.promptText,
          parsed.skillSelection,
          parsed.attachments,
        );
        if (!result.ok) {
          throw new Error(result.error);
        }
      } finally {
        postingRef.current = false;
      }
    },
    [
      conversationId,
      lifecycle.runId,
      methodActionContext,
      interactionAccess,
      sendUserMessage,
      onBeforeLocalExecution,
      goalPm,
      onGoalPmRequestSubmitted,
      runtimeSelection,
    ],
  );

  // --- Eagerly ensure a conversation exists on open (no run, no start-run) ---
  const ensureConversation = useCallback(async (): Promise<void> => {
    const { conversation } = await createAgentSessionConversation({
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      body: {
        workflowType: goalPm
          ? WorkflowName.GoalPm
          : WorkflowName.AgentEntityConversation,
        workflowAboutType:
          getWorkflowAboutTypeForEntityType(
            legacyRunWorkItemType ? EntityType.Task : entityType,
          ) ?? entityType,
        workflowAboutId: entityId,
      },
    });
    setLocalConversationId(conversation.id);
  }, [
    createAgentSessionConversation,
    organizationId,
    projectId,
    agentSession.id,
    entityType,
    entityId,
    goalPm,
    legacyRunWorkItemType,
  ]);

  const convCreateFiredRef = useRef(false);
  useEffect(() => {
    if (!entityId || conversationId !== null || convCreateFiredRef.current)
      return;
    convCreateFiredRef.current = true;
    void ensureConversation().catch((err) => {
      log.error("general", "Entity conversation create failed", { error: err });
      convCreateFiredRef.current = false;
    });
  }, [entityId, conversationId, ensureConversation]);

  // --- Idempotently seed the opening greeting once the conversation exists ---
  // Seed only when the conversation has no messages yet, so reopening an
  // existing entity conversation (whose greeting and history are already
  // persisted) does not duplicate the greeting row. A still-fetching query
  // does not seed.
  const latestMessage = useLatestMessage(
    organizationId,
    projectId,
    conversationId ?? undefined,
    { enabled: conversationId !== null },
  );
  const {
    isFetched: latestIsFetched,
    data: latestData,
    markStale: markLatestMessageStale,
  } = latestMessage;

  const greetingSeededRef = useRef<string | null>(null);
  const initialMessageSentRef = useRef(false);
  const initialDeliveryInFlightRef = useRef(false);
  const [initialDeliveryError, setInitialDeliveryError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!conversationId) return;
    if (!isGoalContextReady) return;
    if (!latestIsFetched) return;
    if (initialDeliveryError || initialDeliveryInFlightRef.current) return;
    if (
      greetingSeededRef.current === conversationId &&
      (!initialUserMessage || initialMessageSentRef.current)
    )
      return;
    initialDeliveryInFlightRef.current = true;
    void (async () => {
      if (latestData === null && greetingSeededRef.current !== conversationId) {
        await seedConversationGreeting({
          apiClient,
          organizationId,
          projectId,
          conversationId,
          text: buildEntityGreetingText(entityName, entitySummary),
        });
        markLatestMessageStale();
      }
      greetingSeededRef.current = conversationId;
      // The retained message goes out once the CLI's catalog has named what to
      // launch with; the effect runs again when `runtimeSelection` arrives.
      if (
        initialUserMessage &&
        !initialMessageSentRef.current &&
        runtimeSelection
      ) {
        if (goalPm) onGoalPmRequestSubmitted?.(initialUserMessage);
        await onBeforeLocalExecution?.();
        const result = await sendUserMessage(initialUserMessage);
        if (!result.ok) throw new Error(result.error);
        initialMessageSentRef.current = true;
        onInitialUserMessageSent?.();
      }
    })()
      .catch((err) => {
        log.error("general", "Entity conversation initial message failed", {
          error: err,
        });
        setInitialDeliveryError(
          getErrorMessage(err, "Unable to send the first message."),
        );
      })
      .finally(() => {
        initialDeliveryInFlightRef.current = false;
      });
  }, [
    conversationId,
    latestIsFetched,
    latestData,
    markLatestMessageStale,
    organizationId,
    projectId,
    entityName,
    entitySummary,
    initialUserMessage,
    initialDeliveryError,
    onInitialUserMessageSent,
    isGoalContextReady,
    goalPm,
    onGoalPmRequestSubmitted,
    sendUserMessage,
    onBeforeLocalExecution,
    runtimeSelection,
  ]);

  if (initialDeliveryError) {
    return (
      <Stack spacing={1}>
        {actionsSlot}
        <SessionErrorAlert error={initialDeliveryError} />
        <Button
          data-testid="session-error-retry"
          onClick={() => setInitialDeliveryError(null)}
        >
          Retry first message
        </Button>
      </Stack>
    );
  }

  if (isGenericTaskEntity && workItemError) {
    return (
      <SessionErrorAlert
        error={getErrorMessage(
          workItemError,
          "Unable to load the current work item context.",
        )}
        onRetry={() => {
          void refetchWorkItem();
        }}
      />
    );
  }

  if (lifecycle.error) {
    return (
      <Stack spacing={2}>
        <SessionErrorAlert
          error={lifecycle.error}
          errorCode={lifecycle.errorCode}
          onRetry={lifecycle.retryInit}
        />
        <LocalRuntimeUnavailableAlert error={lifecycle.error} />
      </Stack>
    );
  }

  // The conversation is created eagerly on open; until it exists there is no
  // real conversation to render against. The window is brief (a single create
  // round-trip), so show a spinner rather than a synthetic placeholder tree.
  if (!conversationId) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <>
      {lifecycle.runId && runtimeSelection ? (
        <SessionContextUsageCapsules
          providerSessionId={latestProviderSessionId}
          provider={runtimeSelection.provider}
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSession.id}
          conversationId={conversationId}
          runId={lifecycle.runId}
          contextTokens={contextSize?.totalTokens}
          contextWindowTokens={contextSize?.maxTokens}
        />
      ) : null}
      <AgentConversationView
        organizationId={organizationId}
        projectId={projectId}
        agentSessionId={agentSession.id}
        conversationId={conversationId}
        submittingPrompt={!isGoalContextReady}
        onDirectTrigger={handleDirectTrigger}
        onCreateNewConversation={onCreateNewConversation}
        initialDraft={initialDraft}
        confirmBeforeNewConversation={confirmBeforeNewConversation}
        onStopRun={lifecycle.stopRun}
        stoppingRun={lifecycle.stoppingRun}
        scrollable={scrollable}
        scrollPolicy={scrollPolicy}
        agentSessionMetadata={resolveAgentSessionMetadata(agentSession)}
        newConversationModelSelector={newConversationModelSelector}
        actionsSlot={actionsSlot}
        fileReferenceScope={fileReferenceScope ?? undefined}
        attachedAgent={attachedAgent}
        onGoalPmAction={onGoalPmAction}
        goalPmConversationLink={goalPmConversationLink}
      />
    </>
  );
};

export const EntityConversationChat: React.FC<EntityConversationChatProps> = ({
  organizationId,
  projectId,
  agentSession,
  entityId,
  entityType,
  scrollable = false,
  scrollPolicy,
  entityName,
  entitySummary,
  goalSnapshot,
  runtimeSelection: runtimeSelectionProp,
  machineId: machineIdProp,
  initialUserMessage,
  onInitialUserMessageSent,
  initialDraft,
  onCreateNewConversation,
  confirmBeforeNewConversation = false,
  onBeforeLocalExecution,
  newConversationModelSelector,
  actionsSlot,
  onConversationReady,
  goalPm,
  onGoalPmAction,
  goalPmConversationLink,
  onGoalPmRequestSubmitted,
}) => {
  // Keep older embedded callers safe while they migrate to the explicit
  // caller-owned boundary. New launch surfaces pass both values; the fallback
  // only uses the session's durable configuration and never substitutes a
  // different machine.
  const runtimeSelection =
    runtimeSelectionProp === undefined
      ? resolveEntityConversationRuntimeSelection(
          agentSession,
          readSurfaceSelection(DISCUSS_SURFACE_ID),
        )
      : runtimeSelectionProp;
  const machineId = machineIdProp ?? agentSession.machineId ?? "";
  const launch = useLaunchRunOrchestration({
    organizationId,
    apiClient,
    projectId,
    agentSessionId: agentSession.id,
    ...(agentSession.conversationId
      ? { conversationId: agentSession.conversationId }
      : {}),
  });

  return (
    <Box
      data-testid="entity-conversation-chat"
      sx={{
        minHeight: 400,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
        ...(scrollable
          ? {
              display: "flex",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }
          : {}),
      }}
    >
      <EntityConversationActive
        organizationId={organizationId}
        projectId={projectId}
        agentSession={agentSession}
        entityId={entityId}
        entityType={entityType}
        scrollable={scrollable}
        scrollPolicy={scrollPolicy}
        entityName={entityName}
        entitySummary={entitySummary}
        goalSnapshot={goalSnapshot}
        runtimeSelection={runtimeSelection}
        machineId={machineId}
        initialUserMessage={initialUserMessage}
        onInitialUserMessageSent={onInitialUserMessageSent}
        initialDraft={initialDraft}
        launch={launch}
        onCreateNewConversation={onCreateNewConversation}
        confirmBeforeNewConversation={confirmBeforeNewConversation}
        onBeforeLocalExecution={onBeforeLocalExecution}
        newConversationModelSelector={newConversationModelSelector}
        actionsSlot={actionsSlot}
        onConversationReady={onConversationReady}
        goalPm={goalPm}
        onGoalPmAction={onGoalPmAction}
        goalPmConversationLink={goalPmConversationLink}
        onGoalPmRequestSubmitted={onGoalPmRequestSubmitted}
      />
    </Box>
  );
};
