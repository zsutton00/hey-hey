import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import type { AgentSkillSelection, RunAttachmentReference } from "../../api";
import type { PlanConfigurationV1 } from "../../api";
import {
  Alert,
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
} from "@mui/material";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentSessionConfigV2TypeEnum,
  ConversationStatus,
  LocalPromptType,
  PlanCombinationAggressiveness,
  WorkStatus,
  TaskSectionUpdateSource,
  type AgentSessionConfigV2,
  type AgentSessionDto,
  type ConversationResponseDto,
  type TaskResponseDto,
} from "../../api";
import { toWorkflowName } from "../../agents/coordination/sessionMethodWorkflow";
import { apiClient } from "../../clients/client";
import { usePathService } from "../../contexts/PathServiceContext";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { useCanonicalPlanMutations } from "../../data/hooks/useCanonicalPlanMutations";
import {
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type ConversationScrollPolicy,
} from "../Conversation/ConversationViewer";
import { AgentConversationView } from "./AgentConversationView";
import { OpenBrowserCapsuleAction } from "./OpenBrowserCapsuleAction";
import { RunBrowserProvider } from "./runtime/RunBrowserContext";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";
import { submitFreeformViaPlatform } from "./runtime/hooks/submitFreeformViaPlatform";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { PlanFromDesignDocPreStart } from "./PlanFromDesignDocPreStart";
import { RestartPlanGenerationDialog } from "./RestartPlanGenerationDialog";
import { plansClient } from "../../clients/serviceClients";
import { useAutoAdvanceFeatureSyncIterate } from "./useAutoAdvanceFeatureSyncIterate";
import { SessionErrorAlert } from "./SessionErrorAlert";
import { useAgentRunLifecycle, type RunLauncher } from "./useAgentRunLifecycle";
import {
  useLaunchRunOrchestration,
  type StartRunWorktree,
} from "./useLaunchRunOrchestration";
import { resolveAgentSessionMetadata } from "./resolveAgentSessionMetadata";
import { usePlanCreationCreatingState } from "./usePlanCreationCreatingState";
import { usePlanFromDesignDocSeed } from "./usePlanFromDesignDocSeed";
import { resolveDefaultPlanWorktreeBranch } from "../Plans/planWorktreeBranch";
import { usePlanFromDesignDocStart } from "./usePlanFromDesignDocStart";
import {
  writeSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";
import { useSurfaceSelection } from "./useSurfaceSelection";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import { supportsFastMode } from "./capabilityCatalog";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { AgentBridgeRecoveryNotice } from "./AgentBridgeRecoveryNotice";
import type { PlanGenerationLaunchSettings } from "./usePlanGenerationDraft";

// Stable memory key for the plan gate's controlled runtime selection.
const PLAN_GENERATION_SURFACE_ID = "plan-generation";
const DEFAULT_PLAN_COMBINATION_AGGRESSIVENESS =
  PlanCombinationAggressiveness.Medium;

const readAgentSessionConfigV2 = (
  agentSession: AgentSessionDto,
): AgentSessionConfigV2 | null =>
  agentSession.config?.type === AgentSessionConfigV2TypeEnum.CodingSession
    ? agentSession.config
    : null;

export interface PlanFromDesignDocChatProps {
  organizationId: string;
  projectId: string;
  planId: string;
  plan: Pick<TaskResponseDto, "id" | "name" | "status">;
  configuration: PlanConfigurationV1;
  conversation: ConversationResponseDto;
  onGenerationReset: () => void;
  onSessionReady?: (session: AgentSessionDto) => void;
  autoStartAgentSessionId?: string;
  launchSettings?: PlanGenerationLaunchSettings;
  scrollPolicy?: ConversationScrollPolicy;
}

interface PlanFromDesignDocActiveProps {
  organizationId: string;
  projectId: string;
  planId: string;
  plan: Pick<TaskResponseDto, "id" | "name" | "status">;
  configuration: PlanConfigurationV1;
  agentSession: AgentSessionDto;
  conversation: ConversationResponseDto;
  onGenerationReset: () => void;
  launch: RunLauncher;
  autoStart: boolean;
  launchSettings?: PlanGenerationLaunchSettings;
  scrollPolicy: ConversationScrollPolicy;
}

/**
 * Brings up a CLI Run against the pre-existing PLAN_GENERATION agent session
 * and its linked conversation. The session+conversation are materialized
 * server-side at `create_plan` proposal-approval time. The user reviews the
 * seed design doc in the pre-start placeholder and clicks "Start generating",
 * which dispatches the materialize-only start-run; the CLI binds the Run and
 * hands off to the conversation's workflow, which drives every turn to
 * proposed stages.
 */
const PlanFromDesignDocActive: React.FC<PlanFromDesignDocActiveProps> = ({
  organizationId,
  projectId,
  planId,
  plan,
  configuration,
  agentSession,
  conversation,
  launch,
  autoStart,
  scrollPolicy,
  onGenerationReset,
  launchSettings,
}) => {
  const conversationId = agentSession.conversationId ?? conversation.id;
  const [persistedSession, setPersistedSession] =
    useState<AgentSessionDto>(agentSession);

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

  // Preserve the session's execution-ready binding when this conversation is
  // resumed. In particular, an active run with several paired bridges has no
  // pre-start picker from which to make another selection.
  const machineResolution = useMachineResolution(
    launchSettings?.machineId ?? agentSession.machineId,
  );
  const selectedMachineId =
    machineResolution.selectedMachine?.machineId ?? null;

  // The CLI on the picked machine decides what is offered, so nothing is held
  // until its catalog has loaded; a launch handed over from the draft carries
  // its own selection.
  const { selection: catalogSelection } = useSurfaceSelection({
    surfaceId: PLAN_GENERATION_SURFACE_ID,
    catalogSource: selectedMachineId
      ? { organizationId, projectId, machineId: selectedMachineId }
      : null,
    resetKey: null,
  });
  const [explicitSelection, setExplicitSelection] =
    useState<SurfaceSelection | null>(() => launchSettings?.selection ?? null);
  const persistedFastMode = readAgentSessionConfigV2(agentSession)?.fastMode;
  const selection = useMemo<SurfaceSelection | null>(() => {
    if (explicitSelection) return explicitSelection;
    if (!catalogSelection) return null;
    return {
      ...catalogSelection,
      fastMode: persistedFastMode ?? catalogSelection.fastMode ?? false,
    };
  }, [catalogSelection, explicitSelection, persistedFastMode]);
  // Current between renders so provider, model and effort changes made by one
  // picker event build on each other.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const updateSelection = useCallback((change: Partial<SurfaceSelection>) => {
    const current = selectionRef.current;
    if (!current) return;
    const next = { ...current, ...change };
    selectionRef.current = next;
    setExplicitSelection(next);
    writeSurfaceSelection(PLAN_GENERATION_SURFACE_ID, next);
  }, []);
  const [worktreeEnabled, setWorktreeEnabled] = useState(
    () =>
      (launchSettings
        ? launchSettings.worktreeBranch
        : configuration.worktreeBranch) !== null,
  );
  const [worktreeBranch, setWorktreeBranch] = useState(
    () =>
      (launchSettings
        ? launchSettings.worktreeBranch
        : configuration.worktreeBranch) ?? "",
  );
  const [planCombinationAggressiveness, setPlanCombinationAggressiveness] =
    useState(
      () =>
        launchSettings?.planCombinationAggressiveness ??
        readAgentSessionConfigV2(agentSession)?.planCombinationAggressiveness ??
        DEFAULT_PLAN_COMBINATION_AGGRESSIVENESS,
    );
  const { updatePlan } = useCanonicalPlanMutations(organizationId, projectId);
  const persistWorktreeBranch = useCallback(
    async (branch: string | null) => {
      const result = await updatePlan(planId, {
        sections: [
          {
            key: "planConfiguration",
            content: { ...configuration, worktreeBranch: branch },
          },
        ],
        sectionUpdateSource: TaskSectionUpdateSource.User,
      });
      if (result.status === "pending")
        throw new Error("The worktree change is awaiting proposal approval.");
    },
    [configuration, planId, updatePlan],
  );

  const handleProviderChange = useCallback(
    (provider: SurfaceSelection["provider"]) => updateSelection({ provider }),
    [updateSelection],
  );

  const handleModelChange = useCallback(
    (model: string) => updateSelection({ model }),
    [updateSelection],
  );

  const handleReasoningEffortChange = useCallback(
    (reasoningEffort: SurfaceSelection["reasoningEffort"]) =>
      updateSelection({ reasoningEffort }),
    [updateSelection],
  );

  const handleFastModeChange = useCallback(
    (fastMode: boolean) => updateSelection({ fastMode }),
    [updateSelection],
  );

  const handleWorktreeEnabledChange = useCallback(
    (enabled: boolean) => {
      setWorktreeEnabled(enabled);
      if (enabled && worktreeBranch.trim().length === 0) {
        setWorktreeBranch(resolveDefaultPlanWorktreeBranch(plan.name));
      }
    },
    [plan.name, worktreeBranch],
  );

  const launchWorktree = useMemo<StartRunWorktree | undefined>(() => {
    if (!worktreeEnabled) {
      return undefined;
    }
    const branch = worktreeBranch.trim();
    if (!branch) {
      return undefined;
    }
    return { enabled: true, branch };
  }, [worktreeBranch, worktreeEnabled]);

  const agentSessionConfig = useMemo<AgentSessionConfigV2 | null>(() => {
    if (!selection) return null;
    const currentConfig = readAgentSessionConfigV2(agentSession);
    return {
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: "v2",
      ...(currentConfig?.method === undefined
        ? {}
        : { method: currentConfig.method }),
      model: selection.model,
      ...(selection.reasoningEffort
        ? { effort: selection.reasoningEffort }
        : currentConfig?.effort === undefined
          ? {}
          : { effort: currentConfig.effort }),
      ...(supportsFastMode(selection.provider, selection.model)
        ? { fastMode: selection.fastMode ?? false }
        : {}),
      ...(launchWorktree
        ? { worktree: launchWorktree.branch }
        : currentConfig?.worktree === undefined
          ? {}
          : { worktree: currentConfig.worktree }),
      ...(currentConfig?.sessionMonitorTerminalPolicy === undefined
        ? {}
        : {
            sessionMonitorTerminalPolicy:
              currentConfig.sessionMonitorTerminalPolicy,
          }),
      ...(currentConfig?.projectAssistant === undefined
        ? {}
        : { projectAssistant: currentConfig.projectAssistant }),
      planCombinationAggressiveness,
    };
  }, [agentSession, launchWorktree, planCombinationAggressiveness, selection]);

  const lifecycle = useAgentRunLifecycle({
    apiClient,
    enabled: true,
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    agentSessionStatus: agentSession.status,
    agentSessionConversationId: conversationId,
    context,
    contextMetadata,
    ...(selection
      ? { provider: selection.provider, model: selection.model }
      : {}),
    ...(selection?.reasoningEffort
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
    ...(selection && supportsFastMode(selection.provider, selection.model)
      ? { fastMode: selection.fastMode ?? false }
      : {}),
    ...(launchWorktree ? { worktree: launchWorktree } : {}),
    ...(selectedMachineId ? { machineId: selectedMachineId } : {}),
    // Materialize-only arm: the session+conversation were created server-side
    // at create_plan approval; the CLI only needs to bind the Run and hand off
    // to the conversation's workflow, which drives every turn. Carries
    // workflowName, no kickoff payload (the workflow's first node drives
    // every turn via its own SYSTEM triggers).
    arm: { kind: "workflow", workflowName: conversation.workflowName },
    // The user drives the kickoff from the pre-start placeholder's "Start
    // generating" button rather than firing on mount, so the start-run waits
    // until the seed design doc has been reviewed.
    deferInitialDispatch: true,
    launch,
  });

  const interactionAccess = useAgentSessionInteractionAccess(selectedMachineId);
  const [submittingReply, setSubmittingReply] = useState(false);
  const handleSubmitReply = useCallback(
    async (
      text: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<void> => {
      if (!lifecycle.runId) throw new Error("No active run available.");
      if (!interactionAccess.isDeviceEnabled) {
        throw new Error(interactionAccess.unavailable.message);
      }
      const replyProvider = selection?.provider ?? agentSession.provider;
      if (!replyProvider) {
        throw new Error("The run's provider is unknown; choose a model first.");
      }
      setSubmittingReply(true);
      try {
        const result = await submitFreeformViaPlatform({
          interactions: interactionAccess.interactions,
          run: {
            runId: lifecycle.runId,
            providerRunId: null,
            provider: replyProvider,
          },
          organizationId,
          projectId,
          agentSessionId: agentSession.id,
          conversationId,
          promptText: text,
          skillSelection,
          attachments,
          localPromptType: LocalPromptType.WorkflowDefined,
        });
        if (!result.ok) throw new Error(result.error);
      } finally {
        setSubmittingReply(false);
      }
    },
    [
      lifecycle.runId,
      interactionAccess,
      selection?.provider,
      agentSession.provider,
      organizationId,
      projectId,
      agentSession.id,
      conversationId,
    ],
  );

  // Auto-advance the workflow when all proposals on a SYSTEM message are
  // approved. Plan shaping advances exclusively through registry-declared
  // structured strategies (e.g. plan_generation_stage_review); the free-text
  // fallback is disabled for this workflow — workflowName is intentionally
  // not in WORKFLOW_FALLBACK_ALLOWLIST.
  const resolvedWorkflowName = toWorkflowName(conversation.workflowName);
  const handleProposalsAccepted = useAutoAdvanceFeatureSyncIterate({
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    conversationId,
    runId: lifecycle.runId ?? null,
    machineId: selectedMachineId,
    ...(resolvedWorkflowName ? { workflowName: resolvedWorkflowName } : {}),
  });

  // Resolve the seed design doc client-side for the pre-start placeholder.
  const {
    seed,
    designDocId,
    isLoading: isLoadingSeed,
    error: seedError,
  } = usePlanFromDesignDocSeed(organizationId, projectId, planId);

  const isBridgeSelected =
    machineResolution.isReady && machineResolution.selectedMachine !== null;
  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machineResolution.isReady,
        machines: machineResolution.machines,
        selectedMachineId,
      }),
    [machineResolution.isReady, machineResolution.machines, selectedMachineId],
  );

  // "Edit design doc" routes to the seed doc's page in edit mode. Omitted when
  // the plan has no resolvable design-doc relationship.
  const navigate = useNavigate();
  const pathService = usePathService();
  const handleEditDesignDoc = useMemo(
    () =>
      designDocId
        ? () =>
            navigate(
              pathService.designDoc({
                projectId,
                designDocId,
                editing: true,
              }),
            )
        : undefined,
    [designDocId, navigate, pathService, projectId],
  );

  // "Already kicked off?" is read off the conversation, not the agent session.
  // The server materializes the PLAN_GENERATION session as IN_PROGRESS at
  // create_plan approval, so session status can't tell a fresh, awaiting-kickoff
  // session apart from a running one. The conversation can: it's NOT_STARTED
  // until the user starts generating, then advances. A resumed/in-flight
  // conversation skips the placeholder and shows the live view directly; a
  // NOT_STARTED one shows the placeholder until the user starts generating.
  const {
    startGenerating: handleStartGenerating,
    isStarting,
    startError,
    progress: launchProgress,
  } = usePlanFromDesignDocStart({
    organizationId,
    projectId,
    conversationId,
    agentSession,
    machineId: selectedMachineId,
    agentSessionConfig,
    persistedWorktreeBranch: worktreeEnabled ? worktreeBranch.trim() : null,
    persistWorktreeBranch,
    dispatchStartRun: lifecycle.dispatchStartRun,
    onSessionPersisted: setPersistedSession,
  });
  const hasStarted =
    conversation.status !== ConversationStatus.NotStarted ||
    launchProgress?.phase === "accepted";
  const autoStartAttemptedRef = useRef(false);
  React.useEffect(() => {
    const worktreeBranchMissing =
      worktreeEnabled && worktreeBranch.trim().length === 0;
    if (
      !autoStart ||
      hasStarted ||
      launchProgress !== null ||
      autoStartAttemptedRef.current ||
      !isBridgeSelected ||
      selection === null ||
      isLoadingSeed ||
      worktreeBranchMissing
    ) {
      return;
    }

    autoStartAttemptedRef.current = true;
    handleStartGenerating();
  }, [
    autoStart,
    hasStarted,
    launchProgress,
    handleStartGenerating,
    isBridgeSelected,
    isLoadingSeed,
    selection,
    worktreeBranch,
    worktreeEnabled,
  ]);

  const isCreatingPlan = usePlanCreationCreatingState({
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    conversationId,
  });

  // Restart is only available while the plan is still a draft (BACKLOG).
  const isRunActive = plan.status === WorkStatus.Backlog;
  const [
    isRestartDialogOpen,
    setIsRestartDialogOpen,
    isRestartDialogOpenOwnerKey,
  ] = useModalState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const handleConfirmRestart = useCallback(() => {
    if (!isBridgeSelected) {
      return;
    }
    setIsRestarting(true);
    setRestartError(null);
    void (async () => {
      try {
        await plansClient.resetWorkItemPlanGeneration({
          organizationId,
          projectId,
          taskId: planId,
        });
        setIsRestartDialogOpen(false);
        onGenerationReset();
      } catch (cause) {
        setRestartError(
          cause instanceof Error
            ? cause.message
            : "Unable to reset Plan generation.",
        );
      } finally {
        setIsRestarting(false);
      }
    })();
  }, [isBridgeSelected, organizationId, planId, projectId, onGenerationReset]);

  React.useEffect(() => {
    if (!isBridgeSelected) {
      setIsRestartDialogOpen(false);
    }
  }, [isBridgeSelected]);

  const restartControls =
    isRunActive && lifecycle.runId ? (
      <>
        <Stack direction="row" justifyContent="flex-end">
          <Button
            size="small"
            color="error"
            onClick={() => setIsRestartDialogOpen(true)}
            disabled={!isBridgeSelected || isRestarting}
            data-testid="plan-generation-restart"
          >
            Restart
          </Button>
        </Stack>
        <ModalWorkOwner.Provider value={isRestartDialogOpenOwnerKey}>
          <RestartPlanGenerationDialog
            open={isRestartDialogOpen}
            onClose={() => setIsRestartDialogOpen(false)}
            onConfirm={handleConfirmRestart}
            restarting={isRestarting}
          />
        </ModalWorkOwner.Provider>
      </>
    ) : null;
  const restartErrorAlert = restartError ? (
    <Alert severity="error" onClose={() => setRestartError(null)}>
      {restartError}
    </Alert>
  ) : null;

  // The Run exists once the conversation has started; before that the pencil
  // on a mockup is disabled, like the Open browser button.
  const runBrowserRunId = lifecycle.runId ?? null;
  const runBrowserMachineId =
    persistedSession.machineId ?? selectedMachineId ?? null;
  const runBrowserContext = useMemo(
    () => ({ runId: runBrowserRunId, sessionMachineId: runBrowserMachineId }),
    [runBrowserRunId, runBrowserMachineId],
  );

  if (lifecycle.error && !isStarting && launchProgress?.phase !== "accepted") {
    return (
      <Stack spacing={2}>
        {restartControls}
        {restartErrorAlert}
        <SessionErrorAlert
          error={lifecycle.error}
          errorCode={lifecycle.errorCode}
          onRetry={isBridgeSelected ? handleStartGenerating : undefined}
        />
        <AgentBridgeRecoveryNotice state={recoveryState} />
        <LocalRuntimeUnavailableAlert error={lifecycle.error} />
      </Stack>
    );
  }

  if (!hasStarted) {
    return (
      <Stack spacing={2}>
        {startError && <Alert severity="error">{startError}</Alert>}
        {isStarting && (
          <Alert
            severity="info"
            icon={<CircularProgress size={16} />}
            data-testid="plan-generation-launch-progress"
          >
            {launchProgress?.phase === "preparing"
              ? "Saving generation settings…"
              : "Waiting for CLI acceptance…"}
          </Alert>
        )}
        {!!seedError && !seed && !isLoadingSeed && (
          <Alert severity="warning">
            Couldn&apos;t load the design doc preview. You can still start
            generating.
          </Alert>
        )}
        <PlanFromDesignDocPreStart
          organizationId={organizationId}
          projectId={projectId}
          navigate={navigate}
          seed={seed}
          isLoadingSeed={isLoadingSeed}
          isStarting={isStarting}
          onStartGenerating={handleStartGenerating}
          onEditDesignDoc={handleEditDesignDoc}
          isBridgeSelected={isBridgeSelected}
          provider={selection?.provider ?? null}
          model={selection?.model ?? null}
          reasoningEffort={selection?.reasoningEffort ?? null}
          fastMode={selection?.fastMode ?? false}
          onProviderChange={handleProviderChange}
          onModelChange={handleModelChange}
          onReasoningEffortChange={handleReasoningEffortChange}
          onFastModeChange={handleFastModeChange}
          machineSelection={{
            machines: machineResolution.machines,
            machineMode: machineResolution.mode,
            selectedMachineId,
            onSelectMachine: machineResolution.setSelectedMachineId,
            recoveryState,
          }}
          worktreeEnabled={worktreeEnabled}
          worktreeBranch={worktreeBranch}
          onWorktreeEnabledChange={handleWorktreeEnabledChange}
          onWorktreeBranchChange={setWorktreeBranch}
          planCombinationAggressiveness={planCombinationAggressiveness}
          onPlanCombinationAggressivenessChange={
            setPlanCombinationAggressiveness
          }
        />
      </Stack>
    );
  }

  if (!lifecycle.runId) {
    return <LinearProgress />;
  }

  return (
    <RunBrowserProvider value={runBrowserContext}>
      <Stack spacing={2}>
        <OpenBrowserCapsuleAction
          runId={runBrowserContext.runId}
          sessionMachineId={runBrowserContext.sessionMachineId}
          order={35}
        />
        {restartControls}
        {isCreatingPlan && (
          <Alert
            severity="info"
            icon={<CircularProgress size={16} />}
            data-testid="plan-generation-creating-banner"
          >
            Creating your plan…
          </Alert>
        )}
        {startError && <Alert severity="error">{startError}</Alert>}
        {restartErrorAlert}
        <AgentConversationView
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSession.id}
          canonicalCurrentState={agentSession.currentState}
          conversationId={conversationId}
          onProposalsAccepted={handleProposalsAccepted}
          onStopRun={lifecycle.stopRun}
          stoppingRun={lifecycle.stoppingRun}
          onSubmitReply={handleSubmitReply}
          submittingPrompt={submittingReply}
          composerPolicy="when-no-usable-response"
          agentSessionMetadata={resolveAgentSessionMetadata(persistedSession)}
          scrollPolicy={scrollPolicy}
        />
      </Stack>
    </RunBrowserProvider>
  );
};

/**
 * Renders a plan-from-design-doc workflow conversation.
 *
 * The conversation is system-initiated: created server-side when a CLI
 * agent's `create_plan` proposal is approved, alongside a PLAN_GENERATION
 * agent session linked to it. The browser is responsible for bringing up a
 * local CLI Run against that pre-existing session once the user starts
 * generating from the pre-start placeholder.
 */
export const PlanFromDesignDocChat: React.FC<PlanFromDesignDocChatProps> = ({
  organizationId,
  projectId,
  planId,
  plan,
  configuration,
  conversation,
  onSessionReady,
  autoStartAgentSessionId,
  launchSettings,
  onGenerationReset,
  scrollPolicy = DISABLED_CONVERSATION_SCROLL_POLICY,
}) => {
  const {
    agentSessions,
    isFetched: sessionsFetched,
    error: sessionsError,
  } = useAgentSessions(organizationId, projectId, {
    conversationId: conversation.id,
    enabled: !!organizationId && !!projectId,
  });

  const linkedSession = autoStartAgentSessionId
    ? (agentSessions.find(
        (session) => session.id === autoStartAgentSessionId,
      ) ?? null)
    : (agentSessions[0] ?? null);

  const launch = useLaunchRunOrchestration({
    organizationId,
    apiClient,
    projectId,
    conversationId: conversation.id,
    ...(linkedSession?.id ? { agentSessionId: linkedSession.id } : {}),
  });
  const notifiedSessionIdRef = useRef<string | null>(null);
  React.useEffect(() => {
    if (
      linkedSession &&
      onSessionReady &&
      notifiedSessionIdRef.current !== linkedSession.id
    ) {
      notifiedSessionIdRef.current = linkedSession.id;
      onSessionReady(linkedSession);
    }
  }, [linkedSession, onSessionReady]);

  if (sessionsError)
    return (
      <Alert severity="error" data-testid="plan-generation-session-error">
        {sessionsError.message}
      </Alert>
    );
  if (sessionsFetched && !linkedSession && !autoStartAgentSessionId)
    return (
      <Alert severity="info" data-testid="plan-generation-session-unavailable">
        No generation agent session is linked to this draft’s conversation.
      </Alert>
    );

  if (!sessionsFetched || !linkedSession) {
    return <LinearProgress />;
  }

  return (
    <PlanFromDesignDocActive
      organizationId={organizationId}
      projectId={projectId}
      planId={planId}
      plan={plan}
      configuration={configuration}
      agentSession={linkedSession}
      conversation={conversation}
      onGenerationReset={onGenerationReset}
      launchSettings={launchSettings}
      launch={launch}
      autoStart={
        conversation.status === ConversationStatus.NotStarted &&
        linkedSession.id === autoStartAgentSessionId
      }
      scrollPolicy={scrollPolicy}
    />
  );
};
