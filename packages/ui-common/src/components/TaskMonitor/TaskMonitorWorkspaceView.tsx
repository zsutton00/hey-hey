import type { ReactNode } from "react";
import { TaskMonitorResponsePresentationContext } from "./TaskMonitorResponsePresentationContext";
import { useTaskMonitorComposing } from "./useTaskMonitorComposing";
import { useTaskMonitorDockMotion } from "./useTaskMonitorDockMotion";
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
  WorkStatus,
  type MachineDto,
  type SubmitTaskMonitorCommandResponseDto,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorExecutionNodeLaunchConfiguration,
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
import { TaskMonitorControlDock } from "./TaskMonitorControlDock";
import { TaskMonitorLaunchConfigurationEditor } from "./TaskMonitorLaunchConfigurationEditor";
import { TaskMonitorCapsuleButton } from "./TaskMonitorCapsuleButton";
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

export interface TaskMonitorWorkspaceViewProps {
  organizationId: string;
  projectId: string;
  monitorId: string;
  monitorSessionDate: string | null;
  monitorName: string;
  monitorStatus: WorkStatus | null;
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
  const [isStoppingCoordinator, setIsStoppingCoordinator] = useState(false);
  const [coordinatorStopError, setCoordinatorStopError] = useState<
    string | null
  >(null);
  const [coordinatorStartError, setCoordinatorStartError] = useState<
    string | null
  >(null);
  const [isBindingCoordinator, setIsBindingCoordinator] = useState(false);
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
    if (!selectedMachineId || isBindingCoordinator) {
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
              <Typography variant="h6">Task Monitor</Typography>
              <Button
                data-testid="task-monitor-close-monitor"
                onClick={handleCloseMonitor}
              >
                Dock
              </Button>
            </Stack>
            <Box sx={{ px: 1, py: 1 }}>
              <Stack spacing={1} alignItems="center">
                <TaskMonitorControlDock
                  monitorStatus={monitorStatus}
                  availability={availability}
                  presentation={startPresentation}
                  pendingAction={pendingLifecycleAction}
                  controlsDisabled={
                    selectedMachineId === null ||
                    isBindingCoordinator ||
                    (setup && nodes.length === 0)
                  }
                  onStart={startCoordinator}
                  onPause={onPause}
                />
                <Box sx={{ width: "100%" }}>
                  {machines.length > 0 ? (
                    <MachinePicker
                      machines={machines}
                      selectedMachineId={selectedMachineId}
                      onSelect={onSelectMachine}
                    />
                  ) : (
                    <Alert
                      severity="warning"
                      data-testid="task-monitor-machine-unavailable"
                    >
                      No paired CLI machine is available. Begin pairing locally
                      before controlling the Task Monitor.
                    </Alert>
                  )}
                </Box>
              </Stack>
            </Box>
            {selectedNode && selectedNode.session.kind === "none" ? (
              <TaskMonitorLaunchConfigurationEditor
                organizationId={organizationId}
                projectId={projectId}
                machineId={selectedMachineId}
                monitorKindKey={definition.kind}
                node={selectedNode}
                isSavingLaunchConfiguration={isSavingLaunchConfiguration}
                onSaveLaunchConfiguration={onSaveLaunchConfiguration}
              />
            ) : null}
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
            ) : isPreStart ? (
              <Stack
                spacing={1.5}
                data-testid="task-monitor-coordinator-prestart"
                sx={{
                  m: 2,
                  p: 2,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                }}
              >
                <Typography variant="subtitle1" fontWeight={600}>
                  Ready to start
                </Typography>
                <Typography color="text.secondary">
                  Choose a paired CLI machine, and press Start.
                </Typography>
                <Typography variant="subtitle2">How it works</Typography>
                <Box
                  component="ol"
                  sx={{
                    m: 0,
                    pl: 2.5,
                    color: "text.secondary",
                    "& li + li": { mt: 0.75 },
                  }}
                >
                  <li>
                    The coordinator works through the steps you&apos;ve selected
                    in order
                  </li>
                  <li>
                    Follow its live updates and reply to guide it when needed.
                  </li>
                  <li>
                    Active Session shows the session for the current step.
                  </li>
                </Box>
              </Stack>
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
