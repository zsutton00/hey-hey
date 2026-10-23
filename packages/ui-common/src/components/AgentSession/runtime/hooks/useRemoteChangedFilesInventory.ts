import type { AxiosResponse } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CliReadRunChangedFilesInventoryRequestOperationEnum,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type CliReadChangedFileInventoryEntry,
  type CliReadErrorCode,
  type ReadAgentSessionCliState200Response,
} from "../../../../api";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useAgentSession } from "../../../../data/hooks/useAgentSession";
import { useControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import {
  createDirectoryBindingApi,
  LocalCliRequestError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../directoryBindingApi";

export type RemoteChangedFilesInventoryState =
  | { status: "idle"; entries: null; error: null; errorCode: null }
  | { status: "loading"; entries: null; error: null; errorCode: null }
  | {
      status: "success";
      entries: CliReadChangedFileInventoryEntry[];
      error: null;
      errorCode: null;
    }
  | {
      status: "unavailable";
      entries: null;
      error: string;
      errorCode: CliReadErrorCode | null;
    };

const idleState: RemoteChangedFilesInventoryState = {
  status: "idle",
  entries: null,
  error: null,
  errorCode: null,
};

export const useRemoteChangedFilesInventory = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
  open: boolean;
}): RemoteChangedFilesInventoryState & { retry: () => void } => {
  const [state, setState] =
    useState<RemoteChangedFilesInventoryState>(idleState);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const activeRequestRef = useRef(0);
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);
  const { agentSession } = useAgentSession(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    { enabled: params.open }
  );
  const { machines } = useUserPairedMachines();
  const { mutate: authorize } =
    useControllerAuthorizedAction<
      AxiosResponse<ReadAgentSessionCliState200Response>
    >();

  useEffect(() => {
    const requestGeneration = ++activeRequestRef.current;
    if (!params.open || !params.runId) {
      setState(idleState);
      return;
    }
    const runId = params.runId;
    setState({
      status: "loading",
      entries: null,
      error: null,
      errorCode: null,
    });
    const readInventory = async (): Promise<void> => {
      const owningMachineId = agentSession?.machineId ?? null;
      if (owningMachineId) {
        const localApi = createDirectoryBindingApi(
          resolveLocalDirectoryRuntimeBaseUrl()
        );
        let localMachineId: string | null = null;
        try {
          localMachineId = (await localApi.listRepos()).machineId;
        } catch {
          // An unreachable loopback CLI is expected on remote devices. The
          // protected platform read below remains authoritative there.
        }
        if (activeRequestRef.current !== requestGeneration) return;
        if (localMachineId === owningMachineId) {
          // Same-machine exception: once the reached CLI is the Run's owner,
          // loopback is the only transport. Failures surface as typed errors
          // and never switch to the remote read.
          try {
            const response = await localApi.readRunChangedFilesInventory(
              runId,
              localMachineId
            );
            if (activeRequestRef.current !== requestGeneration) return;
            setState({
              status: "success",
              entries: response.result.entries,
              error: null,
              errorCode: null,
            });
          } catch (error) {
            if (activeRequestRef.current !== requestGeneration) return;
            setState({
              status: "unavailable",
              entries: null,
              error:
                error instanceof Error && error.message
                  ? error.message
                  : "The local CLI inventory read failed.",
              errorCode:
                error instanceof LocalCliRequestError ? error.code : null,
            });
          }
          return;
        }
      }

      const machine = machines.find(
        (candidate) => candidate.machineId === owningMachineId
      );
      if (!machine) {
        setState({
          status: "unavailable",
          entries: null,
          error:
            "The execution machine for this protected read is unavailable.",
          errorCode: null,
        });
        return;
      }
      try {
        const response = await authorize({
          cause: {
            operation:
              "read the changed-file inventory from the connected computer",
            purpose: "List files changed by this coding session.",
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
          submit: ({ authorization }) =>
            unifiedApiClient.readAgentSessionCliState({
              organizationId: params.organizationId,
              projectId: params.projectId,
              agentSessionId: params.agentSessionId,
              cliReadRequestDto: {
                operation:
                  CliReadRunChangedFilesInventoryRequestOperationEnum.RunChangedFilesInventory,
                runId,
                authorization,
              },
            }),
        });
        if (activeRequestRef.current !== requestGeneration) return;
        if (response.outcome === "DENIED") {
          setState({
            status: "unavailable",
            entries: null,
            error: "The controller denied this protected read.",
            errorCode: null,
          });
          return;
        }
        const result = response.data.data.data;
        if (!result || result.operation !== "run.changed_files.inventory") {
          setState({
            status: "unavailable",
            entries: null,
            error: result
              ? "The CLI returned a different read result."
              : "The CLI read returned no result.",
            errorCode: null,
          });
        } else if ("error" in result) {
          setState({
            status: "unavailable",
            entries: null,
            error: result.error.message,
            errorCode: result.error.code,
          });
        } else {
          setState({
            status: "success",
            entries: result.result.entries,
            error: null,
            errorCode: null,
          });
        }
      } catch (error) {
        if (activeRequestRef.current === requestGeneration)
          setState({
            status: "unavailable",
            entries: null,
            error:
              error instanceof Error && error.message
                ? error.message
                : "The CLI read failed.",
            errorCode: null,
          });
      }
    };
    void readInventory();
    return () => {
      activeRequestRef.current += 1;
    };
  }, [
    agentSession?.machineId,
    authorize,
    machines,
    params.agentSessionId,
    params.open,
    params.organizationId,
    params.projectId,
    params.runId,
    retryGeneration,
  ]);

  return { ...state, retry };
};
