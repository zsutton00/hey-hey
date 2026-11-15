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
import { useAgentSession } from "./useAgentSession";
import { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";
import { useUserPairedMachines } from "./useUserPairedMachines";
import {
  createDirectoryBindingApi,
  LocalCliRequestError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../components/AgentSession/runtime/directoryBindingApi";

export type RecordedEditState =
  | { status: "idle"; file: null; error: null; errorCode: null }
  | { status: "loading"; file: null; error: null; errorCode: null }
  | {
      status: "success";
      file: CliReadChangedFileDetail;
      error: null;
      errorCode: null;
    }
  | {
      status: "unavailable";
      file: null;
      error: string;
      errorCode: CliReadErrorCode | null;
    };

const idleState: RecordedEditState = {
  status: "idle",
  file: null,
  error: null,
  errorCode: null,
};

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
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);
  const { agentSession, error: agentSessionError } = useAgentSession(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    { enabled: params.open && params.edit !== null },
  );
  const { machines } = useUserPairedMachines();
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

    setState({ status: "loading", file: null, error: null, errorCode: null });
    if (agentSessionError) {
      setState({
        status: "unavailable",
        file: null,
        error: `The session could not be loaded: ${agentSessionError.message}`,
        errorCode: null,
      });
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
                errorCode: null,
              });
              return;
            } catch (error) {
              if (activeRequestRef.current !== requestGeneration) return;
              if (!(error instanceof TypeError)) {
                setState({
                  status: "unavailable",
                  file: null,
                  error:
                    error instanceof Error
                      ? error.message
                      : "The local CLI recorded-edit read failed.",
                  errorCode:
                    error instanceof LocalCliRequestError ? error.code : null,
                });
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
          setState({
            status: "unavailable",
            file: null,
            error:
              "The execution machine for this protected read is unavailable.",
            errorCode: null,
          });
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
          setState({
            status: "unavailable",
            file: null,
            error: "The controller denied this protected read.",
            errorCode: null,
          });
          return;
        }
        const result = response.data.data.data;
        if (!result || result.operation !== "run.recorded_edit.read") {
          setState({
            status: "unavailable",
            file: null,
            error: result
              ? "The CLI returned a different read result."
              : "The CLI read returned no result.",
            errorCode: null,
          });
        } else if ("error" in result) {
          setState({
            status: "unavailable",
            file: null,
            error: result.error.message,
            errorCode: result.error.code,
          });
        } else {
          setState({
            status: "success",
            file: result.result.file,
            error: null,
            errorCode: null,
          });
        }
      } catch (error) {
        if (activeRequestRef.current === requestGeneration)
          setState({
            status: "unavailable",
            file: null,
            error:
              error instanceof Error && error.message
                ? error.message
                : "The CLI read failed.",
            errorCode: null,
          });
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
