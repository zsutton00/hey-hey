import { Stack } from "@mui/material";
import { useState } from "react";
import { WorkStatus } from "../../api";
import { TrackingProvider } from "../../contexts";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { TaskMonitorWorkspaceView } from "./TaskMonitorWorkspaceView";
import type { TaskMonitorPane } from "./TaskMonitorWorkspaceView";
import { useTaskMonitorProjection } from "./useTaskMonitorProjection";
import { useTaskMonitorStart } from "./useTaskMonitorStart";
import { useTaskMonitorPauseResume } from "./useTaskMonitorPauseResume";
import {
  clearTaskMonitorStartMessage,
  readTaskMonitorStartMessage,
} from "./taskMonitorStartMessage";
import { resolveTaskMonitorStartPresentation } from "./taskMonitorStartPresentation";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";

export interface TaskMonitorProps {
  organizationId: string;
  projectId: string;
  monitorId: string;
  activePane: TaskMonitorPane;
}

export const TaskMonitor = ({
  organizationId,
  projectId,
  monitorId,
  activePane,
}: TaskMonitorProps) => {
  const [userMessage, setUserMessage] = useState<string | null>(() =>
    readTaskMonitorStartMessage(organizationId, projectId, monitorId)
  );
  const projection = useTaskMonitorProjection({
    organizationId,
    projectId,
    monitorId,
  });
  const { machines, selectedMachine, setSelectedMachineId } =
    useMachineResolution();
  const launchNode = projection.definition
    ? projection.definition.executionPlan[projection.definition.cursor] ?? null
    : null;
  const start = useTaskMonitorStart({
    organizationId,
    projectId,
    monitorId,
    machineId: selectedMachine?.machineId ?? null,
    userMessage,
    launchNode,
    launchPolicy: projection.definition?.launchPolicy ?? null,
    reconcileProjection: projection.reconcileAfterCommand,
  });
  const pauseResume = useTaskMonitorPauseResume({
    organizationId,
    projectId,
    monitorId,
    machineId: selectedMachine?.machineId ?? null,
    reconcileProjection: projection.reconcileAfterCommand,
  });
  const contextError =
    !organizationId || !projectId || !monitorId
      ? "Organization, project, and Task Monitor route context are required."
      : null;
  const startPresentation = projection.definition
    ? projection.monitor
      ? resolveTaskMonitorStartPresentation({
          monitorStatus: projection.monitor.status,
          isSubmitting: start.isSubmitting,
          acceptedAwaitingRefresh: start.acceptedAwaitingRefresh,
        })
      : { status: "ready" as const }
    : { status: "ready" as const };

  return (
    <TrackingProvider
      context={{
        page: {
          name: "task-monitor",
          path: typeof window === "undefined" ? "" : window.location.pathname,
          section: "task-monitor",
        },
        attentionEntity: {
          type: "task",
          id: monitorId,
          projectId,
          name: "Task Monitor",
        },
      }}
    >
      <Stack data-testid="task-monitor" sx={{ height: "100%", minHeight: 0 }}>
        <DataStateBoundary
          loading={
            !contextError && (projection.isLoading || start.isCatalogLoading)
          }
          fetched={
            Boolean(contextError) ||
            (projection.isFetched && start.isCatalogFetched)
          }
        >
          <TaskMonitorWorkspaceView
            organizationId={organizationId}
            projectId={projectId}
            monitorId={monitorId}
            monitorSessionDate={projection.monitor?.createdAt ?? null}
            monitorName={projection.monitor?.name ?? "Task Monitor"}
            monitorStatus={projection.monitor?.status ?? null}
            definition={projection.definition}
            nodes={projection.nodes}
            isLoading={false}
            startPresentation={startPresentation}
            pendingLifecycleAction={pauseResume.pendingAction}
            errorMessage={contextError ?? projection.errorMessage}
            operationalErrorMessage={
              pauseResume.errorMessage ?? start.errorMessage
            }
            commandOutcome={pauseResume.commandOutcome ?? start.commandOutcome}
            machines={machines}
            selectedMachineId={selectedMachine?.machineId ?? null}
            onSelectMachine={setSelectedMachineId}
            onPause={() => {
              void pauseResume.pause();
            }}
            onStart={() => {
              const monitorStatus = projection.monitor?.status;
              if (monitorStatus === WorkStatus.OnHold) {
                void pauseResume.resume();
                return;
              }
              if (monitorStatus !== WorkStatus.Backlog) return;

              void start.start().then((submitted) => {
                if (!submitted) return;
                clearTaskMonitorStartMessage(
                  organizationId,
                  projectId,
                  monitorId
                );
                setUserMessage(null);
              });
            }}
            isSavingLaunchConfiguration={projection.isSavingLaunchConfiguration}
            onSaveLaunchConfiguration={projection.saveLaunchConfiguration}
            activePane={activePane}
          />
        </DataStateBoundary>
      </Stack>
    </TrackingProvider>
  );
};
