import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import type { RunAttachmentReference } from "../../api";
import CodeIcon from "@mui/icons-material/Code";
import CommitIcon from "@mui/icons-material/Commit";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Box, Alert, Button, Stack } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SessionMethodSelection } from "../../agents/prompts";
import {
  AgentSessionConfigV1TypeEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionStatus,
  type AgentSkillSelection,
  EdgeSource,
  EntityType,
  MessageType,
  RelationshipValue,
  WorkflowName,
  type AgentSessionConfig,
  type AgentSessionDto,
  type ContextRelatedEntityDto,
  type InitiativeResponseDto,
  type LocalPromptPlanInput,
  type RunContextMetadata,
} from "../../api/index";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useFullEntityContext } from "../../data/hooks/useFullEntityContext";
import { usePathService } from "../../contexts";
import { apiClient } from "../../clients/client";
import { LocalPromptType } from "../../api";
import { CapsuleAction } from "../ActionsCapsule/CapsuleAction";
import { CodeReviewIcon } from "../ActionsCapsule/CodeReviewIcon";
import { AgentConversationView } from "./AgentConversationView";
import { VerificationRuntimeContext } from "../Conversation/SecondaryActions/verificationRuntimeContext";
import type { ConversationScrollPolicy } from "../Conversation/ConversationViewer";
import { useLatestProviderSessionId } from "./RunContextUsageCapsules";
import { SessionContextUsageCapsules } from "./SessionContextUsageCapsules";
import { useSessionContextSize } from "../../data/hooks/useSessionContextSize";
import { resolveFileReferenceScope } from "../SmarterTextAreaCard/fileReferences/types";
import { resolvePromptModelSelection } from "./promptModelSelection";
import { useRuntimeModelCatalog } from "./useRuntimeModelCatalog";
import { supportsFastMode } from "./capabilityCatalog";
import { isLocalRuntimeUnavailable } from "./agenticRuntimeUtils";
import { resolveAgentSessionMetadata } from "./resolveAgentSessionMetadata";
import { useServices } from "../../data/hooks/useServices";
import { OpenBrowserCapsuleAction } from "./OpenBrowserCapsuleAction";
import { RunBrowserProvider } from "./runtime/RunBrowserContext";
import { CollatedFileDiffModalContainer } from "./CollatedFileDiffModal/CollatedFileDiffModalContainer";
import {
  FollowupActionModal,
  type FollowupActionSubmission,
} from "./FollowupActionModal";
import { LoadingPanel } from "./LoadingPanel";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { resolveCodingSessionWorkflowType } from "../../agents/coordination/sessionMethodWorkflow";
import { useAgentBridgeTelemetry } from "./runtime/coding/agent-bridge-telemetry";
import {
  logError,
  toErrorMessage,
  toPendingTaskContext,
  type FollowupSubmissionAction,
  type StepContext,
} from "./runtime/coding/agent-session-helpers";
import { buildTaskRunContextMetadata } from "./runtime/coding/build-task-run-context-metadata";
import type { StartRunLaunchContext } from "../../agents/coordination/sessionMethodRegistry";
import { resolveStartRunPrompt } from "./runtime/coding/resolveStartRunPrompt";
import { type SubmitPromptResult } from "./runtime/hooks/usePromptRunSubmission";
import type {
  AgentProvider,
  ReasoningEffort,
  StartupPlanSubmission,
} from "./runtime/index";
import { SessionErrorAlert } from "./SessionErrorAlert";
import { TaskPreviewCard } from "./TaskPreviewCard";
import { useAgentRunLifecycle, type RunLauncher } from "./useAgentRunLifecycle";
import {
  useLaunchRunOrchestration,
  type StartRunWorktree,
} from "./useLaunchRunOrchestration";
import { useSubmitCodeReviewPrompt } from "./useSubmitCodeReviewPrompt";
import { useSubmitCommitPrompt } from "./useSubmitCommitPrompt";
import { useSubmitFollowupByText } from "./useSubmitFollowupByText";
import type { AgentSessionInteractionAccess } from "./operations/AgentOperationCoordinator";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";
import { requestSessionMessageInteraction } from "./operations/AgentOperationProvider";
import { useAutoAdvanceFeatureSyncIterate } from "./useAutoAdvanceFeatureSyncIterate";
import {
  CODE_REVIEW_SURFACE_ID,
  COMMIT_SURFACE_ID,
} from "./surfaceSelectionMemory";
import {
  useRemoteChangedFilesCount,
  type RemoteChangedFilesCountState,
} from "./runtime/hooks/useRemoteChangedFilesCount";
import type { UnavailableOutcome } from "./codingSessionFeedback";
import { useRemoteChangedFilesInventory } from "./runtime/hooks/useRemoteChangedFilesInventory";
import { useTurnCompletionRevision } from "./runtime/hooks/useTurnCompletionRevision";
import { useAgentSessionCurrentState } from "../../data/hooks/useAgentSessionCurrentState";

type CodingSessionStickyTop =
  | number
  | string
  | Array<number | string | null>
  | Partial<Record<"xs" | "sm" | "md" | "lg" | "xl", number | string | null>>;

const readCodingSessionMethod = (
  config: AgentSessionConfig | null | undefined,
) =>
  config?.type === AgentSessionConfigV1TypeEnum.CodingSessionV1 ||
  config?.type === AgentSessionConfigV2TypeEnum.CodingSession
    ? config.method
    : undefined;

const readCodingSessionProjectModeSelection = (
  config: AgentSessionConfig | null | undefined,
) =>
  config?.type === AgentSessionConfigV2TypeEnum.CodingSession
    ? config.projectModeSelection
    : undefined;

type ChangedFilesActionState =
  | { kind: "available"; count: number }
  | {
      kind: "unavailable-with-reason";
      feedback: Extract<UnavailableOutcome, { presentationScope: "action" }>;
    };

const resolveChangedFilesActionState = (
  state: RemoteChangedFilesCountState,
  retry: () => void,
): ChangedFilesActionState | null => {
  if (state.status === "success" && state.count > 0) {
    return { kind: "available", count: state.count };
  }
  if (state.status === "loading" && state.previousFailure) {
    return {
      kind: "unavailable-with-reason",
      feedback: {
        status: "unavailable",
        presentationScope: "action",
        reason: state.previousFailure.reason,
        errorCode: state.previousFailure.errorCode,
        retryable: state.previousFailure.retryable,
        failureIdentity: state.previousFailure.failureIdentity,
        retry,
        isRetrying: true,
      },
    };
  }
  if (state.status === "unavailable") {
    return {
      kind: "unavailable-with-reason",
      feedback: {
        status: "unavailable",
        presentationScope: "action",
        reason: state.error,
        errorCode: state.errorCode,
        retryable: state.retryable,
        failureIdentity: state.failureIdentity,
        retry,
        isRetrying: false,
      },
    };
  }
  return null;
};

const codingSessionConversationRegionSx = (theme: Theme) => ({
  width: "100%",
  [theme.breakpoints.down("md")]: {
    pt: theme.spacing(2),
  },
});

const resolveCommitBlockedReason = (
  interactionAccess: AgentSessionInteractionAccess,
  changedFiles: RemoteChangedFilesCountState,
): string | null => {
  if (!interactionAccess.isDeviceEnabled) {
    return interactionAccess.unavailable.message;
  }

  if (changedFiles.status === "success") {
    return changedFiles.count === 0
      ? "There are no changed files available to commit."
      : null;
  }

  if (changedFiles.status === "unavailable") {
    return changedFiles.error;
  }

  return "Changed files are still being checked. Please wait before committing.";
};

type FollowupActionName = "review" | "commit";

interface ActionFailureState {
  readonly action: FollowupActionName;
  readonly submission: FollowupActionSubmission;
  readonly reason: string;
  readonly retryable: boolean;
  readonly failureIdentity: { readonly reason: string };
  readonly isRetrying: boolean;
}

type FollowupActionSubmitter = (
  submission: FollowupActionSubmission,
) => Promise<void>;

export interface AgentSessionLaunchOrchestration extends RunLauncher {
  submitStartupPlanReview: (
    runId: string,
    submission: StartupPlanSubmission,
    promptText: string,
    userMessageData: Record<string, unknown>,
    localPromptType: LocalPromptType,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitNodeDecision: (
    runId: string,
    action: string,
    userMessageData: Record<string, unknown>,
    comment?: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

interface CodingSessionProps {
  organizationId: string;
  agentSession: AgentSessionDto;
  projectId: string;
  launchPlanId: string | null;
  launchStepId: string | null;
  launchStageId: string | null;
  taskData: WorkItemResponseDto | null;
  planData: LocalPromptPlanInput | null;
  initiativeData: InitiativeResponseDto | null;
  provider: AgentProvider;
  /**
   * The service the CLI launches this session against — equivalent to the
   * platform's `launchServiceId`. Kept named `serviceId` for backward
   * compatibility with existing UI consumers. Used as the primary repo on the
   * run dispatch envelope. The full multi-service set rides alongside in
   * `agentSession.serviceIds` and
   * is threaded onto the start-run payload's `serviceIds` field.
   */
  serviceId?: string;
  /**
   * The conversation's durable workflow identity, threaded from the consumer so
   * node decisions (e.g. plan approval) survive a page reload. Takes precedence
   * over the launch-time method when present. See {@link resolveCodingSessionWorkflowType}.
   */
  workflowName?: WorkflowName;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  /**
   * Target CLI machine id. Routed onto the start-run request so the platform
   * dispatches to the correct CLI when the user has multiple machines connected.
   * Omit for single-machine setups.
   */
  machineId?: string;
  /**
   * Launch kickoff carried over from the wizard's Submit Prompt click in
   * step 3. A string (possibly empty) means the parent is asking us to
   * auto-dispatch the start-run once; `null` means no auto-dispatch (page
   * reload or otherwise no fresh user submit). The single auto-dispatch is
   * the sole moment a coding session's run is materialized.
   */
  initialPromptDraft?: string | null;
  initialPromptAttachments?: RunAttachmentReference[];
  onInitialPromptAccepted?: () => void;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Scroll owner supplied by the embedding page. */
  scrollPolicy?: ConversationScrollPolicy;
  /** Responsive top inset for the task context's sticky shell. */
  taskContextStickyTop?: CodingSessionStickyTop;
}

interface CodingSessionActiveProps extends CodingSessionProps {
  launch: AgentSessionLaunchOrchestration;
  conversationId: string;
  /**
   * The resolved durable workflow identity (conversation `workflowName`,
   * falling back to the launch-time `sessionMethod`). Survives a reload that
   * drops the query params; gates the FeatureSync auto-advance.
   */
  nodeDecisionWorkflowName?: WorkflowName;
}

const TaskMonitorNavigationContent = ({
  projectId,
  monitors,
}: {
  projectId: string;
  monitors: readonly ContextRelatedEntityDto[];
}) => {
  const navigate = useNavigate();
  const pathService = usePathService();

  return (
    <Stack spacing={1} data-testid="coding-session-task-monitor-navigation">
      <Alert severity="info">
        Select a Task Monitor to return to its canonical work-item surface.
      </Alert>
      {monitors.map((monitor) => (
        <Button
          key={monitor.entityId}
          variant="outlined"
          onClick={() =>
            navigate(
              pathService.task({
                projectId,
                taskId: monitor.entityId,
              }),
            )
          }
          data-testid={`coding-session-task-monitor-${monitor.entityId}`}
        >
          Open {monitor.displayName}
        </Button>
      ))}
    </Stack>
  );
};

const CodingSessionActive = memo(
  ({
    organizationId,
    projectId,
    agentSession,
    serviceId,
    provider,
    launchPlanId,
    launchStepId,
    launchStageId,
    taskData,
    initiativeData: _initiativeData,
    model,
    reasoningEffort,
    fastMode,
    machineId,
    launch,
    conversationId,
    nodeDecisionWorkflowName,
    initialPromptDraft = null,
    initialPromptAttachments,
    onInitialPromptAccepted,
    onCreateNewConversation,
    scrollPolicy,
    taskContextStickyTop = 0,
  }: CodingSessionActiveProps) => {
    const agentSessionId = agentSession.id;
    const latestProviderSessionId = useLatestProviderSessionId(
      organizationId,
      projectId,
      conversationId,
    );
    const contextSize = useSessionContextSize({
      organizationId,
      projectId,
      agentSessionId,
      seed: agentSession.contextSize,
      latestProviderSessionId,
    });
    const taskContext = useFullEntityContext({
      organizationId,
      projectId,
      entityType: EntityType.Task,
      entityId: taskData?.id ?? "",
      enabled: Boolean(taskData),
      includeRelatedEntities: true,
      includeFeatureHierarchy: false,
      includeProposals: false,
      includeAvailableMcpTools: false,
    });
    const taskMonitorMatches = useMemo<ContextRelatedEntityDto[]>(
      () =>
        (taskContext.data?.relatedEntities ?? []).filter(
          (relatedEntity) =>
            relatedEntity.entityType === EntityType.Task &&
            relatedEntity.taskType === "TASK_MONITOR" &&
            relatedEntity.source === EdgeSource.Agent &&
            relatedEntity.relationship === RelationshipValue.RelatedTo,
        ),
      [taskContext.data?.relatedEntities],
    );
    const taskMonitorMenuItems = useMemo(
      () =>
        taskMonitorMatches.map((monitor) => ({
          id: monitor.entityId,
          label: monitor.displayName,
        })),
      [taskMonitorMatches],
    );
    const renderTaskMonitorNavigation = useCallback(
      () => (
        <TaskMonitorNavigationContent
          projectId={projectId}
          monitors={taskMonitorMatches}
        />
      ),
      [projectId, taskMonitorMatches],
    );

    // Launch-time provider / model / reasoning-effort. The wizard's step 3
    // owns the editable model selector now; this surface only consumes the
    // resolved seed for the dispatch envelope, so we read once from the
    // persisted coding-session selection (falling back to the launch-time
    // props / catalog default).
    // The remembered choice and the catalog default come from the CLI on the
    // session's machine, so the seed is resolved again once that catalog loads.
    const seedMachineId = machineId ?? agentSession.machineId ?? null;
    const seedCatalogState = useRuntimeModelCatalog(
      seedMachineId
        ? { organizationId, projectId, machineId: seedMachineId }
        : null,
    );
    const seedCatalogReady = seedCatalogState.status === "ready";
    const initialPromptSelection = useMemo(
      () =>
        resolvePromptModelSelection(provider, model, reasoningEffort, fastMode),
      // Launch-time inputs, seeded on mount and again when the catalog loads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [seedCatalogReady],
    );
    const localProvider: AgentProvider = provider;
    const localModel: string | undefined = initialPromptSelection.model;
    const localReasoningEffort: ReasoningEffort | undefined =
      initialPromptSelection.reasoningEffort;
    const localFastMode = initialPromptSelection.fastMode;

    const [promptDraft, setPromptDraft] = useState<string>(
      initialPromptDraft ?? "",
    );
    const [submittingPrompt, setSubmittingPrompt] = useState(false);
    const [submittingInitialPrompt, setSubmittingInitialPrompt] =
      useState(false);
    const [submittingFollowupAction, setSubmittingFollowupAction] =
      useState<FollowupSubmissionAction | null>(null);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [initialPromptRetryCount, setInitialPromptRetryCount] = useState(0);
    const [actionFailure, setActionFailure] =
      useState<ActionFailureState | null>(null);
    const actionFailureGenerationRef = useRef(0);
    const [diffModalOpen, setDiffModalOpen] = useState(false);
    const [reviewModalOpen, setReviewModalOpen, reviewModalOpenOwnerKey] =
      useModalState(false);
    const [commitModalOpen, setCommitModalOpen, commitModalOpenOwnerKey] =
      useModalState(false);
    const stepContext = useMemo<StepContext>(
      () => ({
        projectId,
        taskId: taskData?.id ?? null,
        ...(taskData?.name ? { taskName: taskData.name } : {}),
        ...(launchPlanId ? { planId: launchPlanId } : {}),
        ...(launchStepId ? { stepId: launchStepId } : {}),
      }),
      [projectId, taskData?.id, taskData?.name, launchPlanId, launchStepId],
    );

    const context = useMemo(
      () => toPendingTaskContext(stepContext, agentSessionId),
      [stepContext, agentSessionId],
    );

    const [contextMetadataError, setContextMetadataError] = useState<
      string | null
    >(null);
    const contextMetadata = useMemo<RunContextMetadata>(() => {
      if (taskData) {
        try {
          const built = buildTaskRunContextMetadata({
            organizationId,
            projectId,
            agentSessionId,
            task: taskData,
            launchPlanId: launchPlanId ?? undefined,
            launchStepId: launchStepId ?? undefined,
            launchStageId: launchStageId ?? undefined,
          });
          return built;
        } catch (err) {
          logError("contextMetadata: buildTaskRunContextMetadata threw", err);
          setContextMetadataError(
            toErrorMessage(err, "Failed to build run context."),
          );
        }
      }
      return {
        capturedAt: new Date().toISOString(),
        organizationId,
        projectId,
        agentSessionId,
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      };
    }, [
      taskData,
      organizationId,
      projectId,
      agentSessionId,
      launchPlanId,
      launchStepId,
      launchStageId,
    ]);

    const telemetry = useAgentBridgeTelemetry();

    // The agent session persists the full multi-service selection; the launch
    // service id arrives as the legacy `serviceId` prop. Fall back to the
    // launch service if the session record has no `serviceIds` yet (e.g.
    // sessions persisted before the contract widened).
    const sessionServiceIds = useMemo<string[]>(() => {
      const recorded = agentSession.serviceIds ?? [];
      if (recorded.length > 0) return recorded;
      return serviceId ? [serviceId] : [];
    }, [agentSession.serviceIds, serviceId]);

    // The wizard-selected launch method or project-mode identity is persisted on
    // AgentSession.config so it survives reload/deep-link. Rebuild the
    // discriminated session-method selection from the persisted config plus the
    // session's serviceIds and the embedded service summary (best-effort name
    // resolution for the launch service).
    const persistedSessionMethod = readCodingSessionMethod(agentSession.config);
    const persistedProjectModeSelection = readCodingSessionProjectModeSelection(
      agentSession.config,
    );
    const sessionMethodSelection = useMemo<
      SessionMethodSelection | undefined
    >(() => {
      const services = agentSession.service
        ? [
            {
              id: agentSession.service.id,
              name: agentSession.service.name ?? agentSession.service.id,
            },
          ]
        : sessionServiceIds.map((id) => ({ id, name: id }));

      if (persistedProjectModeSelection) {
        return {
          method: undefined,
          projectModeSelection: persistedProjectModeSelection,
          serviceIds: sessionServiceIds,
          services,
        };
      }

      const method = persistedSessionMethod;
      if (!method) return undefined;
      return {
        method,
        serviceIds: sessionServiceIds,
        services,
      };
    }, [
      persistedProjectModeSelection,
      persistedSessionMethod,
      agentSession.service,
      sessionServiceIds,
    ]);

    // V2 launch-context fields are surfaced from the session here, alongside
    // the `method` read above. Wizard-driven launches take precedence over the
    // launch-time props because `config` carries the user's most recent
    // selection (a wizard re-launch from another tab/device will land in
    // `config` before the props refetch). First-class agentSession
    // model/reasoningEffort (when surfaced server-side) remain authoritative
    // for non-wizard launches and as the V1-row upgrade source.
    const codingSessionConfig =
      agentSession.config?.type === AgentSessionConfigV2TypeEnum.CodingSession
        ? agentSession.config
        : undefined;
    const configV2 =
      codingSessionConfig?.version === "v2" ? codingSessionConfig : undefined;
    const effortFromConfig = ((): ReasoningEffort | undefined => {
      const e = codingSessionConfig?.effort;
      if (
        e === "low" ||
        e === "medium" ||
        e === "high" ||
        e === "xhigh" ||
        e === "max"
      ) {
        return e;
      }
      return undefined;
    })();
    const effectiveModel = codingSessionConfig?.model ?? localModel;
    const effectiveReasoningEffort = effortFromConfig ?? localReasoningEffort;
    const fastModeFromConfig =
      configV2 &&
      "fastMode" in configV2 &&
      typeof configV2.fastMode === "boolean"
        ? configV2.fastMode
        : undefined;
    const effectiveFastMode =
      effectiveModel && supportsFastMode(localProvider, effectiveModel)
        ? (fastModeFromConfig ?? localFastMode ?? false)
        : undefined;
    const metadataServices = useServices(agentSession.organizationId, {
      projectId: agentSession.projectId,
      enabled: (agentSession.serviceIds?.length ?? 0) > 0,
    });
    const sessionMetadata = resolveAgentSessionMetadata(
      agentSession,
      metadataServices.services,
    );
    const launchWorktree = useMemo<StartRunWorktree | undefined>(() => {
      const branch = configV2?.worktree?.trim();
      if (!branch) return undefined;
      return { enabled: true, branch };
    }, [configV2?.worktree]);

    // The Run's focal identity is the TASK entity reference built from the
    // task id; the work item's type is never inspected here, so a
    // project-defined type launches exactly like a built-in one.
    const launchTaskId = taskData?.id;
    const launchContext = useMemo<StartRunLaunchContext | null>(
      () =>
        launchTaskId
          ? { taskId: launchTaskId, sessionMethod: sessionMethodSelection }
          : null,
      [launchTaskId, sessionMethodSelection],
    );

    // Route the start-run promptType and payload by the session's method, so the
    // envelope discriminator and the in-payload promptType are emitted together
    // from one place and can never drift apart.
    const { startRunPrompt, startRunPromptError } = useMemo(() => {
      if (!launchContext) {
        return {
          startRunPrompt: null,
          startRunPromptError: null as string | null,
        };
      }
      try {
        return {
          startRunPrompt: resolveStartRunPrompt({
            launch: launchContext,
            launchPlanId,
            launchStepId,
            launchStageId,
            userMessage: promptDraft,
            config: agentSession.config,
          }),
          startRunPromptError: null as string | null,
        };
      } catch (err) {
        return {
          startRunPrompt: null,
          startRunPromptError: toErrorMessage(
            err,
            "Cannot resolve the coding session launch configuration.",
          ),
        };
      }
    }, [
      launchContext,
      launchPlanId,
      promptDraft,
      launchStepId,
      launchStageId,
      agentSession.config,
    ]);

    // A coding launch uses one of two start-run arms, picked by the registry
    // row for the session's method. Both carry the kickoff: the turn-firing
    // arm rides `payload.userMessage` for the CLI to dispatch turn one
    // against; the workflow arm rides a `workflow_kickoff` payload the API
    // uses to author the USER opening row and the CLI uses to materialize the
    // scoped Run. Both arms are driven by the wizard's Submit Prompt click in
    // step 3 (see auto-dispatch effect below).
    const lifecycle = useAgentRunLifecycle({
      apiClient,
      machineId,
      enabled: true,
      organizationId,
      projectId,
      agentSessionId,
      agentSessionStatus: agentSession.status,
      agentSessionConversationId: agentSession.conversationId,
      context,
      contextMetadata,
      serviceIds: sessionServiceIds,
      ...(serviceId ? { launchServiceId: serviceId } : {}),
      provider: localProvider,
      launch,
      config: agentSession.config,
      // Resolver output flows through verbatim — both arms (`handler`,
      // `workflow`) carry their payload, and the discriminated `arm` type
      // on the lifecycle prevents constructing a malformed combination at
      // compile time. While `startRunPrompt` is null (the task not yet
      // loaded) the arm is simply omitted; the auto-dispatch effect won't
      // fire until conversationId/runId are also ready, by which time the
      // arm has resolved.
      ...(startRunPrompt ? { arm: startRunPrompt } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(effectiveReasoningEffort
        ? { reasoningEffort: effectiveReasoningEffort }
        : {}),
      ...(effectiveFastMode !== undefined
        ? { fastMode: effectiveFastMode }
        : {}),
      deferInitialDispatch: true,
      ...(machineId ? { machineId } : {}),
      ...(launchWorktree ? { worktree: launchWorktree } : {}),
    });

    const runId = lifecycle.runId;
    const sessionMachineId = agentSession.machineId ?? null;
    const runBrowserContext = useMemo(
      () => ({ runId, sessionMachineId }),
      [runId, sessionMachineId],
    );
    const attachedAgent =
      runId && machineId
        ? {
            organizationId,
            projectId,
            agentSessionId,
            runId,
            machineId,
            provider,
          }
        : undefined;
    const interactionAccess = useAgentSessionInteractionAccess(machineId);
    // Follow-up runs go to the machine this session runs on, so its CLI
    // decides which models they offer.
    const followupMachineId = machineId ?? sessionMachineId;
    const followupCatalogSource = followupMachineId
      ? { organizationId, projectId, machineId: followupMachineId }
      : null;
    // The run lives on the CLI host keyed by the agent session id. Provider
    // identity is the bound provider session id (falling back to the session id
    // before the bind round-trips).
    const providerRunId = agentSession.agentSessionId ?? agentSession.id;
    const hasSentInitialPrompt = lifecycle.hasSentInitialPrompt;
    const { dispatchStartRunWithMessage, markInitialPromptSent, retryInit } =
      lifecycle;

    const trackSubmitPromptTelemetry = useCallback(
      (result: SubmitPromptResult): void => {
        telemetry.trackSubmitPromptTelemetry(result.telemetry);
      },
      [telemetry],
    );

    const submitFollowupByText = useSubmitFollowupByText({
      runId,
      providerRunId,
      provider,
      setSubmissionError,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
      sessionMethod: sessionMethodSelection,
      interactionAccess,
      organizationId,
      agentSessionId,
      conversationId,
      projectId,
      trackSubmitPromptTelemetry,
      setPromptDraft,
    });
    const handleSubmitReply = useCallback(
      async (
        text: string,
        skillSelection?: AgentSkillSelection,
        attachments: RunAttachmentReference[] = [],
      ): Promise<void> => {
        await submitFollowupByText({
          promptText: text,
          skillSelection,
          attachments,
          clearDraftOnSuccess: false,
          actionName: "submitFollowupPrompt",
          followupAction: null,
        });
      },
      [submitFollowupByText],
    );
    const handleSubmitMessageAgent = useCallback(
      async (
        intent: import("../SmarterTextAreaCard/slashCommands/messageAgentCommand").MessageAgentCommandIntent,
        interactionId: string,
      ): Promise<void> => {
        if (!runId)
          throw new Error(
            "Start this Agent Session before messaging another agent.",
          );
        await requestSessionMessageInteraction({
          organizationId,
          projectId,
          agentSessionId,
          interactionId,
          intent,
        });
      },
      [organizationId, projectId, agentSessionId, runId],
    );
    const submitCodeReviewPrompt = useSubmitCodeReviewPrompt({
      runId,
      providerRunId,
      provider,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
      organizationId,
      projectId,
      conversationId,
      agentSessionId,
      trackSubmitPromptTelemetry,
      interactionAccess,
    });

    const submitCommitPrompt = useSubmitCommitPrompt({
      runId,
      providerRunId,
      provider,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
      agentSessionId,
      conversationId,
      projectId,
      organizationId,
      trackSubmitPromptTelemetry,
      interactionAccess,
    });

    const runFollowupAction = useCallback(
      async (
        action: FollowupActionName,
        submission: FollowupActionSubmission,
        submit: FollowupActionSubmitter,
        blockedReason: string | null = null,
      ): Promise<void> => {
        setActionFailure((current) =>
          current?.action === action ? { ...current, isRetrying: true } : null,
        );
        try {
          if (blockedReason !== null) {
            throw new Error(blockedReason);
          }
          await submit(submission);
          setActionFailure((current) =>
            current?.action === action ? null : current,
          );
        } catch (error) {
          const generation = ++actionFailureGenerationRef.current;
          const reason = toErrorMessage(
            error,
            action === "review"
              ? "Code review could not be submitted."
              : "Commit could not be submitted.",
          );
          setActionFailure({
            action,
            submission,
            reason,
            retryable: true,
            failureIdentity: {
              reason: `${action}:${String(generation)}`,
            },
            isRetrying: false,
          });
        }
      },
      [],
    );

    const handleProposalsAccepted = useAutoAdvanceFeatureSyncIterate({
      organizationId,
      projectId,
      agentSessionId,
      conversationId: agentSession.conversationId ?? null,
      runId,
      machineId: machineId ?? null,
      ...(nodeDecisionWorkflowName
        ? { workflowName: nodeDecisionWorkflowName }
        : {}),
    });

    const initialPromptInFlight =
      submittingInitialPrompt && !hasSentInitialPrompt;
    // Auto-dispatch on mount. Fires once when the wizard's Submit Prompt
    // click has handed us an `initialPromptDraft` (string, possibly empty).
    // On reload there is no fresh `initialPromptDraft`, so this effect is a
    // no-op and the existing IN_PROGRESS handling kicks in.
    //
    // One write for both arms: fire `dispatchStartRun` with a USER
    // `initialMessage` role marker. The kickoff text already rides in
    // `payload.userMessage` (turn-firing arm) or in a `workflow_kickoff`
    // payload (workflow arm) — both set on the lifecycle config above. The
    // API authors the USER opening row from `payload.userMessage` and
    // dispatches turn one for the turn-firing arm, or signals the workflow
    // for the workflow arm (after stripping the kickoff payload before
    // signing). Per requirement 342f4f67 on CLI Run Input Dispatch.
    const autoDispatchedRef = useRef(false);
    const lastObservedMachineIdRef = useRef(machineId);

    // A machine target can arrive after the active view mounts while the
    // paired-machine collection finishes loading. A failed attempt stays
    // terminal for the current target, but a newly resolved target may retry
    // the deferred launch once.
    useEffect(() => {
      if (lastObservedMachineIdRef.current !== machineId) {
        autoDispatchedRef.current = false;
        setSubmissionError(null);
        lastObservedMachineIdRef.current = machineId;
      }
    }, [machineId]);

    useEffect(() => {
      if (autoDispatchedRef.current) return;
      if (initialPromptDraft === null) return;
      if (hasSentInitialPrompt) return;
      if (startRunPromptError) return;
      if (!agentSession.conversationId) return;
      if (!runId) return;
      // Capture the prop after the null-guard so the async closure carries the
      // narrowed string through — the kickoff text is single-sourced from the
      // prop the wizard handed us, not from local `promptDraft` state which
      // may still be the initial-mount empty string when this prop arrives
      // post-mount.
      const kickoffText = initialPromptDraft;
      autoDispatchedRef.current = true;
      void (async () => {
        setSubmittingInitialPrompt(true);
        setSubmissionError(null);
        try {
          const dispatch = await dispatchStartRunWithMessage(
            { role: MessageType.User },
            kickoffText,
            undefined,
            initialPromptAttachments ?? [],
          );
          if (!dispatch.ok) {
            setSubmissionError(dispatch.error);
            return;
          }
          markInitialPromptSent();
          onInitialPromptAccepted?.();
          setPromptDraft("");
        } finally {
          setSubmittingInitialPrompt(false);
        }
      })();
    }, [
      initialPromptDraft,
      initialPromptRetryCount,
      initialPromptAttachments,
      onInitialPromptAccepted,
      hasSentInitialPrompt,
      startRunPromptError,
      agentSession.conversationId,
      runId,
      dispatchStartRunWithMessage,
      markInitialPromptSent,
    ]);

    const retryInitialPrompt = useCallback(() => {
      autoDispatchedRef.current = false;
      setSubmissionError(null);
      setInitialPromptRetryCount((count) => count + 1);
      retryInit();
    }, [retryInit]);

    const remoteChangedFiles = useRemoteChangedFilesCount({
      organizationId,
      projectId,
      agentSessionId,
      runId,
      enabled:
        agentSession.status !== AgentSessionStatus.NotStarted &&
        Boolean(agentSession.conversationId),
    });
    const changedFilesActionState = resolveChangedFilesActionState(
      remoteChangedFiles,
      remoteChangedFiles.retry,
    );
    const remoteChangedFilesInventory = useRemoteChangedFilesInventory({
      organizationId,
      projectId,
      agentSessionId,
      runId,
      open: diffModalOpen,
    });
    const retryChangedFiles = remoteChangedFiles.retry;
    const retryChangedFilesInventory = remoteChangedFilesInventory.retry;
    const conversationCurrentState = useAgentSessionCurrentState(
      organizationId,
      projectId,
      agentSessionId,
      { canonicalCurrentState: agentSession.currentState },
    ).currentState;
    const refreshChangedFilesAtTurnBoundary = useCallback(() => {
      retryChangedFiles();
      if (diffModalOpen) {
        retryChangedFilesInventory();
      }
    }, [diffModalOpen, retryChangedFiles, retryChangedFilesInventory]);
    useTurnCompletionRevision(
      conversationCurrentState,
      refreshChangedFilesAtTurnBoundary,
    );
    const deviceBlockedReason = interactionAccess.isDeviceEnabled
      ? null
      : interactionAccess.unavailable.message;
    const commitBlockedReason = resolveCommitBlockedReason(
      interactionAccess,
      remoteChangedFiles,
    );
    const retryFollowupAction = useCallback(() => {
      if (!actionFailure) return;
      const submit =
        actionFailure.action === "review"
          ? submitCodeReviewPrompt
          : submitCommitPrompt;
      const blockedReason =
        actionFailure.action === "review"
          ? deviceBlockedReason
          : commitBlockedReason;
      void runFollowupAction(
        actionFailure.action,
        actionFailure.submission,
        submit,
        blockedReason,
      );
    }, [
      actionFailure,
      commitBlockedReason,
      deviceBlockedReason,
      runFollowupAction,
      submitCodeReviewPrompt,
      submitCommitPrompt,
    ]);
    const reviewFeedback =
      actionFailure?.action === "review"
        ? ({
            status: "unavailable",
            presentationScope: "action",
            reason: deviceBlockedReason ?? actionFailure.reason,
            errorCode: null,
            retryable: actionFailure.retryable && deviceBlockedReason === null,
            failureIdentity: actionFailure.failureIdentity,
            retry: retryFollowupAction,
            isRetrying: actionFailure.isRetrying,
          } satisfies Extract<
            UnavailableOutcome,
            { presentationScope: "action" }
          >)
        : undefined;
    const commitFeedback =
      actionFailure?.action === "commit"
        ? ({
            status: "unavailable",
            presentationScope: "action",
            reason: commitBlockedReason ?? actionFailure.reason,
            errorCode: null,
            retryable: actionFailure.retryable && commitBlockedReason === null,
            failureIdentity: actionFailure.failureIdentity,
            retry: retryFollowupAction,
            isRetrying: actionFailure.isRetrying,
          } satisfies Extract<
            UnavailableOutcome,
            { presentationScope: "action" }
          >)
        : undefined;
    const handleOpenDiffModal = useCallback(() => setDiffModalOpen(true), []);
    const handleChangedFilesActionClick = useCallback(() => {
      if (changedFilesActionState?.kind === "available") {
        handleOpenDiffModal();
      }
      // The unavailable branch is handled by the action-owned feedback
      // surface and never opens the changed-files view or starts another read.
    }, [changedFilesActionState, handleOpenDiffModal]);
    const handleCloseDiffModal = useCallback(() => setDiffModalOpen(false), []);
    const handleReview = useCallback(() => {
      if (interactionAccess.isDeviceEnabled) setReviewModalOpen(true);
    }, [interactionAccess]);
    const handleReviewSubmit = useCallback(
      (submission: FollowupActionSubmission) => {
        setReviewModalOpen(false);
        void runFollowupAction(
          "review",
          submission,
          submitCodeReviewPrompt,
          deviceBlockedReason,
        );
      },
      [deviceBlockedReason, runFollowupAction, submitCodeReviewPrompt],
    );

    const handleCommit = useCallback(() => {
      if (commitBlockedReason === null) setCommitModalOpen(true);
    }, [commitBlockedReason]);
    const handleCommitSubmit = useCallback(
      (submission: FollowupActionSubmission) => {
        setCommitModalOpen(false);
        void runFollowupAction(
          "commit",
          submission,
          submitCommitPrompt,
          commitBlockedReason,
        );
      },
      [commitBlockedReason, runFollowupAction, submitCommitPrompt],
    );

    const combinedError =
      lifecycle.error ||
      submissionError ||
      contextMetadataError ||
      startRunPromptError;

    if (combinedError) {
      if (
        isLocalRuntimeUnavailable(combinedError) &&
        agentSession.conversationId
      ) {
        return (
          <Stack spacing={2}>
            <LocalRuntimeUnavailableAlert error={combinedError} />
            {taskData ? (
              <Box
                data-testid="coding-session-task-context"
                sx={{
                  position: "sticky",
                  top: taskContextStickyTop,
                  zIndex: (theme) => theme.zIndex.appBar + 1,
                  width: "100%",
                  bgcolor: "background.default",
                  backgroundImage: "none",
                  pb: 1,
                }}
              >
                <TaskPreviewCard task={taskData} defaultExpanded={false} />
              </Box>
            ) : null}
            {runId ? (
              <SessionContextUsageCapsules
                providerSessionId={latestProviderSessionId}
                provider={provider}
                organizationId={organizationId}
                projectId={projectId}
                agentSessionId={agentSessionId}
                conversationId={agentSession.conversationId}
                runId={runId}
                contextTokens={contextSize?.totalTokens}
                contextWindowTokens={contextSize?.maxTokens}
              />
            ) : null}
            <Box sx={codingSessionConversationRegionSx}>
              <AgentConversationView
                organizationId={organizationId}
                projectId={projectId}
                agentSessionId={agentSessionId}
                conversationId={agentSession.conversationId}
                planId={launchPlanId ?? undefined}
                stepId={launchStepId ?? undefined}
                hideComposer
                scrollPolicy={scrollPolicy}
                agentSessionMetadata={sessionMetadata}
                attachedAgent={attachedAgent}
              />
            </Box>
          </Stack>
        );
      }
      return (
        <Stack spacing={2}>
          <SessionErrorAlert
            error={combinedError}
            errorCode={lifecycle.errorCode}
            onRetry={retryInitialPrompt}
            failureIdentity={`${
              lifecycle.errorCode ?? "SESSION_ERROR"
            }:${combinedError}`}
            onDismiss={() => undefined}
          />
          <LocalRuntimeUnavailableAlert error={combinedError} />
        </Stack>
      );
    }

    const isAlreadyInProgress =
      agentSession.status === AgentSessionStatus.InProgress;

    // Until the auto-dispatch from `initialPromptDraft` resolves, hold a
    // loading panel. The wizard owns prompt entry now (AgentSetupView step 3),
    // so this surface never shows its own prompt editor.
    if (isAlreadyInProgress && !hasSentInitialPrompt) {
      return <LoadingPanel label="Loading session..." />;
    }

    if (!hasSentInitialPrompt) {
      return (
        <LoadingPanel
          label={
            initialPromptInFlight ? "Submitting prompt..." : "Starting run..."
          }
        />
      );
    }

    if (!runId) {
      return <LoadingPanel label="Starting run..." />;
    }

    const requestingCodeReview = submittingFollowupAction === "code_review";
    const requestingCommit = submittingFollowupAction === "commit";

    return (
      <RunBrowserProvider value={runBrowserContext}>
        <Stack
          spacing={2}
          sx={{ width: "100%", maxWidth: "none" }}
          data-testid="coding-session"
        >
          {taskData ? (
            <Box
              data-testid="coding-session-task-context"
              sx={{
                position: "sticky",
                top: taskContextStickyTop,
                zIndex: (theme) => theme.zIndex.appBar + 1,
                width: "100%",
                bgcolor: "background.default",
                backgroundImage: "none",
                pb: 1,
              }}
            >
              <TaskPreviewCard task={taskData} defaultExpanded={false} />
            </Box>
          ) : null}

          <CapsuleAction
            behavior="click"
            id="review"
            disabled={!interactionAccess.isDeviceEnabled && !reviewFeedback}
            label="Review"
            icon={CodeReviewIcon}
            onClick={handleReview}
            feedback={reviewFeedback}
            inProgress={requestingCodeReview}
            actionGroup="page"
            tier="page"
            order={20}
          />
          <CapsuleAction
            behavior="click"
            id="commit"
            disabled={!commitFeedback && commitBlockedReason !== null}
            label="Commit"
            icon={CommitIcon}
            onClick={handleCommit}
            feedback={commitFeedback}
            inProgress={requestingCommit}
            actionGroup="page"
            tier="page"
            order={30}
          />
          <OpenBrowserCapsuleAction
            runId={runId}
            sessionMachineId={sessionMachineId}
            order={35}
          />
          {taskMonitorMatches.length > 0 ? (
            <CapsuleAction
              behavior="expand"
              id="task-monitor-context"
              label="Task Monitors"
              icon={AccountTreeIcon}
              badge={taskMonitorMatches.length}
              renderContent={renderTaskMonitorNavigation}
              menuItems={taskMonitorMenuItems}
              actionGroup="page"
              tier="page"
              order={40}
            />
          ) : null}
          {changedFilesActionState ? (
            <CapsuleAction
              behavior="click"
              id="view-diffs"
              label={
                changedFilesActionState.kind === "available"
                  ? changedFilesActionState.count === 1
                    ? "1 file"
                    : `${String(changedFilesActionState.count)} files`
                  : "Files"
              }
              icon={
                changedFilesActionState.kind === "available"
                  ? CodeIcon
                  : WarningAmberIcon
              }
              iconStyle={
                changedFilesActionState.kind === "unavailable-with-reason"
                  ? { backgroundColor: "transparent", color: "text.secondary" }
                  : undefined
              }
              textColor={
                changedFilesActionState.kind === "unavailable-with-reason"
                  ? "text.secondary"
                  : undefined
              }
              feedback={
                changedFilesActionState.kind === "unavailable-with-reason"
                  ? changedFilesActionState.feedback
                  : undefined
              }
              onClick={handleChangedFilesActionClick}
              actionGroup="page"
              tier="page"
              order={100}
            />
          ) : null}
          <SessionContextUsageCapsules
            providerSessionId={latestProviderSessionId}
            provider={provider}
            organizationId={organizationId}
            projectId={projectId}
            agentSessionId={agentSessionId}
            conversationId={conversationId}
            runId={runId}
            contextTokens={contextSize?.totalTokens}
            contextWindowTokens={contextSize?.maxTokens}
          />
          <CollatedFileDiffModalContainer
            open={diffModalOpen}
            onClose={handleCloseDiffModal}
            entries={remoteChangedFilesInventory.entries ?? []}
            readState={
              remoteChangedFilesInventory.status === "success"
                ? { status: "ready" }
                : remoteChangedFilesInventory.status === "unavailable"
                  ? {
                      status: "error",
                      message: remoteChangedFilesInventory.error,
                    }
                  : { status: "loading" }
            }
            onRetry={remoteChangedFilesInventory.retry}
            organizationId={organizationId}
            projectId={projectId}
            agentSessionId={agentSessionId}
            runId={runId}
          />
          <ModalWorkOwner.Provider value={reviewModalOpenOwnerKey}>
            <FollowupActionModal
              open={reviewModalOpen}
              surfaceId={CODE_REVIEW_SURFACE_ID}
              catalogSource={followupCatalogSource}
              onClose={() => setReviewModalOpen(false)}
              onSubmit={handleReviewSubmit}
              submitting={requestingCodeReview}
              title="Code Review"
              submitLabel="Review"
              submittingLabel="Reviewing..."
              placeholder="Add any specific focus areas or instructions for the review... (optional)"
            />
          </ModalWorkOwner.Provider>
          <ModalWorkOwner.Provider value={commitModalOpenOwnerKey}>
            <FollowupActionModal
              open={commitModalOpen}
              surfaceId={COMMIT_SURFACE_ID}
              catalogSource={followupCatalogSource}
              onClose={() => setCommitModalOpen(false)}
              onSubmit={handleCommitSubmit}
              submitting={requestingCommit}
              title="Commit Changes"
              submitLabel="Commit"
              submittingLabel="Committing..."
              placeholder="Add any specific commit instructions... (optional)"
            />
          </ModalWorkOwner.Provider>
          <Box
            data-testid="coding-session-conversation-region"
            sx={codingSessionConversationRegionSx}
          >
            <AgentConversationView
              organizationId={organizationId}
              projectId={projectId}
              agentSessionId={agentSessionId}
              conversationId={conversationId}
              planId={launchPlanId ?? undefined}
              stepId={launchStepId ?? undefined}
              submittingPrompt={submittingPrompt}
              onSubmitReply={handleSubmitReply}
              onSubmitMessageAgent={
                runId ? handleSubmitMessageAgent : undefined
              }
              attachedAgent={attachedAgent}
              onCreateNewConversation={onCreateNewConversation}
              onStopRun={lifecycle.stopRun}
              stoppingRun={lifecycle.stoppingRun}
              onProposalsAccepted={handleProposalsAccepted}
              scrollPolicy={scrollPolicy}
              agentSessionMetadata={sessionMetadata}
              fileReferenceScope={
                taskData
                  ? (resolveFileReferenceScope(taskData.type, taskData.id) ??
                    undefined)
                  : undefined
              }
            />
          </Box>
        </Stack>
      </RunBrowserProvider>
    );
  },
);

export const CodingSession = (props: CodingSessionProps) => {
  const { organizationId, agentSession, projectId, machineId } = props;

  const conversationId = agentSession.conversationId;
  // The node-decision workflow (plan approval, etc.) prefers the conversation's
  // durable `workflowName` (threaded as a prop, survives reload) and falls back
  // to the launch-time method persisted on AgentSession.config.
  const nodeDecisionWorkflowName = resolveCodingSessionWorkflowType(
    readCodingSessionMethod(agentSession.config),
    props.workflowName,
  );
  const launch = useLaunchRunOrchestration({
    organizationId,
    apiClient,
    projectId,
    agentSessionId: agentSession.id,
    ...(conversationId ? { conversationId } : {}),
    ...(machineId ? { machineId } : {}),
    ...(nodeDecisionWorkflowName
      ? { workflowName: nodeDecisionWorkflowName }
      : {}),
  });

  if (!conversationId) {
    return null;
  }

  return (
    <VerificationRuntimeContext.Provider
      value={{
        parentAgentSessionId: agentSession.id,
        machineId: machineId ?? agentSession.machineId ?? null,
        serviceIds: agentSession.serviceIds?.length
          ? agentSession.serviceIds
          : props.serviceId
            ? [props.serviceId]
            : [],
        launchServiceId:
          agentSession.launchServiceId ?? (props.serviceId || null),
      }}
    >
      <CodingSessionActive
        {...props}
        launch={launch}
        conversationId={conversationId}
        {...(nodeDecisionWorkflowName ? { nodeDecisionWorkflowName } : {})}
      />
    </VerificationRuntimeContext.Provider>
  );
};
