import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import type { TaskMonitorExecutionDefinition } from "../../api";
import { PlanStageTaskMonitorLaunchView } from "./PlanStageTaskMonitorLaunchView";
import { PlanStageTaskMonitorSetupReview } from "./PlanStageTaskMonitorSetupReview/index.tsx";
import type { UsePlanStageTaskMonitorSetupOptions } from "./usePlanStageTaskMonitorSetup";
import { usePlanStageTaskMonitorSetup } from "./usePlanStageTaskMonitorSetup";
import { usePlanStageTaskMonitorCreateOrReopen } from "./usePlanStageTaskMonitorCreateOrReopen";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { ModelSelectorMachineSelection } from "../AgentSession/ModelSelector";

export interface PlanStageTaskMonitorCreateOrReopenProps extends UsePlanStageTaskMonitorSetupOptions {
  onMonitorReady: (monitorId: string) => void;
}

export const PlanStageTaskMonitorCreateOrReopen = ({
  onMonitorReady,
  ...setupOptions
}: PlanStageTaskMonitorCreateOrReopenProps) => {
  const setupResult = usePlanStageTaskMonitorSetup(setupOptions);
  const [reviewedDefinition, setReviewedDefinition] =
    useState<TaskMonitorExecutionDefinition | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const sourceIdentity = useMemo(
    () =>
      setupResult.state.status === "ready"
        ? [
            setupResult.state.draft.provenance.organizationId,
            setupResult.state.draft.provenance.projectId,
            setupResult.state.draft.provenance.planId,
            setupResult.state.draft.provenance.planParentTaskId,
            setupResult.state.draft.provenance.stageId,
          ].join(":")
        : null,
    [setupResult.state],
  );
  const previousSourceIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceIdentity || previousSourceIdentity.current === sourceIdentity) {
      return;
    }
    previousSourceIdentity.current = sourceIdentity;
    if (setupResult.state.status === "ready") {
      setReviewedDefinition(setupResult.state.draft.definition);
      setUserMessage("");
      setConfirmed(false);
    }
  }, [setupResult.state, sourceIdentity]);

  const lifecycle = usePlanStageTaskMonitorCreateOrReopen({
    ...setupOptions,
    planLabel:
      setupResult.state.status === "ready"
        ? setupResult.state.draft.provenance.planLabel
        : "",
    planParentTaskId:
      setupResult.state.status === "ready"
        ? setupResult.state.draft.provenance.planParentTaskId
        : "",
    stageLabel:
      setupResult.state.status === "ready"
        ? setupResult.state.draft.provenance.stageLabel
        : "",
    definition: confirmed ? reviewedDefinition : null,
    userMessage,
    enabled: setupResult.state.status === "ready",
  });
  const notifiedMonitorId = useRef<string | null>(null);

  useEffect(() => {
    if (
      lifecycle.state.status !== "created" ||
      notifiedMonitorId.current === lifecycle.state.monitorId
    ) {
      return;
    }
    notifiedMonitorId.current = lifecycle.state.monitorId;
    onMonitorReady(lifecycle.state.monitorId);
  }, [lifecycle.state, onMonitorReady]);

  const machinePicker = (
    <ModelSelectorMachineSelection
      testIdPrefix="plan-stage-task-monitor"
      machineSelection={setupResult.machineSelection}
    />
  );

  if (setupResult.state.status !== "ready") {
    return (
      <DataStateBoundary
        loading={setupResult.isLoading}
        fetched={setupResult.isFetched}
      >
        {machinePicker}
        <PlanStageTaskMonitorLaunchView
          state={setupResult.state}
          onContinue={() => undefined}
        />
      </DataStateBoundary>
    );
  }

  if (!confirmed) {
    return (
      <DataStateBoundary
        loading={setupResult.isLoading}
        fetched={setupResult.isFetched}
      >
        {machinePicker}
        <PlanStageTaskMonitorSetupReview
          setup={setupResult.state.draft}
          catalogSource={setupResult.catalogSource}
          isRefreshingTaskServices={setupResult.isRefreshingTaskServices}
          onRefreshTaskServices={setupResult.refetchTaskServices}
          onConfirm={(nextDefinition, nextUserMessage) => {
            setReviewedDefinition(nextDefinition);
            setUserMessage(nextUserMessage);
            setConfirmed(true);
          }}
        />
      </DataStateBoundary>
    );
  }

  if (lifecycle.state.status === "error") {
    return (
      <Alert
        severity="error"
        data-testid="plan-stage-task-monitor-create-error"
      >
        {lifecycle.state.message}
      </Alert>
    );
  }

  if (
    lifecycle.state.status === "creating" ||
    lifecycle.state.status === "linking"
  ) {
    return (
      <Stack
        alignItems="center"
        spacing={2}
        sx={{ py: 8 }}
        data-testid="plan-stage-task-monitor-create-pending"
      >
        <CircularProgress />
        <Typography color="text.secondary">
          {lifecycle.state.status === "creating"
            ? "Creating a new Task Monitor…"
            : "Linking the Task Monitor to this Plan Stage…"}
        </Typography>
      </Stack>
    );
  }

  return (
    <Alert severity="success" data-testid="plan-stage-task-monitor-ready">
      Task Monitor ready.
    </Alert>
  );
};
