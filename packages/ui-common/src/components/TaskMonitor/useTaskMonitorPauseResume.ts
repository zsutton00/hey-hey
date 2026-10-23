import { useCallback, useRef, useState } from "react";
import {
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  TaskMonitorPauseCommandCauseEnum,
  TaskMonitorResumeCommandCauseEnum,
  type SubmitTaskMonitorCommandResponseDto,
  type TaskMonitorPauseCommand,
  type TaskMonitorResumeCommand,
} from "../../api";
import { useSubmitTaskMonitorCommand } from "../../data/hooks";
import type { SubmitTaskMonitorCommandVariables } from "../../data/hooks/useSubmitTaskMonitorCommand";

export type TaskMonitorPauseResumeAction = "PAUSE" | "RESUME";

export interface UseTaskMonitorPauseResumeOptions {
  organizationId: string;
  projectId: string;
  monitorId: string;
  machineId: string | null;
  reconcileProjection: () => Promise<void>;
}

export interface UseTaskMonitorPauseResumeResult {
  pendingAction: TaskMonitorPauseResumeAction | null;
  errorMessage: string | null;
  commandOutcome: SubmitTaskMonitorCommandResponseDto | null;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
}

const isCommandAcknowledgement = (
  value: SubmitTaskMonitorCommandResponseDto
): boolean =>
  typeof value.commandId === "string" &&
  Object.values(SubmitTaskMonitorCommandResponseDtoStatusEnum).includes(
    value.status
  );

interface BuildPauseResumeCommandVariablesOptions {
  action: TaskMonitorPauseResumeAction;
  organizationId: string;
  projectId: string;
  monitorId: string;
  machineId: string;
}

const buildPauseCommand = (): TaskMonitorPauseCommand => ({
  cause: TaskMonitorPauseCommandCauseEnum.Pause,
});

const buildResumeCommand = (): TaskMonitorResumeCommand => ({
  cause: TaskMonitorResumeCommandCauseEnum.Resume,
});

const buildPauseResumeCommandVariables = ({
  action,
  organizationId,
  projectId,
  monitorId,
  machineId,
}: BuildPauseResumeCommandVariablesOptions): SubmitTaskMonitorCommandVariables => {
  const requestId = crypto.randomUUID();
  if (action === "PAUSE") {
    return {
      organizationId,
      projectId,
      monitorId,
      request: { requestId, machineId, command: buildPauseCommand() },
    };
  }
  return {
    organizationId,
    projectId,
    monitorId,
    request: { requestId, machineId, command: buildResumeCommand() },
  };
};

const actionVerb = (action: TaskMonitorPauseResumeAction): string =>
  action === "PAUSE" ? "pausing" : "resuming";

export const useTaskMonitorPauseResume = ({
  organizationId,
  projectId,
  monitorId,
  machineId,
  reconcileProjection,
}: UseTaskMonitorPauseResumeOptions): UseTaskMonitorPauseResumeResult => {
  const [pendingAction, setPendingAction] =
    useState<TaskMonitorPauseResumeAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [commandOutcome, setCommandOutcome] =
    useState<SubmitTaskMonitorCommandResponseDto | null>(null);
  const inFlightAction = useRef<TaskMonitorPauseResumeAction | null>(null);
  const submitMonitorCommand = useSubmitTaskMonitorCommand();

  const submit = useCallback(
    async (action: TaskMonitorPauseResumeAction): Promise<boolean> => {
      if (inFlightAction.current !== null) return false;

      inFlightAction.current = action;
      setPendingAction(action);
      setErrorMessage(null);
      setCommandOutcome(null);
      try {
        if (!machineId) {
          throw new Error(
            `Select a connected, controller-authorized CLI machine before ${actionVerb(
              action
            )} the Task Monitor.`
          );
        }
        const outcome = await submitMonitorCommand.mutate(
          buildPauseResumeCommandVariables({
            action,
            organizationId,
            projectId,
            monitorId,
            machineId,
          })
        );
        if (!isCommandAcknowledgement(outcome)) {
          throw new Error(
            "The platform returned a malformed Task Monitor command acknowledgement."
          );
        }

        setCommandOutcome(outcome);
        if (
          outcome.status ===
          SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected
        ) {
          return false;
        }

        try {
          await reconcileProjection();
          return true;
        } catch (error) {
          setCommandOutcome(null);
          setErrorMessage(
            error instanceof Error
              ? `The ${action} command was acknowledged, but canonical Task Monitor data could not be refreshed. ${error.message}`
              : `The ${action} command was acknowledged, but canonical Task Monitor data could not be refreshed.`
          );
          return false;
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : `Task Monitor ${action} failed.`
        );
        return false;
      } finally {
        inFlightAction.current = null;
        setPendingAction(null);
      }
    },
    [
      machineId,
      monitorId,
      organizationId,
      projectId,
      reconcileProjection,
      submitMonitorCommand,
    ]
  );

  const pause = useCallback(() => submit("PAUSE"), [submit]);
  const resume = useCallback(() => submit("RESUME"), [submit]);

  return { pendingAction, errorMessage, commandOutcome, pause, resume };
};
