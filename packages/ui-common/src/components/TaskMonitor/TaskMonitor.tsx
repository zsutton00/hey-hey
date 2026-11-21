import { Stack } from "@mui/material";
import { useState } from "react";
import { WorkStatus } from "../../api";
import { useWorkItemExecutionState } from "../../data/hooks/useWorkItemExecutionState";
import { TrackingProvider } from "../../contexts";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { TaskMonitorWorkspaceView } from "./TaskMonitorWorkspaceView";
import type {
  TaskMonitorPane,
  TaskMonitorWorkspaceViewProps,
} from "./TaskMonitorWorkspaceView";
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
  renderPaneNavigation?: TaskMonitorWorkspaceViewProps["renderPaneNavigation"];
}

export const TaskMonitor = ({
  organizationId,
  projectId,
  monitorId,
  activePane,
  renderPaneNavigation,
}: TaskMonitorProps) => {
  const executionState = useWorkItemExecutionState(monitorId);
  const snapshot =
    executionState.status === "retained"
      ? executionState.state.projection
      : null;
  const live =
    executionState.status === "retained" &&
    executionState.delivery === "LIVE" &&
    executionState.freshness.status === "CURRENT";
  const [userMessage, setUserMessage] = useState<string | null>(() =>
    readTaskMonitorStartMessage(organizationId, projectId, monitorId),
  );
  const projection = useTaskMonitorProjection({
    organizationId,
    projectId,
    monitorId,
  });
  const { machines, selectedMachine, setSelectedMachineId } =
    useMachineResolution();
  const launchNode = projection.definition
    ? (projection.definition.executionPlan[projection.definition.cursor] ??
      null)
    : null;
  const start = useTaskMonitorStart({
    organizationId,
    projectId,
    monitorId,
    machineId: selectedMachine?.machineId ?? null,
    userMessage,
    launchNode,
    launchPolicy: projection.definition?.launchPolicy ?? null,
    coordinatorRuntime: projection.definition?.coordinatorRuntime ?? null,
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
  // A retained snapshot whose lifecycle is ABSENT has not started yet.
  const hasStarted = !!snapshot && snapshot.execution.lifecycle !== "ABSENT";
  const startPresentation =
    !hasStarted && (start.isSubmitting || start.acceptedAwaitingRefresh)
      ? { status: "starting" as const }
      : hasStarted
        ? start.isSubmitting
          ? { status: "starting" as const }
          : { status: "active" as const }
        : projection.definition
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
          loading={!contextError && projection.isLoading}
          fetched={Boolean(contextError) || projection.isFetched}
        >
          <TaskMonitorWorkspaceView
            executionState={executionState}
            isStartCatalogLoading={start.isCatalogLoading}
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
              if (
                live &&
                snapshot?.availableActions.some(
                  (action) => action.command === "PAUSE",
                )
              ) {
                void pauseResume.pause();
              }
            }}
            onStart={async (): Promise<boolean> => {
              const monitorStatus = projection.monitor?.status;
              const command = live
                ? snapshot?.availableActions.find(
                    (action) =>
                      action.command === "RESUME" || action.command === "START",
                  )?.command
                : null;
              if (command === "RESUME") {
                return pauseResume.resume();
              }
              if (
                hasStarted
                  ? command !== "START"
                  : monitorStatus !== WorkStatus.Backlog
              ) {
                return false;
              }

              return start.start().then((submitted) => {
                if (!submitted) {
                  return false;
                }
                clearTaskMonitorStartMessage(
                  organizationId,
                  projectId,
                  monitorId,
                );
                setUserMessage(null);
                return true;
              });
            }}
            isSavingLaunchConfiguration={projection.isSavingLaunchConfiguration}
            onSaveLaunchConfiguration={projection.saveLaunchConfiguration}
            onSaveCoordinatorRuntime={projection.saveCoordinatorRuntime}
            activePane={activePane}
            renderPaneNavigation={renderPaneNavigation}
          />
        </DataStateBoundary>
      </Stack>
    </TrackingProvider>
  );
};
