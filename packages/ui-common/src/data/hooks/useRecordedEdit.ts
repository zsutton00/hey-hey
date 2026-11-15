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
  const { agentSession } = useAgentSession(
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
    const readDetail = async (): Promise<void> => {
      const owningMachineId = agentSession?.machineId ?? null;
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
    agentSession?.machineId,
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
