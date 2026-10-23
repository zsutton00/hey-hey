import { useCallback, useEffect, useState } from "react";
import type {
  AgentSkillCatalogEntry,
  AgentSkillCatalogContext,
  CliReadErrorCode,
  CliReadWorkspaceSkillsListSuccessResponseDtoResult,
  AgentSkillDiscoveryError,
  AgentSkillProvider,
} from "../../../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../../../api";
import { agentSessionsClient } from "../../../../clients";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import { executeControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";

export type AgentSkillsCatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      catalog: CliReadWorkspaceSkillsListSuccessResponseDtoResult;
    }
  | {
      status: "empty";
      catalog: CliReadWorkspaceSkillsListSuccessResponseDtoResult;
    }
  | {
      status: "discovery-error";
      errors: readonly AgentSkillDiscoveryError[];
    }
  | { status: "bridge-unavailable"; message: string }
  | {
      status: "read-error";
      message: string;
      code: CliReadErrorCode;
      retryable: boolean;
    };

interface CatalogBaseOptions {
  enabled: boolean;
  organizationId: string;
  projectId: string;
  machineId: string;
  provider: AgentSkillProvider;
}
export type AgentSkillsCatalogOptions = CatalogBaseOptions &
  (
    | { agentSessionId: string; runId: string }
    | { catalogContext: AgentSkillCatalogContext }
  );

export interface AgentSkillsCatalogResult {
  state: AgentSkillsCatalogState;
  reload: () => void;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "The installed Skill catalog could not be loaded.";

const toCatalogState = (
  catalog: CliReadWorkspaceSkillsListSuccessResponseDtoResult
): AgentSkillsCatalogState => {
  if (catalog.errors.length > 0 && catalog.skills.length === 0) {
    return { status: "discovery-error", errors: catalog.errors };
  }
  if (catalog.skills.length === 0) {
    return { status: "empty", catalog };
  }
  return { status: "ready", catalog };
};

export function useAgentSkillsCatalog(
  options: AgentSkillsCatalogOptions
): AgentSkillsCatalogResult {
  const { enabled, organizationId, projectId, machineId, provider } = options;
  const agentSessionId = "runId" in options ? options.agentSessionId : null;
  const runId = "runId" in options ? options.runId : null;
  const catalogPolicy =
    "catalogContext" in options ? options.catalogContext.policy : null;
  const catalogServiceId =
    "catalogContext" in options &&
    options.catalogContext.policy === "service_workspace"
      ? options.catalogContext.serviceId
      : null;

  const machinesQuery = useUserPairedMachines({ enabled });
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<AgentSkillsCatalogState>({
    status: "idle",
  });

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let isCurrent = true;

    if (!enabled) {
      setState({ status: "idle" });
      return () => {
        isCurrent = false;
      };
    }

    if (provider !== "codex") {
      setState({
        status: "bridge-unavailable",
        message:
          "Installed Skills are currently available for Codex sessions only.",
      });
      return () => {
        isCurrent = false;
      };
    }

    if (machinesQuery.isLoading || !machinesQuery.isFetched) {
      setState({ status: "loading" });
      return () => {
        isCurrent = false;
      };
    }

    if (machinesQuery.error) {
      setState({
        status: "bridge-unavailable",
        message: "The execution machine is unavailable.",
      });
      return () => {
        isCurrent = false;
      };
    }

    const machine = machinesQuery.machines.find(
      (candidate) => candidate.machineId === machineId
    );
    if (!machine) {
      setState({
        status: "bridge-unavailable",
        message: "The execution machine for this session is unavailable.",
      });
      return () => {
        isCurrent = false;
      };
    }

    const requestId = crypto.randomUUID();
    setState({ status: "loading" });

    const catalogContext: AgentSkillCatalogContext =
      catalogPolicy === "service_workspace" && catalogServiceId
        ? { policy: "service_workspace", serviceId: catalogServiceId }
        : { policy: "non_repository" };
    const read =
      agentSessionId && runId
        ? executeControllerAuthorizedAction({
            organizationId,
            projectId,
            machine,
            action: {
              requestId,
              actionCategory: HostActionCategory.CliRead,
              actionType: HostAffectingActionType.CliRead,
              targetKind: HostActionTargetKind.AgentSession,
              targetId: agentSessionId,
            },
            submit: ({ authorization }) =>
              agentSessionsClient.readAgentSessionCliState({
                organizationId,
                projectId,
                agentSessionId,
                cliReadRequestDto: {
                  operation: "run.skills.list",
                  runId,
                  authorization,
                },
              }),
          })
        : executeControllerAuthorizedAction({
            organizationId,
            projectId,
            machine,
            action: {
              requestId,
              actionCategory: "CLI_READ",
              actionType: "CLI_READ",
              targetKind: "CLI_READ",
              targetId: machineId,
              provider,
              catalogContext,
            },
            submit: ({ authorization }) =>
              agentSessionsClient.listWorkspaceSkills({
                organizationId,
                projectId,
                machineId,
                cliReadWorkspaceSkillsListRequest: {
                  operation: "workspace.skills.list",
                  provider,
                  catalogContext,
                  authorization,
                },
              }),
          });
    void read
      .then((authorized) => {
        if (!isCurrent) return;
        if (authorized.outcome === "DENIED") {
          setState({
            status: "bridge-unavailable",
            message: `Controller authorization denied: ${authorized.reason}`,
          });
          return;
        }

        const response = authorized.data.data.data;
        if (
          !response ||
          (response.operation !== "run.skills.list" &&
            response.operation !== "workspace.skills.list")
        ) {
          throw new Error("The Skill catalog returned an unexpected response.");
        }
        if (response.status === "error") {
          setState({
            status: "read-error",
            code: response.error.code,
            message: response.error.message,
            retryable: [
              "CATALOG_BUSY",
              "TIMEOUT",
              "PROVIDER_FAILURE",
              "READ_FAILED",
              "NO_RECIPIENT",
            ].includes(response.error.code),
          });
          return;
        }
        setState(toCatalogState(response.result));
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setState({
          status: "bridge-unavailable",
          message: getErrorMessage(error),
        });
      });

    return () => {
      isCurrent = false;
    };
  }, [
    agentSessionId,
    catalogPolicy,
    catalogServiceId,
    enabled,
    machinesQuery.error,
    machinesQuery.isFetched,
    machinesQuery.isLoading,
    machinesQuery.machines,
    organizationId,
    projectId,
    provider,
    reloadCount,
    runId,
    machineId,
  ]);

  return { state, reload };
}

export const skillSelectionFromCatalogEntry = (
  entry: AgentSkillCatalogEntry
) => ({
  provider: entry.provider,
  name: entry.name,
  catalogScope: entry.catalogScope,
});
