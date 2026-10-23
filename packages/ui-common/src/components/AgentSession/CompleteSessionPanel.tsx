import { Button, Stack, Typography } from "@mui/material";
import { useState } from "react";
import {
  ValidationLaunchContextScopeEnum,
  WorkStatus,
  type AgentSessionDto,
} from "../../api";
import { useActionsCapsule } from "../ActionsCapsule";
import { useValidationLauncher } from "./useValidationLauncher";

interface CompleteSessionPanelProps {
  taskId: string;
  currentStatus: WorkStatus;
  onUpdateStatus: (
    taskId: string,
    update: { status: WorkStatus }
  ) => Promise<void>;
  onCompleteSessionOnly?: () => Promise<void>;
  onPanelComplete?: () => Promise<void> | void;
  onValidationSessionCreated?: (session: AgentSessionDto) => void;
  organizationId?: string;
  projectId?: string;
}

type PanelView = "status" | "validation-offer";

export const CompleteSessionPanel = ({
  taskId,
  currentStatus,
  onUpdateStatus,
  onCompleteSessionOnly,
  onPanelComplete,
  onValidationSessionCreated,
  organizationId,
  projectId,
}: CompleteSessionPanelProps) => {
  const { collapseAction } = useActionsCapsule();
  const [updating, setUpdating] = useState<WorkStatus | "session-only" | null>(
    null
  );
  const [view, setView] = useState<PanelView>("status");

  const launcher = useValidationLauncher({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
    ...(onValidationSessionCreated
      ? { onSessionCreated: onValidationSessionCreated }
      : {}),
  });

  const canOfferValidation = Boolean(organizationId && projectId);
  const isVerifying = currentStatus === WorkStatus.Verifying;

  const finishAndCollapse = async () => {
    await onPanelComplete?.();
    collapseAction();
  };

  const handleSetStatus = async (status: WorkStatus) => {
    setUpdating(status);
    try {
      await onUpdateStatus(taskId, { status });
      if (status === WorkStatus.Verifying && canOfferValidation) {
        setView("validation-offer");
      } else {
        await finishAndCollapse();
      }
    } finally {
      setUpdating(null);
    }
  };

  const handleCompleteSessionOnly = async () => {
    setUpdating("session-only");
    try {
      await onCompleteSessionOnly?.();
      collapseAction();
    } finally {
      setUpdating(null);
    }
  };

  const handleStartValidation = async () => {
    await launcher.launch({
      scope: ValidationLaunchContextScopeEnum.Task,
      entityId: taskId,
      taskId,
    });
    await finishAndCollapse();
  };

  const isDisabled = updating !== null;

  if (view === "validation-offer") {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="subtitle2">Start validation?</Typography>
        <Typography variant="body2" color="text.secondary">
          The task is now verifying. Launch a validation session to review the
          work.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            size="small"
            disabled={launcher.isPending}
            onClick={() => void handleStartValidation()}
            data-testid="complete-session-start-validation"
          >
            {launcher.isPending ? "Starting..." : "Start validation"}
          </Button>
          <Button
            variant="text"
            size="small"
            disabled={launcher.isPending}
            onClick={() => void finishAndCollapse()}
            data-testid="complete-session-validation-done"
          >
            Done
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2">Update task status</Typography>
      <Stack direction="row" spacing={1}>
        {onCompleteSessionOnly && (
          <Button
            variant="outlined"
            size="small"
            disabled={isDisabled}
            onClick={() => void handleCompleteSessionOnly()}
            data-testid="complete-session-only"
          >
            {updating === "session-only"
              ? "Completing..."
              : "Coding Session Only"}
          </Button>
        )}
        {!isVerifying ? (
          <Button
            variant="outlined"
            size="small"
            disabled={isDisabled}
            onClick={() => void handleSetStatus(WorkStatus.Verifying)}
            data-testid="complete-session-set-verifying"
          >
            {updating === WorkStatus.Verifying
              ? "Setting..."
              : "Set Task Verifying"}
          </Button>
        ) : null}
        <Button
          variant="contained"
          size="small"
          disabled={isDisabled}
          onClick={() => void handleSetStatus(WorkStatus.Completed)}
          data-testid="complete-session-set-completed"
        >
          {updating === WorkStatus.Completed
            ? "Completing..."
            : "Set Task Complete"}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={isDisabled}
          onClick={() => collapseAction()}
          data-testid="complete-session-cancel"
        >
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
};
