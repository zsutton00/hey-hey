import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosResponse } from "axios";
import {
  CliReadRunChangedFilesCountRequestOperationEnum,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type CliReadErrorCode,
  type ReadAgentSessionCliState200Response,
} from "../../../../api";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useAgentSession } from "../../../../data/hooks/useAgentSession";
import { useControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import {
  isRetryableCliReadError,
  type FeedbackFailureIdentity,
  type RemoteFailureRecord,
} from "../../codingSessionFeedback";
import {
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "../../../../data/controllerAuthorization/webauthnAssertion";

type RemoteChangedFilesCountFailure = RemoteFailureRecord;

const NON_RETRYABLE_CONTROLLER_FAILURE_CODES: readonly ControllerAuthorizationClientFailureCode[] =
  [
    ControllerAuthorizationClientFailureCode.InvalidCredential,
    ControllerAuthorizationClientFailureCode.UnsupportedWebAuthn,
    ControllerAuthorizationClientFailureCode.UserCancelled,
    ControllerAuthorizationClientFailureCode.ConfirmationDeclined,
  ];

export type RemoteChangedFilesCountState =
  | {
      status: "skipped";
      count: null;
      error: null;
      errorCode: null;
      readIdentity: null;
      retryGeneration: number;
    }
  | {
      status: "loading";
      count: null;
      error: null;
      errorCode: null;
      readIdentity: string | null;
      retryGeneration: number;
      previousFailure: RemoteChangedFilesCountFailure | null;
    }
  | {
      status: "success";
      count: number;
      error: null;
      errorCode: null;
      readIdentity: string;
      retryGeneration: number;
    }
  | {
      status: "unavailable";
      count: null;
      error: string;
      errorCode: CliReadErrorCode | null;
      retryable: boolean;
      failureIdentity: FeedbackFailureIdentity;
      readIdentity: string | null;
      retryGeneration: number;
    };

const skippedState: RemoteChangedFilesCountState = {
  status: "skipped",
  count: null,
  error: null,
  errorCode: null,
  readIdentity: null,
  retryGeneration: 0,
};

export const useRemoteChangedFilesCount = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
  enabled: boolean;
}): RemoteChangedFilesCountState & { retry: () => void } => {
  const [state, setState] =
    useState<RemoteChangedFilesCountState>(skippedState);
  const [attempt, setAttempt] = useState(0);
  const retryGenerationRef = useRef(0);
  const lastFailureRef = useRef<RemoteChangedFilesCountFailure | null>(null);
  const startedAttemptRef = useRef<{
    readIdentity: string;
    retryGeneration: number;
  } | null>(null);
  const currentAttemptRef = useRef<{
    readIdentity: string;
    retryGeneration: number;
  } | null>(null);
  const effectMountedRef = useRef(false);
  const retry = useCallback(() => {
    const nextRetryGeneration = retryGenerationRef.current + 1;
    retryGenerationRef.current = nextRetryGeneration;
    startedAttemptRef.current = null;
    currentAttemptRef.current = null;
    const previousFailure = lastFailureRef.current;
    if (previousFailure) {
      setState({
        status: "loading",
        count: null,
        error: null,
        errorCode: null,
        readIdentity:
          "readIdentity" in previousFailure.failureIdentity
            ? previousFailure.failureIdentity.readIdentity
            : null,
        retryGeneration: nextRetryGeneration,
        previousFailure,
      });
    }
    setAttempt(nextRetryGeneration);
  }, []);
  const { agentSession } = useAgentSession(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    { enabled: params.enabled },
  );
  const { machines } = useUserPairedMachines();
  const { mutate: authorize } =
    useControllerAuthorizedAction<
      AxiosResponse<ReadAgentSessionCliState200Response>
    >();

  useEffect(() => {
    effectMountedRef.current = true;
    const cleanup = () => {
      effectMountedRef.current = false;
    };

    if (!params.enabled || !params.runId) {
      startedAttemptRef.current = null;
      currentAttemptRef.current = null;
      lastFailureRef.current = null;
      retryGenerationRef.current = 0;
      setAttempt(0);
      setState(skippedState);
      return cleanup;
    }
    const runId = params.runId;

    const machine = machines.find(
      (candidate) => candidate.machineId === agentSession?.machineId,
    );
    if (!machine) {
      const reason =
        "The execution machine for this protected read is unavailable.";
      const failure: RemoteChangedFilesCountFailure = {
        reason,
        errorCode: null,
        retryable: true,
        failureIdentity: { reason: `${reason}:${String(attempt)}` },
      };
      lastFailureRef.current = failure;
      startedAttemptRef.current = null;
      currentAttemptRef.current = null;
      setState({
        status: "unavailable",
        count: null,
        error: reason,
        errorCode: null,
        retryable: failure.retryable,
        failureIdentity: failure.failureIdentity,
        readIdentity: null,
        retryGeneration: attempt,
      });
      return cleanup;
    }

    const readIdentity = [params.agentSessionId, runId, machine.machineId].join(
      ":",
    );
    const startedAttempt = startedAttemptRef.current;
    if (
      startedAttempt?.readIdentity === readIdentity &&
      startedAttempt.retryGeneration === attempt
    ) {
      // Keep the original request eligible to publish its result after an
      // effect cleanup/replay (including StrictMode's development replay).
      return cleanup;
    }
    const currentAttempt = {
      readIdentity,
      retryGeneration: attempt,
    };
    startedAttemptRef.current = currentAttempt;
    currentAttemptRef.current = currentAttempt;

    setState({
      status: "loading",
      count: null,
      error: null,
      errorCode: null,
      readIdentity,
      retryGeneration: attempt,
      previousFailure:
        lastFailureRef.current &&
        "readIdentity" in lastFailureRef.current.failureIdentity &&
        lastFailureRef.current.failureIdentity.readIdentity === readIdentity
          ? lastFailureRef.current
          : null,
    });
    void authorize({
      cause: {
        operation:
          "read the current changed-file count from the connected computer",
        purpose: "Show the current changed files for this coding session.",
      },
      organizationId: params.organizationId,
      projectId: params.projectId,
      machine,
      action: {
        requestId: crypto.randomUUID(),
        actionCategory: HostActionCategory.CliRead,
        actionType: HostAffectingActionType.CliRead,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: params.agentSessionId,
      },
      submit: ({ authorization: admission }) =>
        unifiedApiClient.readAgentSessionCliState({
          organizationId: params.organizationId,
          projectId: params.projectId,
          agentSessionId: params.agentSessionId,
          cliReadRequestDto: {
            operation:
              CliReadRunChangedFilesCountRequestOperationEnum.RunChangedFilesCount,
            runId,
            authorization: admission,
          },
        }),
    })
      .then((response) => {
        if (
          !effectMountedRef.current ||
          currentAttemptRef.current !== currentAttempt
        ) {
          return;
        }
        if (response.outcome === "DENIED") {
          const failure: RemoteChangedFilesCountFailure = {
            reason: "The controller denied this protected read.",
            errorCode: null,
            retryable: response.retryable,
            failureIdentity: currentAttempt,
          };
          lastFailureRef.current = failure;
          setState({
            status: "unavailable",
            count: null,
            error: failure.reason,
            errorCode: null,
            retryable: failure.retryable,
            failureIdentity: failure.failureIdentity,
            readIdentity,
            retryGeneration: attempt,
          });
          return;
        }
        const result = response.data.data.data;
        if (!result) {
          const failure: RemoteChangedFilesCountFailure = {
            reason: "The CLI read returned no result.",
            errorCode: null,
            retryable: true,
            failureIdentity: currentAttempt,
          };
          lastFailureRef.current = failure;
          setState({
            status: "unavailable",
            count: null,
            error: failure.reason,
            errorCode: null,
            retryable: failure.retryable,
            failureIdentity: failure.failureIdentity,
            readIdentity,
            retryGeneration: attempt,
          });
          return;
        }
        if (result.operation !== "run.changed_files.count") {
          const failure: RemoteChangedFilesCountFailure = {
            reason: "The CLI returned a different read result.",
            errorCode: null,
            retryable: false,
            failureIdentity: currentAttempt,
          };
          lastFailureRef.current = failure;
          setState({
            status: "unavailable",
            count: null,
            error: failure.reason,
            errorCode: null,
            retryable: failure.retryable,
            failureIdentity: failure.failureIdentity,
            readIdentity,
            retryGeneration: attempt,
          });
          return;
        }
        if ("error" in result) {
          const failure: RemoteChangedFilesCountFailure = {
            reason: result.error.message,
            errorCode: result.error.code,
            retryable: isRetryableCliReadError(result.error.code),
            failureIdentity: currentAttempt,
          };
          lastFailureRef.current = failure;
          setState({
            status: "unavailable",
            count: null,
            error: failure.reason,
            errorCode: failure.errorCode,
            retryable: failure.retryable,
            failureIdentity: failure.failureIdentity,
            readIdentity,
            retryGeneration: attempt,
          });
          return;
        }
        lastFailureRef.current = null;
        setState({
          status: "success",
          count: result.result.changedFilesCount,
          error: null,
          errorCode: null,
          readIdentity,
          retryGeneration: attempt,
        });
      })
      .catch((error: unknown) => {
        if (
          !effectMountedRef.current ||
          currentAttemptRef.current !== currentAttempt
        ) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "The CLI read failed.";
        const retryable =
          !(error instanceof ControllerAuthorizationClientError) ||
          !NON_RETRYABLE_CONTROLLER_FAILURE_CODES.includes(error.code);
        const failure: RemoteChangedFilesCountFailure = {
          reason: message || "The CLI read failed.",
          errorCode: null,
          retryable,
          failureIdentity: currentAttempt,
        };
        lastFailureRef.current = failure;
        setState({
          status: "unavailable",
          count: null,
          error: failure.reason,
          errorCode: null,
          retryable: failure.retryable,
          failureIdentity: failure.failureIdentity,
          readIdentity,
          retryGeneration: attempt,
        });
      });

    return cleanup;
  }, [
    attempt,
    params.agentSessionId,
    params.enabled,
    params.organizationId,
    params.projectId,
    params.runId,
    agentSession?.machineId,
    machines,
    authorize,
  ]);

  return { ...state, retry };
};
