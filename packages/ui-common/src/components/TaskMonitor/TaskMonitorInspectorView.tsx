import {
  Alert,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type {
  TaskMonitorExecutionNodeLaunchConfiguration,
  TaskMonitorLaunchMethod,
} from "../../api";
import type { WorkStatus } from "../../api";
import { usePathService } from "../../contexts";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import { resolveAgentSessionMetadata } from "../AgentSession/resolveAgentSessionMetadata";
import {
  TASK_MONITOR_SETUP_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { TaskMonitorConversationPane } from "./TaskMonitorConversationPane";
import { TaskMonitorSessionActivityIndicator } from "./TaskMonitorSessionActivityIndicator";
import { resolveTaskMonitorInspectorPresentation } from "./taskMonitorInspectorState";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";
import { useTaskMonitorConversation } from "./useTaskMonitorSessionReports";

export interface TaskMonitorInspectorViewProps {
  organizationId: string;
  projectId: string;
  /** The machine whose CLI offers the model choices; null until one is picked. */
  machineId: string | null;
  monitorStatus: WorkStatus;
  node: TaskMonitorProjectedNode;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
}

const normalizeLaunchConfiguration = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
): TaskMonitorExecutionNodeLaunchConfiguration => {
  const { fastMode: _staleFastMode, ...base } = configuration;
  return supportsFastMode(base.provider, base.model)
    ? { ...base, fastMode: configuration.fastMode ?? false }
    : base;
};

export const TaskMonitorInspectorView = ({
  organizationId,
  projectId,
  machineId,
  monitorStatus,
  node,
  isSavingLaunchConfiguration,
  onSaveLaunchConfiguration,
}: TaskMonitorInspectorViewProps) => {
  const pathService = usePathService();
  const session = node.session.kind === "loaded" ? node.session.session : null;
  const conversation = useTaskMonitorConversation({
    organizationId,
    projectId,
    session,
  });
  const [launchConfiguration, setLaunchConfiguration] = useState(
    node.launchConfiguration,
  );
  const launchConfigurationRef = useRef(node.launchConfiguration);
  const pendingLaunchConfigurationRef =
    useRef<TaskMonitorExecutionNodeLaunchConfiguration | null>(null);
  const saveInFlightRef = useRef(false);
  const [isSavingLocally, setIsSavingLocally] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    launchConfigurationRef.current = node.launchConfiguration;
    setLaunchConfiguration(node.launchConfiguration);
    setSaveError(null);
  }, [node.launchConfiguration, node.taskId]);

  const saveLaunchConfiguration = async (
    next: TaskMonitorExecutionNodeLaunchConfiguration,
  ): Promise<void> => {
    next = normalizeLaunchConfiguration(next);
    launchConfigurationRef.current = next;
    pendingLaunchConfigurationRef.current = next;
    setLaunchConfiguration(next);
    setSaveError(null);
    if (saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    setIsSavingLocally(true);
    await Promise.resolve();
    try {
      while (pendingLaunchConfigurationRef.current) {
        const pending = pendingLaunchConfigurationRef.current;
        pendingLaunchConfigurationRef.current = null;
        writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, {
          provider: pending.provider,
          model: pending.model,
          reasoningEffort: pending.reasoningEffort,
          ...(supportsFastMode(pending.provider, pending.model)
            ? { fastMode: pending.fastMode ?? false }
            : {}),
        });
        await onSaveLaunchConfiguration(node.taskId, pending);
      }
    } catch (error) {
      pendingLaunchConfigurationRef.current = null;
      setSaveError(
        error instanceof Error
          ? error.message
          : "Unable to save this task's launch configuration.",
      );
    } finally {
      saveInFlightRef.current = false;
      setIsSavingLocally(false);
    }
  };

  if (node.task.kind === "missing") {
    return (
      <Alert severity="error" data-testid="task-monitor-inspector-missing-task">
        The canonical task could not be loaded.
      </Alert>
    );
  }

  if (node.session.kind === "missing") {
    return (
      <Alert
        severity="error"
        data-testid="task-monitor-inspector-missing-session"
      >
        The canonical linked session could not be loaded.
      </Alert>
    );
  }

  const presentation = resolveTaskMonitorInspectorPresentation({
    monitorStatus,
    node,
  });
  const configurationEditor =
    node.session.kind === "none" ? (
      <Stack
        spacing={1.5}
        sx={{ p: 2 }}
        data-testid="task-monitor-node-launch-configuration"
      >
        <Typography variant="h6">Session setup</Typography>
        <FormControl
          size="small"
          fullWidth
          disabled={isSavingLaunchConfiguration || isSavingLocally}
        >
          <InputLabel id={`task-monitor-inspector-method-${node.taskId}`}>
            Method
          </InputLabel>
          <Select
            labelId={`task-monitor-inspector-method-${node.taskId}`}
            label="Method"
            value={launchConfiguration.method}
            onChange={(event) =>
              saveLaunchConfiguration({
                ...launchConfigurationRef.current,
                method: event.target.value as TaskMonitorLaunchMethod,
              })
            }
          >
            <MenuItem value="plan">Plan</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="quick">Quick</MenuItem>
          </Select>
        </FormControl>
        <RuntimeModelSelector
          catalogSource={
            machineId ? { organizationId, projectId, machineId } : null
          }
          provider={launchConfiguration.provider}
          model={launchConfiguration.model}
          reasoningEffort={launchConfiguration.reasoningEffort}
          fastMode={launchConfiguration.fastMode ?? false}
          onProviderChange={(provider) =>
            void saveLaunchConfiguration({
              ...launchConfigurationRef.current,
              provider,
            })
          }
          onModelChange={(model) =>
            void saveLaunchConfiguration({
              ...launchConfigurationRef.current,
              model,
            })
          }
          onReasoningEffortChange={(reasoningEffort) => {
            if (!reasoningEffort) return;
            saveLaunchConfiguration({
              ...launchConfigurationRef.current,
              reasoningEffort,
            });
          }}
          onFastModeChange={(fastMode) =>
            void saveLaunchConfiguration({
              ...launchConfigurationRef.current,
              fastMode,
            })
          }
          disabled={isSavingLaunchConfiguration || isSavingLocally}
          testIdPrefix="task-monitor-node-runtime"
        />
        {saveError ? <Alert severity="error">{saveError}</Alert> : null}
      </Stack>
    ) : null;
  if (presentation.kind === "waiting-for-session") {
    return (
      <Stack
        spacing={2}
        data-testid="task-monitor-waiting-for-session"
        sx={{ p: 2 }}
      >
        {configurationEditor}
        <Typography variant="h6">Current session</Typography>
        <LinearProgress aria-label="Waiting for session to start" />
        <Typography color="text.secondary">
          Waiting for session to start
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      {configurationEditor}
      <TaskMonitorConversationPane
        title={session?.title ?? "Current session"}
        conversation={conversation.conversation}
        project={conversation.project}
        readOnly
        loading={conversation.loading}
        fetched={conversation.fetched}
        errorMessage={conversation.errorMessage}
        emptyMessage={
          session
            ? "This session does not have a conversation."
            : "No session has been linked to this task."
        }
        sessionHref={
          session
            ? pathService.agentSession({
                projectId,
                agentSessionId: session.id,
              })
            : undefined
        }
        agentSessionMetadata={
          session ? resolveAgentSessionMetadata(session) : undefined
        }
        contentAfter={
          <TaskMonitorSessionActivityIndicator
            organizationId={organizationId}
            projectId={projectId}
            agentSessionId={session?.id ?? null}
          />
        }
        testId="task-monitor-current-session"
      />
    </Stack>
  );
};
