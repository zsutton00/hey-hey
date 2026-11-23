import { useCallback, useMemo, useState } from "react";
import {
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  type SubmitTaskMonitorCommandResponseDto,
  type TaskMonitorExecutionNodeLaunchConfiguration,
  type TaskMonitorRuntimeSelection,
  type TaskMonitorExecutionPlanNode,
  type TaskMonitorLaunchPolicy,
  type TaskMonitorLaunchConfig,
  type TaskMonitorStartCommand,
} from "../../api";
import { useSubmitTaskMonitorCommand } from "../../data/hooks";
import {
  type CapabilityCatalogLoadState,
  listEfforts,
  listModels,
  supportsFastMode,
} from "../AgentSession/capabilityCatalog";
import { useRuntimeModelCatalog } from "../AgentSession/useRuntimeModelCatalog";

export interface UseTaskMonitorStartOptions {
  organizationId: string;
  projectId: string;
  monitorId: string;
  machineId: string | null;
  userMessage?: string | null;
  launchNode: TaskMonitorExecutionPlanNode | null;
  launchPolicy: TaskMonitorLaunchPolicy | null;
  coordinatorRuntime: TaskMonitorRuntimeSelection | null;
  reconcileProjection: () => Promise<void>;
}

export interface UseTaskMonitorStartResult {
  isSubmitting: boolean;
  acceptedAwaitingRefresh: boolean;
  isCatalogLoading: boolean;
  isCatalogFetched: boolean;
  errorMessage: string | null;
  commandOutcome: SubmitTaskMonitorCommandResponseDto | null;
  start: () => Promise<boolean>;
}

const resolveWorktree = (
  launchPolicy: TaskMonitorLaunchPolicy,
): TaskMonitorLaunchConfig["worktree"] => {
  if (!launchPolicy.worktree) return undefined;
  if (launchPolicy.worktree.enabled !== true) {
    throw new Error("The saved Task Monitor worktree must be enabled.");
  }
  const branch = launchPolicy.worktree.branch?.trim();
  if (!branch) {
    throw new Error(
      "The saved Task Monitor worktree branch must be entered before Start.",
    );
  }
  return { enabled: true, branch };
};

/** A saved "Monitor runs on" choice must still be offered by the machine's catalog. */
const requireCoordinatorRuntimeInCatalog = (
  runtime: TaskMonitorRuntimeSelection | null,
  catalogState: CapabilityCatalogLoadState,
): void => {
  if (!runtime || catalogState.status !== "ready") {
    return;
  }
  const offered = listModels(runtime.provider).some(
    (model) => model.id === runtime.model,
  );
  if (!offered) {
    throw new Error(
      `Monitor runs on: ${runtime.provider} ${runtime.model} is not available in the runtime catalog. Choose another model.`,
    );
  }
  const efforts = listEfforts(runtime.provider, runtime.model);
  const effortIsValid =
    runtime.reasoningEffort === undefined
      ? efforts.length === 0
      : efforts.includes(runtime.reasoningEffort);
  if (!effortIsValid) {
    throw new Error(
      `Monitor runs on: effort "${runtime.reasoningEffort ?? "none"}" is not available for ${runtime.model}. Supported: ${efforts.join(", ") || "none"}.`,
    );
  }
  if (
    runtime.fastMode === true &&
    !supportsFastMode(runtime.provider, runtime.model)
  ) {
    throw new Error(
      `Monitor runs on: Fast mode is not supported for ${runtime.model}.`,
    );
  }
};

const buildLaunchConfig = (
  launchNode: TaskMonitorExecutionPlanNode | null,
  launchPolicy: TaskMonitorLaunchPolicy | null,
  catalogState: CapabilityCatalogLoadState,
): TaskMonitorLaunchConfig => {
  if (!launchNode || !launchPolicy) {
    throw new Error("The Task Monitor has no saved launch configuration.");
  }
  const configuration: TaskMonitorExecutionNodeLaunchConfiguration =
    launchNode.launchConfiguration;
  if (catalogState.status !== "ready") {
    throw new Error(
      catalogState.status === "error"
        ? `The runtime model catalog is unavailable. ${catalogState.error}`
        : "The runtime model catalog must finish loading before Start.",
    );
  }
  if (
    !listModels(configuration.provider).some(
      (model) => model.id === configuration.model,
    )
  ) {
    throw new Error(
      "The saved Task Monitor provider and model are not available in the runtime catalog.",
    );
  }
  const efforts = listEfforts(configuration.provider, configuration.model);
  if (!efforts.includes(configuration.reasoningEffort)) {
    throw new Error(
      "The saved Task Monitor reasoning effort is not available for the selected provider and model.",
    );
  }
  const fastModeSupported = supportsFastMode(
    configuration.provider,
    configuration.model,
  );
  if (fastModeSupported && typeof configuration.fastMode !== "boolean") {
    throw new Error(
      "The saved Task Monitor Fast mode choice is missing for the selected provider and model.",
    );
  }
  if (!fastModeSupported && configuration.fastMode !== undefined) {
    throw new Error(
      "The saved Task Monitor Fast mode choice is not supported for the selected provider and model.",
    );
  }
  const worktree = resolveWorktree(launchPolicy);
  return {
    taskId: launchNode.taskId,
    method: configuration.method,
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    ...(typeof configuration.fastMode === "boolean"
      ? { fastMode: configuration.fastMode }
      : {}),
    ...(worktree ? { worktree } : {}),
  };
};

export const useTaskMonitorStart = ({
  organizationId,
  projectId,
  monitorId,
  machineId,
  userMessage,
  launchNode,
  launchPolicy,
  coordinatorRuntime,
  reconcileProjection,
}: UseTaskMonitorStartOptions): UseTaskMonitorStartResult => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [commandOutcome, setCommandOutcome] =
    useState<SubmitTaskMonitorCommandResponseDto | null>(null);
  const submitMonitorCommand = useSubmitTaskMonitorCommand();
  // The machine the monitor starts on decides which models its CLI can launch.
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [machineId, organizationId, projectId],
  );
  const catalogState = useRuntimeModelCatalog(catalogSource);
  // Without a machine no catalog is requested; Start then reports the missing
  // machine instead of waiting for a catalog that will not come.
  const isCatalogLoading =
    machineId !== null &&
    (catalogState.status === "idle" || catalogState.status === "loading");
  const isCatalogFetched = !isCatalogLoading;
  const acceptedAwaitingRefresh =
    commandOutcome !== null &&
    commandOutcome.status !==
      SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected;

  const start = useCallback(async (): Promise<boolean> => {
    if (isSubmitting || isCatalogLoading) {
      return false;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setCommandOutcome(null);
    try {
      if (!machineId) {
        throw new Error(
          "Select a connected, controller-authorized CLI machine before starting the Task Monitor.",
        );
      }
      requireCoordinatorRuntimeInCatalog(coordinatorRuntime, catalogState);
      const command: TaskMonitorStartCommand = {
        cause: "START",
        launchConfig: buildLaunchConfig(launchNode, launchPolicy, catalogState),
        ...(userMessage?.trim() ? { userMessage: userMessage.trim() } : {}),
      };
      const outcome = await submitMonitorCommand.mutate({
        organizationId,
        projectId,
        monitorId,
        request: { requestId: crypto.randomUUID(), machineId, command },
      });
      if (
        typeof outcome.commandId !== "string" ||
        !Object.values(SubmitTaskMonitorCommandResponseDtoStatusEnum).includes(
          outcome.status,
        )
      ) {
        throw new Error(
          "The platform returned a malformed Task Monitor command acknowledgement.",
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
            ? `The START command was accepted, but canonical Task Monitor data could not be refreshed. ${error.message}`
            : "The START command was accepted, but canonical Task Monitor data could not be refreshed.",
        );
        return false;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Task Monitor START failed.",
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    catalogState,
    coordinatorRuntime,
    isCatalogLoading,
    isSubmitting,
    launchNode,
    launchPolicy,
    machineId,
    monitorId,
    organizationId,
    projectId,
    reconcileProjection,
    submitMonitorCommand,
    userMessage,
  ]);

  return {
    isSubmitting,
    acceptedAwaitingRefresh,
    isCatalogLoading,
    isCatalogFetched,
    errorMessage,
    commandOutcome,
    start,
  };
};
