import { useEffect, useRef } from "react";
import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import type { TaskMonitorExecutionDefinition } from "../../api";
import { PlanStageTaskMonitorLaunchView } from "./PlanStageTaskMonitorLaunchView";
import type { UsePlanStageTaskMonitorSetupOptions } from "./usePlanStageTaskMonitorSetup";
import { usePlanStageTaskMonitorSetup } from "./usePlanStageTaskMonitorSetup";
import { usePlanStageTaskMonitorCreateOrReopen } from "./usePlanStageTaskMonitorCreateOrReopen";
import type { PlanStageTaskMonitorSetupDraft } from "./planStageTaskMonitorSetup";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { ModelSelectorMachineSelection } from "../AgentSession/ModelSelector";

export interface PlanStageTaskMonitorCreateOrReopenProps extends UsePlanStageTaskMonitorSetupOptions {
  onMonitorReady: (monitorId: string) => void;
}

/**
 * The monitor every eligible task in the stage starts with: the draft's
 * seeded per-task setup and Review mode, on the Plan's worktree branch when
 * the Plan configures one. Everything else is set in the workspace.
 */
const initialDefinitionFor = (
  draft: PlanStageTaskMonitorSetupDraft,
): TaskMonitorExecutionDefinition => {
  const branch =
    draft.provenance.planWorktreeBranch ??
    draft.definition.launchPolicy.worktree?.branch ??
    null;
  if (branch === null) {
    const { worktree: _worktree, ...launchPolicy } =
      draft.definition.launchPolicy;
    return { ...draft.definition, launchPolicy };
  }
  return {
    ...draft.definition,
    launchPolicy: {
      ...draft.definition.launchPolicy,
      worktree: { enabled: true, branch },
    },
  };
};

export const PlanStageTaskMonitorCreateOrReopen = ({
  onMonitorReady,
  ...setupOptions
}: PlanStageTaskMonitorCreateOrReopenProps) => {
  const setupResult = usePlanStageTaskMonitorSetup(setupOptions);
  const draft =
    setupResult.state.status === "ready" ? setupResult.state.draft : null;
  // Fixed once per source: the catalog settling or services refreshing must
  // not produce a second definition and with it a second monitor.
  const sourceIdentity = draft
    ? [
        draft.provenance.organizationId,
        draft.provenance.projectId,
        draft.provenance.planId,
        draft.provenance.planParentTaskId,
        draft.provenance.stageId,
      ].join(":")
    : null;
  const definitionBySource = useRef<{
    identity: string;
    definition: TaskMonitorExecutionDefinition;
  } | null>(null);
  if (
    draft &&
    sourceIdentity &&
    definitionBySource.current?.identity !== sourceIdentity
  ) {
    definitionBySource.current = {
      identity: sourceIdentity,
      definition: initialDefinitionFor(draft),
    };
  }
  const definition = draft
    ? (definitionBySource.current?.definition ?? null)
    : null;

  const lifecycle = usePlanStageTaskMonitorCreateOrReopen({
    ...setupOptions,
    planLabel: draft?.provenance.planLabel ?? "",
    planParentTaskId: draft?.provenance.planParentTaskId ?? "",
    stageLabel: draft?.provenance.stageLabel ?? "",
    definition,
    enabled: draft !== null,
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

  if (setupResult.state.status !== "ready") {
    return (
      <DataStateBoundary
        loading={setupResult.isLoading}
        fetched={setupResult.isFetched}
      >
        <ModelSelectorMachineSelection
          testIdPrefix="plan-stage-task-monitor"
          machineSelection={setupResult.machineSelection}
        />
        <PlanStageTaskMonitorLaunchView
          state={setupResult.state}
          onContinue={() => undefined}
        />
      </DataStateBoundary>
    );
  }

  if (
    lifecycle.state.status === "error" ||
    lifecycle.state.status === "blocked"
  ) {
    return (
      <Alert
        severity="error"
        data-testid="plan-stage-task-monitor-create-error"
      >
        {lifecycle.state.message}
      </Alert>
    );
  }

  return (
    <Stack
      alignItems="center"
      spacing={2}
      sx={{ py: 8 }}
      data-testid="plan-stage-task-monitor-create-pending"
    >
      <CircularProgress />
      <Typography color="text.secondary">
        {lifecycle.state.status === "linking"
          ? "Linking the Task Monitor to this Plan Stage…"
          : lifecycle.state.status === "created"
            ? "Opening the Task Monitor…"
            : "Creating a new Task Monitor…"}
      </Typography>
    </Stack>
  );
};
