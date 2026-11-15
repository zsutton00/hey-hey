import type { AxiosResponse } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type CliReadChangedFileDetail,
  type ImplementReportEdit,
  type CliReadErrorCode,
  type ReadAgentSessionCliState200Response,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { logger } from "../../utils/logger";
import { useAgentSession } from "./useAgentSession";
import { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";
import { useUserPairedMachines } from "./useUserPairedMachines";
import {
  createDirectoryBindingApi,
  LocalCliRequestError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../components/AgentSession/runtime/directoryBindingApi";

export type RecordedEditUnavailableCause =
  | { kind: "session-unavailable" }
  | { kind: "machine-unreachable" }
  | { kind: "denied" }
  | { kind: "read-error"; code: CliReadErrorCode }
  | { kind: "unexpected" };

export type RecordedEditState =
  | { status: "idle"; file: null; error: null; cause: null }
  | { status: "loading"; file: null; error: null; cause: null }
  | {
      status: "success";
      file: CliReadChangedFileDetail;
      error: null;
      cause: null;
    }
  | {
      status: "unavailable";
      file: null;
      error: string;
      cause: RecordedEditUnavailableCause;
    };

const idleState: RecordedEditState = {
  status: "idle",
  file: null,
  error: null,
  cause: null,
};

const unavailable = (
  cause: RecordedEditUnavailableCause,
  error: string,
): RecordedEditState => {
  logger.warn("data_hooks", "[useRecordedEdit] Recorded edit unavailable", {
    cause,
    error,
  });
  return { status: "unavailable", file: null, error, cause };
};

const readErrorCause = (
  code: CliReadErrorCode | null,
): RecordedEditUnavailableCause =>
  code ? { kind: "read-error", code } : { kind: "unexpected" };

export const useRecordedEdit = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
  serviceId: string | null;
  edit: ImplementReportEdit | null;
  open: boolean;
}): RecordedEditState & { retry: () => void } => {
  const [state, setState] = useState<RecordedEditState>(idleState);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const activeRequestRef = useRef(0);
  const {
    agentSession,
    error: agentSessionError,
    refetch: refetchSession,
  } = useAgentSession(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    { enabled: params.open && params.edit !== null },
  );
  const { machines, refetch: refetchMachines } = useUserPairedMachines();
  // Retry reloads what the failed read depended on first: a cached session error
  // would otherwise be returned again, and a machine that connected since the
  // list was read would stay unseen.
  const retry = useCallback(() => {
    setState({ status: "loading", file: null, error: null, cause: null });
    const prerequisite = agentSessionError
      ? refetchSession()
      : refetchMachines();
    void prerequisite
      .catch(() => undefined)
      .then(() => setRetryGeneration((value) => value + 1));
  }, [agentSessionError, refetchMachines, refetchSession]);
  const { mutate: authorize } =
    useControllerAuthorizedAction<
      AxiosResponse<ReadAgentSessionCliState200Response>
    >();
  const sessionLoaded = agentSession !== null;
  const owningMachineId = agentSession?.machineId ?? null;
  const serviceId = params.serviceId;
  const edit = params.edit;

  useEffect(() => {
    const requestGeneration = ++activeRequestRef.current;
    if (!params.open || !params.runId || !serviceId || !edit) {
      setState(idleState);
      return;
    }
    const runId = params.runId;

    setState({ status: "loading", file: null, error: null, cause: null });
    if (agentSessionError) {
      setState(
        unavailable(
          { kind: "session-unavailable" },
          `The session could not be loaded: ${agentSessionError.message}`,
        ),
      );
      return;
    }
    // Until the session loads, the machine that ran it is unknown. Stay
    // loading; this effect re-runs when the session arrives.
    if (!sessionLoaded) {
      return;
    }
    const readDetail = async (): Promise<void> => {
      if (owningMachineId) {
        // Same path order as the changed-file detail read: the CLI on this
        // computer answers directly when it ran the session.
        const localApi = createDirectoryBindingApi(
          resolveLocalDirectoryRuntimeBaseUrl(),
        );
        try {
          const localIdentity = await localApi.listRepos();
          if (activeRequestRef.current !== requestGeneration) return;
          if (localIdentity.machineId === owningMachineId) {
            try {
              const response = await localApi.readRunRecordedEdit(
                runId,
                localIdentity.machineId,
                serviceId,
                edit,
              );
              if (activeRequestRef.current !== requestGeneration) return;
              setState({
                status: "success",
                file: response.result.file,
                error: null,
                cause: null,
              });
              return;
            } catch (error) {
              if (activeRequestRef.current !== requestGeneration) return;
              if (!(error instanceof TypeError)) {
                setState(
                  unavailable(
                    readErrorCause(
                      error instanceof LocalCliRequestError ? error.code : null,
                    ),
                    error instanceof Error
                      ? error.message
                      : "The local CLI recorded-edit read failed.",
                  ),
                );
                return;
              }
              // The loopback route disappeared after discovery. Continue
              // through the protected remote path for this read.
            }
          }
        } catch {
          // An unreachable loopback CLI is expected on remote devices. The
          // protected platform read below remains authoritative there.
        }
      }

      const machine = machines.find(
        (candidate) => candidate.machineId === owningMachineId,
      );
      if (!machine) {
        if (activeRequestRef.current === requestGeneration) {
          setState(
            unavailable(
              { kind: "machine-unreachable" },
              "The execution machine for this protected read is unavailable.",
            ),
          );
        }
        return;
      }
      try {
        const controllerReadInputs = {
          operation: "run.recorded_edit.read",
          runId,
          serviceId,
          edit,
        } as const;
        const response = await authorize({
          cause: {
            operation: "read one changed file from the connected computer",
            purpose:
              "Show the selected file's complete before-and-after content.",
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
            inputs: {
              kind: "CLI_READ",
              body: {
                requestId: crypto.randomUUID(),
                agentSessionId: params.agentSessionId,
                ...controllerReadInputs,
              },
            },
          },
          submit: ({ authorization }) =>
            unifiedApiClient.readAgentSessionCliState({
              organizationId: params.organizationId,
              projectId: params.projectId,
              agentSessionId: params.agentSessionId,
              cliReadRequestDto: { ...controllerReadInputs, authorization },
            }),
        });
        if (activeRequestRef.current !== requestGeneration) return;
        if (response.outcome === "DENIED") {
          setState(
            unavailable(
              { kind: "denied" },
              "The controller denied this protected read.",
            ),
          );
          return;
        }
        const result = response.data.data.data;
        if (!result || result.operation !== "run.recorded_edit.read") {
          setState(
            unavailable(
              { kind: "unexpected" },
              result
                ? "The CLI returned a different read result."
                : "The CLI read returned no result.",
            ),
          );
        } else if ("error" in result) {
          setState(
            unavailable(
              readErrorCause(result.error.code),
              result.error.message,
            ),
          );
        } else {
          setState({
            status: "success",
            file: result.result.file,
            error: null,
            cause: null,
          });
        }
      } catch (error) {
        if (activeRequestRef.current === requestGeneration)
          setState(
            unavailable(
              { kind: "unexpected" },
              error instanceof Error && error.message
                ? error.message
                : "The CLI read failed.",
            ),
          );
      }
    };
    void readDetail();
    return () => {
      activeRequestRef.current += 1;
    };
  }, [
    owningMachineId,
    sessionLoaded,
    agentSessionError,
    authorize,
    edit,
    machines,
    params.agentSessionId,
    params.open,
    params.organizationId,
    params.projectId,
    params.runId,
    retryGeneration,
    serviceId,
  ]);

  return { ...state, retry };
};
