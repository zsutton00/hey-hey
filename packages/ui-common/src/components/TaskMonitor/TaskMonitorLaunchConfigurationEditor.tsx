import { Alert, Stack } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { TaskMonitorExecutionNodeLaunchConfiguration } from "../../api";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import {
  TASK_MONITOR_SETUP_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { TaskMonitorLaunchConfigurationFields } from "./TaskMonitorLaunchConfigurationFields";
import { normalizeFastMode } from "./taskMonitorRuntimeSelection";
import { useMonitorKind } from "./useMonitorKind";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export function TaskMonitorLaunchConfigurationEditor({
  organizationId,
  projectId,
  machineId,
  monitorKindKey,
  node,
  isSavingLaunchConfiguration,
  onSaveLaunchConfiguration,
}: {
  organizationId: string;
  projectId: string;
  machineId: string | null;
  monitorKindKey: string;
  node: TaskMonitorProjectedNode;
  isSavingLaunchConfiguration: boolean;
  onSaveLaunchConfiguration: (
    taskId: string,
    configuration: TaskMonitorExecutionNodeLaunchConfiguration,
  ) => Promise<void>;
}) {
  const monitorKind = useMonitorKind(organizationId, projectId, monitorKindKey);
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
    next = normalizeFastMode(next);
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
      <Stack spacing={1.5} data-testid="task-monitor-node-launch-configuration">
        <TaskMonitorLaunchConfigurationFields
          idPrefix={`task-monitor-inspector-${node.taskId}`}
          testIdPrefix="task-monitor-node-runtime"
          value={launchConfiguration}
          allowedLaunchMethods={monitorKind?.allowedLaunchMethods ?? []}
          catalogSource={
            machineId ? { organizationId, projectId, machineId } : null
          }
          disabled={isSavingLaunchConfiguration || isSavingLocally}
          onChange={(patch) =>
            void saveLaunchConfiguration({
              ...launchConfigurationRef.current,
              ...patch,
            })
          }
        />
        {saveError ? <Alert severity="error">{saveError}</Alert> : null}
      </Stack>
    ) : null;
  return configurationEditor;
}
