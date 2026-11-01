import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  runContextUsageCache,
  runContextUsageKey,
} from "../RunContextUsageCache";
import type {
  RunContextUsageState,
  RunContextUsageOutcome,
} from "../runContextUsageState";
export type { RunContextUsageState } from "../runContextUsageState";
import type { AxiosResponse } from "axios";
import {
  CliReadRunContextUsageGetRequestOperationEnum,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type ReadAgentSessionCliState200Response,
} from "../../../../api";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useAgentSession } from "../../../../data/hooks/useAgentSession";
import { useControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";

export const useRunContextUsage = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string;
  providerSessionId?: string;
  enabled: boolean;
}): RunContextUsageState & { retry: () => void } => {
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);
  const generation = useSyncExternalStore(
    runContextUsageCache.subscribe,
    runContextUsageCache.getGeneration,
    runContextUsageCache.getGeneration,
  );
  const key = params.providerSessionId
    ? runContextUsageKey({
        ...params,
        providerSessionId: params.providerSessionId,
      })
    : null;
  const getSnapshot = useCallback(
    () => runContextUsageCache.getSnapshot(key),
    [key],
  );
  const state = useSyncExternalStore(
    runContextUsageCache.subscribe,
    getSnapshot,
    getSnapshot,
  );
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
  const machine = machines.find(
    (candidate) => candidate.machineId === agentSession?.machineId,
  );

  useEffect(() => {
    if (!params.enabled || !params.providerSessionId) return;
    const identity = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      agentSessionId: params.agentSessionId,
      runId: params.runId,
      providerSessionId: params.providerSessionId,
    };
    void runContextUsageCache.refresh(
      identity,
      async (): Promise<RunContextUsageOutcome> => {
        if (!machine) {
          return {
            error:
              "The execution machine for this protected read is unavailable.",
            errorCode: null,
          };
        }
        const controllerReadInputs = {
          operation:
            CliReadRunContextUsageGetRequestOperationEnum.RunContextUsageGet,
          runId: identity.runId,
          providerSessionId: identity.providerSessionId,
        } as const;
        const response = await authorize({
          cause: {
            operation: "read context usage from the connected computer",
            purpose: "Show context-window usage for this coding session.",
          },
          organizationId: identity.organizationId,
          projectId: identity.projectId,
          machine,
          action: {
            requestId: crypto.randomUUID(),
            actionCategory: HostActionCategory.CliRead,
            actionType: HostAffectingActionType.CliRead,
            targetKind: HostActionTargetKind.AgentSession,
            targetId: identity.agentSessionId,
            inputs: {
              kind: "CLI_READ",
              body: {
                requestId: crypto.randomUUID(),
                agentSessionId: identity.agentSessionId,
                ...controllerReadInputs,
              },
            },
          },
          submit: ({ authorization }) =>
            unifiedApiClient.readAgentSessionCliState({
              organizationId: identity.organizationId,
              projectId: identity.projectId,
              agentSessionId: identity.agentSessionId,
              cliReadRequestDto: { ...controllerReadInputs, authorization },
            }),
        });
        if (response.outcome === "DENIED") {
          return {
            error: "The controller denied this protected read.",
            errorCode: null,
          };
        }
        const result = response.data.data.data;
        if (!result || result.operation !== "run.context_usage.get") {
          return {
            error: "The connected computer returned a different read result.",
            errorCode: null,
          };
        }
        if ("error" in result) {
          return { error: result.error.message, errorCode: result.error.code };
        }
        return { data: result.result };
      },
    );
  }, [
    authorize,
    machine,
    params.enabled,
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    params.runId,
    params.providerSessionId,
    retryGeneration,
    generation,
  ]);

  return { ...state, retry };
};
