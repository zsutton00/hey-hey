import type { ReactNode } from "react";
import { TaskMonitorResponsePresentationContext } from "./TaskMonitorResponsePresentationContext";
import { useTaskMonitorComposing } from "./useTaskMonitorComposing";
import { useTaskMonitorDockMotion } from "./useTaskMonitorDockMotion";
import type { TaskResponseDto } from "../../api/api";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useRef, useState } from "react";
import {
  MessageType,
  TaskMonitorReviewMode,
  WorkStatus,
  type MachineDto,
  type ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
  type SubmitTaskMonitorCommandResponseDto,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorExecutionNodeLaunchConfiguration,
  type TaskMonitorLaunchPolicy,
  type TaskMonitorRuntimeSelection,
  type UserMessageDataTaskMonitor,
} from "../../api";
import { apiClient } from "../../clients/client.js";
import {
  toOpenApiConversationId,
  toOpenApiProjectId,
} from "../../clients/contractIdentifierAdapters";
import { AgentConversationView } from "../AgentSession";
import {
  buildAgentInput,
  buildUserMessageData,
} from "../AgentSession/runtime/hooks/directTriggerInput";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";
import { submitStopRunViaPlatform } from "../AgentSession/runtime/hooks/submitStopRunViaPlatform";
import { MachinePicker } from "../AgentSession/MachinePicker";
import { TaskMonitorCommandOutcomeAlert } from "./TaskMonitorCommandOutcomeAlert";
import { TaskMonitorRuntimeGroup } from "./TaskMonitorRuntimeGroup";
import { TaskMonitorApplyToUnstartedTasks } from "./TaskMonitorApplyToUnstartedTasks";
import {
  TaskMonitorGuidanceSetting,
  TaskMonitorSettingsSection,
  TaskMonitorWorktreeBranchSetting,
} from "./TaskMonitorPreStartSettings";
import { TaskMonitorReadyToStart } from "./TaskMonitorReadyToStart";
import {
  resolveTaskMonitorStartReadiness,
  type TaskMonitorTaskServicesControl,
} from "./taskMonitorStartReadiness";
import { TaskMonitorReviewModeControl } from "./TaskMonitorReviewModeControl";
import { useMonitorKind } from "./useMonitorKind";
import { TaskMonitorCapsuleButton } from "./TaskMonitorCapsuleButton";
import {
  resolveTaskMonitorLifecycleButton,
  TaskMonitorLifecycleCapsuleButton,
} from "./TaskMonitorLifecycleCapsuleButton";
import {
  monitorPhase,
  useTaskMonitorPresentation,
} from "./useTaskMonitorPresentation";
import type { WorkItemExecutionStateResult } from "../../data/hooks/useWorkItemExecutionState";
import { TaskMonitorInspectorView } from "./TaskMonitorInspectorView";
import { TaskMonitorStepsPane } from "./TaskMonitorStepsPane";
import { resolveTaskMonitorInspectorNode } from "./taskMonitorInspectorState";
import type { TaskMonitorStartPresentation } from "./taskMonitorStartPresentation";
import type { TaskMonitorPauseResumeAction } from "./useTaskMonitorPauseResume";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";
import { useTaskMonitorCoordinatorConversation } from "./useTaskMonitorSessionReports";
import { useTaskMonitorConversationFormResolver } from "./useTaskMonitorConversationFormResolver";

export type TaskMonitorPane = "steps" | "monitor" | "session";

const FINISHED_MONITOR_STATUSES: ReadonlySet<TaskResponseDto["status"]> =
  new Set([
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Superseded,
    WorkStatus.Archived,
  ]);

export interface TaskMonitorWorkspaceViewProps {
  organizationId: string;
  projectId: string;
  monitorId: string;
  monitorSessionDate: string | null;
  monitorName: string;
  monitorStatus: TaskResponseDto["status"] | null;
  definition: TaskMonitorExecutionDefinition | null;
  nodes: readonly TaskMonitorProjectedNode[];
  isLoading: boolean;
  startPresentation: TaskMonitorStartPresentation;
  pendingLifecycleAction: TaskMonitorPauseResumeAction | null;
  errorMessage: string | null;
  operationalErrorMessage: string | null;
  commandOutcome: SubmitTaskMonitorCommandResponseDto | null;
  machines: MachineDto[];
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  onStart: () => void | Promise<boolean>;
  onPause: () => void;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
  onSaveCoordinatorRuntime: (
    runtime: TaskMonitorRuntimeSelection,
  ) => Promise<void>;
  /** Saves the runtime Review runs on; null clears it back to each task's session. */
  onSaveReviewRuntime: (
    runtime: TaskMonitorRuntimeSelection | null,
  ) => Promise<void>;
  /** Saves Review mode and the shared worktree; editable only before Start. */
  onSaveLaunchPolicy: (launchPolicy: TaskMonitorLaunchPolicy) => Promise<void>;
  /** Replaces the session setup on every task whose session does not exist yet. */
  onApplyToUnstartedTasks: (
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto>;
  /** The optional guidance sent with Start; a browser draft, never stored on the monitor. */
  startMessage: string;
  onChangeStartMessage: (message: string) => void;
  taskServices: TaskMonitorTaskServicesControl;
  activePane: TaskMonitorPane;
  renderPaneNavigation?: (navigation: {
    activePane: TaskMonitorPane;
    availablePanes: readonly TaskMonitorPane[];
    onSelectPane: (pane: TaskMonitorPane) => void;
  }) => ReactNode;
  executionState?: WorkItemExecutionStateResult;
  isStartCatalogLoading?: boolean;
}

export const TaskMonitorWorkspaceView = ({
  organizationId,
  projectId,
  monitorId,
  monitorSessionDate,
  monitorName,
  monitorStatus,
  definition,
  nodes,
  isLoading,
  startPresentation,
  pendingLifecycleAction,
  errorMessage,
  operationalErrorMessage,
  commandOutcome,
  machines,
  selectedMachineId,
  onSelectMachine,
  onStart,
  onPause,
  isSavingLaunchConfiguration,
  onSaveLaunchConfiguration,
  onSaveCoordinatorRuntime,
  onSaveReviewRuntime,
  onSaveLaunchPolicy,
  onApplyToUnstartedTasks,
  startMessage,
  onChangeStartMessage,
  taskServices,
  activePane,
  renderPaneNavigation,
  executionState,
  isStartCatalogLoading = false,
}: TaskMonitorWorkspaceViewProps) => {
  const [explicitTaskId, setExplicitTaskId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const startIntent = useRef(false);
  const composition = useTaskMonitorComposing(rootRef);
  const { composing, clearFormDrafts } = composition;
  const snapshot =
    executionState?.status === "retained"
      ? executionState.state.projection
      : null;
  const phase = monitorPhase(snapshot, monitorStatus === WorkStatus.Backlog);
  const presentation = useTaskMonitorPresentation(phase, composing, activePane);
  const { compactPane, openPane, closePane } = presentation;
  const handleOpenMonitor = useCallback(() => {
    openPane("monitor");
    requestAnimationFrame(() => monitorRef.current?.focus());
  }, [openPane]);
  const handleCloseMonitor = useCallback(() => {
    closePane("monitor");
    requestAnimationFrame(() => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-screen-key]"),
      ).find(
        (element) => element.dataset.screenKey === `task-monitor:${monitorId}`,
      );
      const target =
        button ??
        document.querySelector<HTMLButtonElement>(
          '[data-testid="capsule-toggle"], [data-testid="capsule-restore-button"]',
        );
      target?.focus();
    });
  }, [closePane, monitorId]);
  const handleGuidanceAnswered = useCallback(
    (targetMonitorId: string) => {
      if (targetMonitorId !== monitorId) {
        return;
      }
      clearFormDrafts();
      handleCloseMonitor();
    },
    [monitorId, clearFormDrafts, handleCloseMonitor],
  );
  const rawSelection = resolveTaskMonitorInspectorNode(nodes, explicitTaskId);
  const selectionIdentity = `${rawSelection?.taskId ?? ""}:${rawSelection?.session.kind === "loaded" ? rawSelection.session.session.id : ""}`;
  const retainedSelection = useRef({
    identity: selectionIdentity,
    node: rawSelection,
  });
  if (!composing || retainedSelection.current.identity === selectionIdentity) {
    retainedSelection.current = {
      identity: selectionIdentity,
      node: rawSelection,
    };
  }
  const selectedNode = retainedSelection.current.node;
  const displayPhase = presentation.phase;
  const setup = displayPhase === "setup";
  const results = displayPhase === "done" || displayPhase === "halted";
  const current =
    executionState?.status === "retained" &&
    executionState.delivery === "LIVE" &&
    executionState.freshness.status === "CURRENT";
  const advertisedActions =
    current && snapshot ? snapshot.availableActions : [];
  const committedActions = snapshot?.availableActions ?? [];
  const availability = {
    setup: phase === "setup",
    start:
      (!isStartCatalogLoading ||
        advertisedActions.some((action) => action.command === "RESUME")) &&
      (snapshot
        ? (current && setup && snapshot.execution.lifecycle === "ABSENT") ||
          advertisedActions.some(
            (action) =>
              action.command === "START" || action.command === "RESUME",
          )
        : phase === "setup"),
    pause: advertisedActions.some((action) => action.command === "PAUSE"),
    // The label follows the last committed snapshot; freshness only gates
    // submission. Start (including retry) wins when both are advertised.
    showsPause:
      phase !== "setup" &&
      committedActions.some((action) => action.command === "PAUSE") &&
      !committedActions.some(
        (action) => action.command === "START" || action.command === "RESUME",
      ),
  };
  const panes = presentation.panes;
  const freshness =
    executionState?.status === "retained" &&
    (executionState.delivery !== "LIVE" ||
      executionState.freshness.status !== "CURRENT")
      ? "Last known state · updates unavailable"
      : "";
  useTaskMonitorDockMotion({
    monitorId,
    setup,
    hasCommittedExecution:
      snapshot !== null && snapshot.execution.lifecycle !== "ABSENT",
    composing,
    monitorOpen: panes.monitor,
    monitorRef,
    startIntent,
  });
  const [isSavingCoordinatorRuntime, setIsSavingCoordinatorRuntime] =
    useState(false);
  const [isStoppingCoordinator, setIsStoppingCoordinator] = useState(false);
  const [coordinatorStopError, setCoordinatorStopError] = useState<
    string | null
  >(null);
  const [coordinatorStartError, setCoordinatorStartError] = useState<
    string | null
  >(null);
  const [isBindingCoordinator, setIsBindingCoordinator] = useState(false);
  const [launchPolicyError, setLaunchPolicyError] = useState<string | null>(
    null,
  );
  const [worktreeBranchPending, setWorktreeBranchPending] = useState(false);
  const monitorKind = useMonitorKind(
    organizationId,
    projectId,
    definition?.kind ?? "",
  );
  const monitorActivity = useTaskMonitorCoordinatorConversation({
    organizationId,
    projectId,
    monitorId,
    sessionDate: monitorSessionDate,
  });
  const conversationFormResolver = useTaskMonitorConversationFormResolver({
    organizationId,
    projectId,
    monitorId,
    selectedMachineId,
  });
  const resolvedConversationForm = useCallback<typeof conversationFormResolver>(
    (message) => {
      const form = conversationFormResolver(message);
      if (!form) {
        return null;
      }
      return {
        ...form,
        submit: async (data) => {
          await form.submit(data);
          handleGuidanceAnswered(monitorId);
        },
      };
    },
    [conversationFormResolver, handleGuidanceAnswered, monitorId],
  );
  const coordinatorSession = monitorActivity.session;
  const coordinatorConversationId = coordinatorSession?.conversationId?.trim();
  const startCoordinator = useCallback(() => {
    if (
      !selectedMachineId ||
      isBindingCoordinator ||
      isSavingCoordinatorRuntime
    ) {
      return;
    }
    if (!coordinatorSession) {
      setCoordinatorStartError(
        "The Task Monitor coordinator is still loading. Retry Start in a moment.",
      );
      return;
    }

    setCoordinatorStartError(null);
    setIsBindingCoordinator(true);
    void bindGraphConversationAgentSessionMachine({
      organizationId,
      projectId,
      agentSessionId: coordinatorSession.id,
      machineId: selectedMachineId,
    })
      .then(async () => {
        startIntent.current = phase === "setup";
        const accepted = await onStart();
        if (accepted === false) {
          startIntent.current = false;
        }
      })
      .catch((error: unknown) => {
        setCoordinatorStartError(
          error instanceof Error
            ? error.message
            : "The Task Monitor coordinator could not be bound to the selected machine.",
        );
      })
      .finally(() => setIsBindingCoordinator(false));
  }, [
    coordinatorSession,
    isBindingCoordinator,
    onStart,
    organizationId,
    projectId,
    selectedMachineId,
    phase,
    isSavingCoordinatorRuntime,
  ]);
  const stopCoordinatorRun = useCallback(() => {
    if (
      !coordinatorSession ||
      !coordinatorConversationId ||
      isStoppingCoordinator
    ) {
      return;
    }

    setCoordinatorStopError(null);
    setIsStoppingCoordinator(true);
    void submitStopRunViaPlatform({
      apiClient,
      runId: coordinatorSession.id,
      organizationId,
      projectId,
      agentSessionId: coordinatorSession.id,
      conversationId: coordinatorConversationId,
    })
      .then((result) => {
        if (!result.ok) setCoordinatorStopError(result.error);
      })
      .finally(() => setIsStoppingCoordinator(false));
  }, [
    coordinatorConversationId,
    coordinatorSession,
    isStoppingCoordinator,
    organizationId,
    projectId,
  ]);

  if (isLoading) {
    return (
      <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary">Loading Task Monitor…</Typography>
      </Stack>
    );
  }
  if (errorMessage || !definition || !monitorStatus) {
    return (
      <Alert severity="error" data-testid="task-monitor-load-error">
        {errorMessage ??
          "The Task Monitor status or execution data is unavailable."}
      </Alert>
    );
  }

  const isPreStart =
    monitorStatus === WorkStatus.Backlog &&
    startPresentation.status === "ready";
  const catalogSource = selectedMachineId
    ? { organizationId, projectId, machineId: selectedMachineId }
    : null;
  // Session existence, not monitor status, decides whether a task's setup can
  // still change; a finished monitor runs nothing further.
  const unstartedNodes = nodes.filter((node) => node.session.kind === "none");
  const monitorFinished = FINISHED_MONITOR_STATUSES.has(monitorStatus);
  const worktreeBranch = definition.launchPolicy.worktree?.branch ?? null;
  // The block holds for as long as the monitor has not started, whatever the
  // Start presentation says, so a task that cannot launch never gets started.
  const notStarted = monitorStatus === WorkStatus.Backlog;
  const startReadiness = resolveTaskMonitorStartReadiness({
    nodes,
    updatingServiceTaskIds: taskServices.updatingTaskIds,
    worktreeBranch,
    worktreeBranchPending,
  });
  const controlsDisabled =
    selectedMachineId === null ||
    (setup && nodes.length === 0) ||
    isSavingCoordinatorRuntime ||
    (notStarted && startReadiness.blocked);
  const lifecycleButton = resolveTaskMonitorLifecycleButton({
    availability,
    pendingLifecycleAction,
    startPresentation,
    binding: isBindingCoordinator,
    controlsDisabled,
  });
  const taskSetup = {
    organizationId,
    machineId: selectedMachineId,
    monitorKindKey: definition.kind,
    editable: !monitorFinished,
    isSavingLaunchConfiguration,
    onSaveLaunchConfiguration,
    services: taskServices,
  };
  const saveLaunchPolicy = (launchPolicy: TaskMonitorLaunchPolicy): void => {
    setLaunchPolicyError(null);
    void onSaveLaunchPolicy(launchPolicy).catch((error: unknown) => {
      setLaunchPolicyError(
        error instanceof Error
          ? error.message
          : "The Task Monitor setting could not be saved.",
      );
    });
  };

  return (
    <TaskMonitorResponsePresentationContext.Provider
      value={handleGuidanceAnswered}
    >
      <Stack
        ref={rootRef}
        {...composition.handlers}
        spacing={2}
        data-phase={displayPhase}
        data-testid="task-monitor-workspace"
        sx={{ height: "100%", minHeight: 0 }}
      >
        <TaskMonitorLifecycleCapsuleButton
          monitorId={monitorId}
          availability={availability}
          pendingLifecycleAction={pendingLifecycleAction}
          startPresentation={startPresentation}
          binding={isBindingCoordinator}
          controlsDisabled={controlsDisabled}
          onStart={startCoordinator}
          onPause={onPause}
        />
        {phase !== "setup" && snapshot ? (
          <TaskMonitorCapsuleButton
            monitorId={monitorId}
            name={monitorName}
            phase={phase}
            progress={`${Math.min(definition.cursor + (phase === "done" ? 0 : 1), nodes.length)}/${nodes.length}`}
            freshness={freshness}
            onOpen={handleOpenMonitor}
          />
        ) : null}
        {renderPaneNavigation?.({
          activePane: compactPane,
          availablePanes: setup
            ? ["steps", "monitor"]
            : ["steps", "monitor", "session"],
          onSelectPane: openPane,
        })}
        <ButtonGroup
          size="small"
          aria-label="Workspace panes"
          data-testid="task-monitor-pane-navigation"
          sx={{
            flexWrap: "wrap",
            display: {
              xs: renderPaneNavigation ? "none" : "inline-flex",
              lg: "inline-flex",
            },
          }}
        >
          <Button
            data-testid="task-monitor-open-steps"
            aria-pressed={panes.steps}
            onClick={() => {
              presentation.openPane("steps");
            }}
          >
            Tasks
          </Button>
          <Button
            data-testid="task-monitor-open-monitor"
            aria-pressed={panes.monitor}
            onClick={handleOpenMonitor}
          >
            Task Monitor
          </Button>
          {!setup ? (
            <Button
              data-testid="task-monitor-open-session"
              aria-pressed={panes.session}
              onClick={() => {
                presentation.openPane("session");
              }}
            >
              Active Session
            </Button>
          ) : null}
        </ButtonGroup>
        {freshness ? (
          <Alert severity="warning" data-testid="task-monitor-state-stale">
            {freshness}
          </Alert>
        ) : null}
        {executionState?.status === "error" ? (
          <Alert severity="error">{executionState.error.message}</Alert>
        ) : null}
        {phase === "unknown" ? (
          <Alert severity="info">
            Current monitor execution state is unavailable.
          </Alert>
        ) : null}
        {snapshot?.failure ? (
          <Alert severity="error" data-testid="task-monitor-current-failure">
            {snapshot.failure.code}: {snapshot.failure.cause}
            <br />
            {snapshot.failure.correctiveGuidance}
          </Alert>
        ) : null}
        {coordinatorStartError || operationalErrorMessage ? (
          <Alert severity="error" data-testid="task-monitor-start-error">
            {coordinatorStartError ?? operationalErrorMessage}
          </Alert>
        ) : null}
        {commandOutcome ? (
          <TaskMonitorCommandOutcomeAlert outcome={commandOutcome} />
        ) : null}
        <Box
          data-testid="task-monitor-workspace-layout"
          sx={{
            display: { xs: "block", lg: "grid" },
            gridTemplateColumns: {
              lg: `${panes.steps ? (!panes.session && !panes.monitor ? "minmax(0, 1fr)" : setup ? "minmax(0, 1fr)" : "minmax(0, 28%)") : "44px"} ${panes.monitor ? "minmax(0, 1fr)" : "0px"} ${panes.session && !setup ? "minmax(0, 1fr)" : "0px"}`,
            },
            flex: 1,
            height: "100%",
            minHeight: 0,
            columnGap: panes.monitor && panes.session ? 1.5 : 0,
          }}
        >
          <Paper
            variant="outlined"
            data-testid="task-monitor-steps-surface"
            sx={{
              display: {
                xs: compactPane === "steps" ? "flex" : "none",
                lg: "flex",
              },
              flexDirection: "column",
              position: "relative",
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              overflow: "hidden",
              pb: 0,
            }}
          >
            <Button
              data-testid="task-monitor-toggle-steps"
              onClick={() =>
                panes.steps
                  ? presentation.closePane("steps")
                  : presentation.openPane("steps")
              }
              aria-label={
                panes.steps ? "Collapse task list" : "Expand task list"
              }
            >
              {panes.steps ? (results ? "Results" : "Tasks") : "☰"}
            </Button>
            <Box
              sx={{
                display: panes.steps ? "flex" : "none",
                flex: 1,
                minHeight: 0,
                flexDirection: "column",
              }}
            >
              <TaskMonitorStepsPane
                nodes={nodes}
                results={results}
                organizationId={organizationId}
                projectId={projectId}
                selectedTaskId={selectedNode?.taskId ?? null}
                onSelectTask={(taskId) => {
                  setExplicitTaskId(taskId);
                  if (!setup) {
                    presentation.openPane("session");
                  }
                }}
                taskSetup={taskSetup}
                header={
                  unstartedNodes[0] && !monitorFinished ? (
                    <TaskMonitorApplyToUnstartedTasks
                      seed={
                        (
                          unstartedNodes.find((node) => node.isCursor) ??
                          unstartedNodes[0]
                        ).launchConfiguration
                      }
                      unstartedTaskCount={unstartedNodes.length}
                      allowedLaunchMethods={
                        monitorKind?.allowedLaunchMethods ?? []
                      }
                      catalogSource={catalogSource}
                      onApply={onApplyToUnstartedTasks}
                    />
                  ) : null
                }
              />
            </Box>
          </Paper>

          <Paper
            ref={monitorRef}
            tabIndex={-1}
            variant="outlined"
            data-testid="task-monitor-coordinator-pane"
            inert={!panes.monitor && compactPane !== "monitor"}
            sx={{
              display: {
                xs: compactPane === "monitor" ? "flex" : "none",
                lg: "flex",
              },
              visibility: { lg: panes.monitor ? "visible" : "hidden" },
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              overflowY: "auto",
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 2, pt: 1 }}
            >
              <Typography variant="h6">Task Monitor settings</Typography>
              <Button
                data-testid="task-monitor-close-monitor"
                onClick={handleCloseMonitor}
              >
                Dock
              </Button>
            </Stack>
            <Stack spacing={1.5} sx={{ px: 2, py: 1 }}>
              <TaskMonitorSettingsSection
                title="Task Monitor"
                explanation="The agent that supervises this run. It starts each task's session in order, decides when work needs review and when a task is done, and answers or raises questions from the sessions."
                testId="task-monitor-agent-section"
              >
                <TaskMonitorRuntimeGroup
                  label="Runs on"
                  testId="task-monitor-coordinator-runtime"
                  value={definition.coordinatorRuntime ?? null}
                  catalogSource={catalogSource}
                  editable={isPreStart}
                  isSaving={isSavingLaunchConfiguration}
                  onSave={onSaveCoordinatorRuntime}
                  onBusyChange={setIsSavingCoordinatorRuntime}
                  defaultLabel="Default (provider default model and effort)"
                />
                <Typography variant="caption" color="text.secondary">
                  Only the supervising agent. Each task&apos;s session is set on
                  its card.
                </Typography>
              </TaskMonitorSettingsSection>
              <TaskMonitorSettingsSection
                title="Machine"
                explanation="Where the task sessions run."
                testId="task-monitor-machine-section"
              >
                {machines.length > 0 ? (
                  <Stack
                    spacing={0.5}
                    data-testid="task-monitor-session-machine"
                  >
                    <Typography variant="overline" color="text.secondary">
                      Sessions run on
                    </Typography>
                    <MachinePicker
                      machines={machines}
                      selectedMachineId={selectedMachineId}
                      onSelect={onSelectMachine}
                    />
                  </Stack>
                ) : (
                  <Alert
                    severity="warning"
                    data-testid="task-monitor-machine-unavailable"
                  >
                    No paired CLI machine is available. Begin pairing locally
                    before controlling the Task Monitor.
                  </Alert>
                )}
                {isPreStart ? (
                  <TaskMonitorWorktreeBranchSetting
                    worktreeBranch={worktreeBranch}
                    onChangeWorktreeBranch={(branch) => {
                      const { worktree: _previous, ...launchPolicy } =
                        definition.launchPolicy;
                      saveLaunchPolicy(
                        branch === null
                          ? launchPolicy
                          : {
                              ...launchPolicy,
                              worktree: { enabled: true, branch },
                            },
                      );
                    }}
                    onWorktreeBranchPendingChange={setWorktreeBranchPending}
                  />
                ) : null}
              </TaskMonitorSettingsSection>
              <TaskMonitorSettingsSection
                title="Review"
                optional
                explanation="Require a review of each task's work before it counts as done. With Agent decides, the Task Monitor chooses when to ask for one."
                testId="task-monitor-review"
              >
                <TaskMonitorReviewModeControl
                  value={definition.launchPolicy.terminalSupervision.mode}
                  disabled={!isPreStart || isSavingLaunchConfiguration}
                  onChange={(mode) => {
                    const { terminalSupervision } = definition.launchPolicy;
                    saveLaunchPolicy({
                      ...definition.launchPolicy,
                      // A Review runtime applies only to required Review, so leaving it drops the choice.
                      terminalSupervision:
                        mode === TaskMonitorReviewMode.RequireReview
                          ? { ...terminalSupervision, mode }
                          : { mode },
                    });
                  }}
                />
                {definition.launchPolicy.terminalSupervision.mode ===
                TaskMonitorReviewMode.RequireReview ? (
                  <>
                    <TaskMonitorRuntimeGroup
                      label="Reviewer runs on"
                      testId="task-monitor-review-runtime"
                      value={
                        definition.launchPolicy.terminalSupervision
                          .reviewRuntime ?? null
                      }
                      catalogSource={catalogSource}
                      editable={isPreStart}
                      isSaving={isSavingLaunchConfiguration}
                      onSave={onSaveReviewRuntime}
                      onClear={() => onSaveReviewRuntime(null)}
                      onBusyChange={setIsSavingCoordinatorRuntime}
                      defaultLabel="Each task's session"
                    />
                    {isPreStart ? (
                      <Typography variant="caption" color="text.secondary">
                        Optional. Defaults to each task&apos;s own session; the
                        review runs inside that session.
                      </Typography>
                    ) : null}
                  </>
                ) : null}
              </TaskMonitorSettingsSection>
              {isPreStart ? (
                <TaskMonitorSettingsSection
                  title="Guidance"
                  explanation="Instructions the Task Monitor follows for the whole run."
                  testId="task-monitor-guidance-section"
                >
                  <TaskMonitorGuidanceSetting
                    startMessage={startMessage}
                    onChangeStartMessage={onChangeStartMessage}
                  />
                </TaskMonitorSettingsSection>
              ) : null}
              {launchPolicyError ? (
                <Alert
                  severity="error"
                  data-testid="task-monitor-launch-policy-error"
                >
                  {launchPolicyError}
                </Alert>
              ) : null}
            </Stack>
            {monitorActivity.loading ? (
              <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
                <CircularProgress />
                <Typography color="text.secondary">
                  Loading coordinator conversation…
                </Typography>
              </Stack>
            ) : monitorActivity.errorMessage ? (
              <Alert severity="error" sx={{ m: 2 }}>
                {monitorActivity.errorMessage}
              </Alert>
            ) : coordinatorSession && coordinatorConversationId ? (
              <>
                {coordinatorStopError ? (
                  <Alert severity="error" sx={{ mx: 2, mt: 2 }}>
                    {coordinatorStopError}
                  </Alert>
                ) : null}
                <AgentConversationView
                  organizationId={organizationId}
                  projectId={projectId}
                  agentSessionId={coordinatorSession.id}
                  conversationId={coordinatorConversationId}
                  taskMonitorId={monitorId}
                  conversationFormResolver={resolvedConversationForm}
                  onDraftChange={composition.onDraftChange}
                  buildReplyMessage={(text) => {
                    const agentInput = {
                      monitorId,
                      userMessage: text.trim(),
                      cause: "CONTINUE",
                      correlationId: crypto.randomUUID(),
                      promptType: "task_monitor",
                    } satisfies UserMessageDataTaskMonitor;

                    return {
                      projectId: toOpenApiProjectId(projectId),
                      conversationId: toOpenApiConversationId(
                        coordinatorConversationId,
                      ),
                      type: MessageType.User,
                      data: buildUserMessageData({
                        agentInput: buildAgentInput(agentInput),
                      }),
                    };
                  }}
                  onStopRun={stopCoordinatorRun}
                  stoppingRun={isStoppingCoordinator}
                  scrollable
                />
              </>
            ) : notStarted && startPresentation.status !== "starting" ? (
              <Box sx={{ px: 2, pb: 2 }}>
                <TaskMonitorReadyToStart
                  readiness={startReadiness}
                  machineSelected={selectedMachineId !== null}
                  hasTasks={nodes.length > 0}
                  startDisabled={
                    lifecycleButton.pausing || lifecycleButton.disabled
                  }
                  onStart={startCoordinator}
                />
              </Box>
            ) : startPresentation.status === "starting" ? (
              <Alert severity="info" sx={{ m: 2 }}>
                Starting the Task Monitor. The coordinator conversation will
                appear here shortly.
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ m: 2 }}>
                The coordinator conversation could not be loaded after the
                monitor started.
              </Alert>
            )}
          </Paper>

          <Paper
            variant="outlined"
            data-testid="task-monitor-inspector-pane"
            sx={{
              display: {
                xs: !setup && compactPane === "session" ? "flex" : "none",
                lg: "flex",
              },
              visibility: {
                lg: panes.session && !setup ? "visible" : "hidden",
              },
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              overflow: "hidden",
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ px: 2, pt: 1 }}
            >
              <Typography variant="h6">Active Session</Typography>
              <Button
                data-testid="task-monitor-close-session"
                onClick={() => {
                  presentation.closePane("session");
                  requestAnimationFrame(() =>
                    rootRef.current
                      ?.querySelector<HTMLButtonElement>(
                        '[data-testid="task-monitor-open-session"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                Close
              </Button>
            </Stack>
            {selectedNode ? (
              <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <TaskMonitorInspectorView
                  organizationId={organizationId}
                  projectId={projectId}
                  monitorId={monitorId}
                  monitorStatus={monitorStatus}
                  node={selectedNode}
                />
              </Box>
            ) : (
              <Alert
                severity="warning"
                data-testid="task-monitor-inspector-empty-selection"
                sx={{ m: 2 }}
              >
                No execution work is available to inspect.
              </Alert>
            )}
          </Paper>
        </Box>
      </Stack>
    </TaskMonitorResponsePresentationContext.Provider>
  );
};
