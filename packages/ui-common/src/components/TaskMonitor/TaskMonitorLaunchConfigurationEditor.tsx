import {
  Alert,
  FormControl,
  InputLabel,
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
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import {
  TASK_MONITOR_SETUP_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";
function isLaunchMethod(value: string): value is TaskMonitorLaunchMethod {
  return value === "plan" || value === "open" || value === "quick";
}

const normalizeLaunchConfiguration = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
): TaskMonitorExecutionNodeLaunchConfiguration => {
  const { fastMode: _staleFastMode, ...base } = configuration;
  return supportsFastMode(base.provider, base.model)
    ? { ...base, fastMode: configuration.fastMode ?? false }
    : base;
};

export function TaskMonitorLaunchConfigurationEditor({
  organizationId,
  projectId,
  machineId,
  node,
  isSavingLaunchConfiguration,
  onSaveLaunchConfiguration,
}: {
  organizationId: string;
  projectId: string;
  machineId: string | null;
  node: TaskMonitorProjectedNode;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
}) {
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
            onChange={(event) => {
              const method = event.target.value;
              if (isLaunchMethod(method)) {
                void saveLaunchConfiguration({
                  ...launchConfigurationRef.current,
                  method,
                });
              }
            }}
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
  return configurationEditor;
}
