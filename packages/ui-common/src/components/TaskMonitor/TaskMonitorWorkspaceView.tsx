import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
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
  onStart: () => void;
  onPause: () => void;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
  activePane: TaskMonitorPane;
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
}: TaskMonitorWorkspaceViewProps) => {
  const [explicitTaskId, setExplicitTaskId] = useState<string | null>(null);
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
      .then(() => onStart())
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

  const selectedNode = resolveTaskMonitorInspectorNode(nodes, explicitTaskId);
  const isPreStart =
    monitorStatus === WorkStatus.Backlog &&
    startPresentation.status === "ready";

  return (
    <Stack
      spacing={2}
      data-testid="task-monitor-workspace"
      sx={{ height: "100%", minHeight: 0 }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", sm: "center" }}
      >
        <Typography
          variant="h4"
          data-testid="task-monitor-name"
          sx={{ flex: 1, display: { xs: "none", md: "block" } }}
        >
          {monitorName}
        </Typography>
        <Chip
          label={monitorStatus}
          color="primary"
          variant="outlined"
          data-testid="task-monitor-status"
        />
      </Stack>

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
            lg: "minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1.5fr)",
          },
          flex: 1,
          height: "100%",
          minHeight: 0,
          gap: 2,
        }}
      >
        <Paper
          variant="outlined"
          data-testid="task-monitor-steps-surface"
          sx={{
            display: {
              xs: activePane === "steps" ? "flex" : "none",
              lg: "flex",
            },
            flexDirection: "column",
            position: "relative",
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
            pb: machines.length > 0 ? 16 : 22,
          }}
        >
          <Typography variant="h6" sx={{ px: 2, pt: 2 }}>
            Steps
          </Typography>
          <TaskMonitorStepsPane
            nodes={nodes}
            projectId={projectId}
            selectedTaskId={selectedNode?.taskId ?? null}
            onSelectTask={setExplicitTaskId}
          />
          <Box
            sx={{
              position: "absolute",
              insetInline: 0,
              bottom: 8,
              px: 1,
              zIndex: 5,
            }}
          >
            <Stack spacing={1} alignItems="center">
              <TaskMonitorControlDock
                monitorStatus={monitorStatus}
                presentation={startPresentation}
                pendingAction={pendingLifecycleAction}
                controlsDisabled={
                  selectedMachineId === null || isBindingCoordinator
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
        </Paper>

        <Paper
          variant="outlined"
          data-testid="task-monitor-coordinator-pane"
          sx={{
            display: {
              xs: activePane === "monitor" ? "flex" : "none",
              lg: "flex",
            },
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <Typography variant="h6" sx={{ px: 2, pt: 2 }}>
            Task Monitor
          </Typography>
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
                conversationFormResolver={conversationFormResolver}
                buildReplyMessage={(text) => {
                  const agentInput = {
                    monitorId,
                    userMessage: text.trim(),
                    cause: "CONTINUE",
                    correlationId: crypto.randomUUID(),
                    promptType: "task_monitor",
                  } satisfies UserMessageDataTaskMonitor;

                  return {
                    projectId,
                    conversationId: coordinatorConversationId,
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
                <li>Active Session shows the session for the current step.</li>
              </Box>
            </Stack>
          ) : startPresentation.status === "starting" ? (
            <Alert severity="info" sx={{ m: 2 }}>
              Starting the Task Monitor. The coordinator conversation will
              appear here shortly.
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ m: 2 }}>
              The coordinator conversation could not be loaded after the monitor
              started.
            </Alert>
          )}
        </Paper>

        <Paper
          variant="outlined"
          data-testid="task-monitor-inspector-pane"
          sx={{
            display: {
              xs: activePane === "session" ? "flex" : "none",
              lg: "flex",
            },
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <Typography variant="h6" sx={{ px: 2, pt: 2 }}>
            Active Session
          </Typography>
          {selectedNode ? (
            <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <TaskMonitorInspectorView
                organizationId={organizationId}
                projectId={projectId}
                machineId={selectedMachineId}
                monitorStatus={monitorStatus}
                node={selectedNode}
                isSavingLaunchConfiguration={isSavingLaunchConfiguration}
                onSaveLaunchConfiguration={onSaveLaunchConfiguration}
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
  );
};
