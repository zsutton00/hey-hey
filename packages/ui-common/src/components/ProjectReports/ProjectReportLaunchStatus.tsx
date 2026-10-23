import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { MachineDto } from "../../api";
import { AgentBridgeRecoveryNotice } from "../AgentSession/AgentBridgeRecoveryNotice";
import type { AgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { MachinePicker } from "../AgentSession/MachinePicker";
import type { MachineResolutionMode } from "../AgentSession/runtime/coding/useMachineResolution";
import { getMachineExecutionLabel } from "../AgentSession/runtime/coding/machineExecutionReadiness";
import type { ProjectReportLaunchStatusView } from "./projectReportRequestState";

export interface ProjectReportMachineSectionProps {
  isReady: boolean;
  mode: MachineResolutionMode;
  machines: MachineDto[];
  selectedMachine: MachineDto | null;
  recoveryState: AgentBridgeRecoveryState;
  disabled: boolean;
  onSelectMachine: (machineId: string) => void;
}

/**
 * Reports need a reachable CLI. Repository availability is shown in the picker.
 * One ready CLI is used automatically; several require a choice.
 */
export const ProjectReportMachineSection = ({
  isReady,
  mode,
  machines,
  selectedMachine,
  recoveryState,
  disabled,
  onSelectMachine,
}: ProjectReportMachineSectionProps) => {
  if (!isReady) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        role="status"
        data-testid="project-report-machine-loading"
      >
        Checking for a ready CLI…
      </Typography>
    );
  }
  if (mode === "zero") {
    return (
      <Box data-testid="project-report-machine-unavailable">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No CLI is ready to generate this report. Your request is kept; start
          or reconnect a CLI and it will appear here.
        </Typography>
        {machines.length > 0 ? (
          <MachinePicker
            machines={machines}
            selectedMachineId={null}
            onSelect={onSelectMachine}
            disabled={disabled}
            mobileMode="editor"
          />
        ) : (
          <AgentBridgeRecoveryNotice
            state={recoveryState}
            presentation="inline"
            testId="project-report-machine-recovery"
          />
        )}
      </Box>
    );
  }
  if (mode === "one" && selectedMachine) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="project-report-machine-auto"
      >
        Generating with {getMachineExecutionLabel(selectedMachine)}
      </Typography>
    );
  }
  return (
    <MachinePicker
      machines={machines}
      selectedMachineId={selectedMachine?.machineId ?? null}
      onSelect={onSelectMachine}
      disabled={disabled}
      mobileMode="editor"
    />
  );
};

export interface ProjectReportLaunchStatusProps {
  view: ProjectReportLaunchStatusView | null;
  statusError: Error | null;
  isRetrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onOpenReport?: (reportId: string) => void;
}

const STATUS_COPY: Record<
  Exclude<ProjectReportLaunchStatusView["kind"], "failed" | "completed">,
  string
> = {
  queued: "Report request accepted. Waiting for the CLI to start…",
  running: "Generating your report…",
  completedWithoutReport:
    "Generation finished, but the report is not available yet.",
};

export const ProjectReportLaunchStatus = ({
  view,
  statusError,
  isRetrying,
  retryError,
  onRetry,
  onOpenReport,
}: ProjectReportLaunchStatusProps) => (
  <Stack spacing={1} data-testid="project-report-launch-status">
    <Box role="status" aria-live="polite">
      {view === null ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2">Loading request status…</Typography>
        </Stack>
      ) : view.kind === "completed" ? (
        <Alert
          severity="success"
          data-testid="project-report-status-completed"
          action={
            onOpenReport ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => onOpenReport(view.reportId)}
                data-testid="project-report-open-report"
              >
                Open report
              </Button>
            ) : undefined
          }
        >
          Your report is ready.
        </Alert>
      ) : view.kind === "failed" ? (
        <Alert
          severity="error"
          data-testid="project-report-status-failed"
          action={
            view.retryable && view.attemptId ? (
              <Button
                color="inherit"
                size="small"
                onClick={onRetry}
                disabled={isRetrying}
                data-testid="project-report-retry-generation"
              >
                {isRetrying ? "Retrying…" : "Retry"}
              </Button>
            ) : undefined
          }
        >
          {view.message ?? "Report generation failed."}{" "}
          {view.retryable
            ? "Retry uses the same submitted question and scope."
            : "This failure cannot be retried."}
        </Alert>
      ) : (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          data-testid={`project-report-status-${view.kind}`}
        >
          {view.kind === "completedWithoutReport" ? null : (
            <CircularProgress size={16} />
          )}
          <Typography variant="body2">{STATUS_COPY[view.kind]}</Typography>
        </Stack>
      )}
    </Box>
    {statusError ? (
      <Typography variant="caption" color="text.secondary">
        Could not refresh the status. Retrying automatically.
      </Typography>
    ) : null}
    {retryError ? (
      <Alert severity="error" data-testid="project-report-retry-error">
        {retryError}
      </Alert>
    ) : null}
  </Stack>
);
