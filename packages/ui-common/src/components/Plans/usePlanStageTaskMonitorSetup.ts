import { useMemo } from "react";
import {
  AgentEdgeType,
  TaskMonitorLaunchMethod,
  TaskMonitorReviewMode,
} from "../../api";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { validateCanonicalPlanRegistry } from "../../data/plans/canonicalPlan";
import type { MachineDto } from "../../api";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import {
  useMachineResolution,
  type MachineResolutionMode,
} from "../AgentSession/runtime/coding/useMachineResolution";
import {
  useRuntimeModelCatalog,
  type RuntimeModelCatalogSource,
} from "../AgentSession/useRuntimeModelCatalog";
import {
  resolveAgentBridgeRecoveryState,
  type AgentBridgeRecoveryState,
} from "../AgentSession/agentBridgeRecoveryState";
import {
  buildDefaultSurfaceSelection,
  readSurfaceSelection,
  TASK_MONITOR_SETUP_SURFACE_ID,
} from "../AgentSession/surfaceSelectionMemory";
import {
  composePlanStageTaskMonitorSetup,
  parseCanonicalPlanStageSource,
  type PlanStageTaskMonitorSetupDraft,
  type PlanStageWorkItem,
  type PlanWorkItem,
} from "./planStageTaskMonitorSetup";

export interface UsePlanStageTaskMonitorSetupOptions {
  organizationId: string;
  projectId: string;
  planId: string;
  stageId: string;
  preparedByAgentSessionId?: string;
}

export type PlanStageTaskMonitorSetupState =
  | { status: "read-error"; message: string }
  | { status: "invalid-source"; messages: string[] }
  | { status: "no-executable-work"; messages: string[] }
  | { status: "ready"; draft: PlanStageTaskMonitorSetupDraft };

/** The machine whose CLI decides which models the setup offers. */
interface PlanStageTaskMonitorMachineSelection {
  machines: MachineDto[];
  machineMode: MachineResolutionMode;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  recoveryState: AgentBridgeRecoveryState;
}

export interface UsePlanStageTaskMonitorSetupResult {
  state: PlanStageTaskMonitorSetupState;
  /** Null until a machine is picked; the model choices come from its CLI. */
  catalogSource: RuntimeModelCatalogSource | null;
  machineSelection: PlanStageTaskMonitorMachineSelection;
  setup: PlanStageTaskMonitorSetupDraft | null;
  plan: PlanWorkItem | null;
  stage: PlanStageWorkItem | null;
  isLoading: boolean;
  isRefreshingTaskServices: boolean;
  isFetched: boolean;
  error: unknown;
  refetchTaskServices: () => Promise<unknown>;
}

const errorMessageFor = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Unable to load the selected Plan Stage setup data.";

export const usePlanStageTaskMonitorSetup = ({
  organizationId,
  projectId,
  planId,
  stageId,
  preparedByAgentSessionId,
}: UsePlanStageTaskMonitorSetupOptions): UsePlanStageTaskMonitorSetupResult => {
  const hasRequiredContext =
    organizationId.trim().length > 0 &&
    projectId.trim().length > 0 &&
    planId.trim().length > 0 &&
    stageId.trim().length > 0;
  const machineResolution = useMachineResolution(null);
  const machineId = machineResolution.selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      hasRequiredContext && machineId
        ? { organizationId, projectId, machineId }
        : null,
    [hasRequiredContext, machineId, organizationId, projectId],
  );
  const catalogState = useRuntimeModelCatalog(catalogSource);
  const machineSelection = useMemo<PlanStageTaskMonitorMachineSelection>(
    () => ({
      machines: machineResolution.machines,
      machineMode: machineResolution.mode,
      selectedMachineId: machineId,
      onSelectMachine: machineResolution.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machineResolution.isReady,
        machines: machineResolution.machines,
        selectedMachineId: machineId,
      }),
    }),
    [machineId, machineResolution],
  );
  const registryQuery = useWorkItemTypes(organizationId, {
    projectId,
    enabled: hasRequiredContext,
  });
  const planQuery = useWorkItem(organizationId, "task", planId, {
    projectId,
    enabled: hasRequiredContext,
  });
  const stagesQuery = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      enabled: hasRequiredContext,
      parentTaskId: planId,
      limit: 1000,
    },
  );
  const tasksQuery = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      enabled: hasRequiredContext,
      parentTaskId: stageId,
      includeSectionKeys: ["description"],
      includeServiceRelations: true,
      includeEdges: true,
      edgeTypes: [AgentEdgeType.DependsOn],
      limit: 1000,
    },
  );
  const sourceResult = useMemo(
    () =>
      parseCanonicalPlanStageSource({
        plan: planQuery.workItem,
        stageId,
        descendants: [...stagesQuery.workItems, ...tasksQuery.workItems],
      }),
    [planQuery.workItem, stageId, stagesQuery.workItems, tasksQuery.workItems],
  );
  const preparedAt = useMemo(() => new Date().toISOString(), []);
  const isLoading =
    !machineResolution.isReady ||
    (catalogSource !== null &&
      (catalogState.status === "idle" || catalogState.status === "loading")) ||
    registryQuery.isLoading ||
    planQuery.isLoading ||
    stagesQuery.isLoading ||
    tasksQuery.isLoading;
  const isFetched =
    !hasRequiredContext ||
    (registryQuery.isFetched &&
      planQuery.isFetched &&
      stagesQuery.isFetched &&
      tasksQuery.isFetched);
  const error =
    registryQuery.error ??
    planQuery.error ??
    stagesQuery.error ??
    tasksQuery.error;

  const state = useMemo<PlanStageTaskMonitorSetupState>(() => {
    if (!hasRequiredContext) {
      return {
        status: "invalid-source",
        messages: [
          "Organization, project, Plan, and Plan Stage context are required.",
        ],
      };
    }
    if (error) {
      return { status: "read-error", message: errorMessageFor(error) };
    }
    if (!registryQuery.isFetched) {
      return {
        status: "read-error",
        message: "The effective Work Item type registry is still loading.",
      };
    }
    const registryMessages = validateCanonicalPlanRegistry(
      registryQuery.workItemTypes,
    );
    if (registryMessages.length > 0) {
      return {
        status: "invalid-source",
        messages: registryMessages,
      };
    }
    if (catalogSource === null && catalogState.status === "idle") {
      return {
        status: "read-error",
        message:
          "Select a machine to see the models its CLI can launch for this Task Monitor.",
      };
    }
    if (catalogState.status === "idle" || catalogState.status === "loading") {
      return {
        status: "read-error",
        message: "The runtime model catalog is still loading.",
      };
    }
    if (catalogState.status === "error") {
      return {
        status: "read-error",
        message: `The runtime model catalog is unavailable. ${catalogState.error}`,
      };
    }
    if (!sourceResult.ok) {
      return {
        status: "invalid-source",
        messages: sourceResult.error.messages,
      };
    }
    const selection =
      readSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID) ??
      buildDefaultSurfaceSelection();
    if (!selection) {
      return {
        status: "read-error",
        message:
          "The CLI on the selected machine reported no model it can launch.",
      };
    }
    if (!selection.reasoningEffort) {
      return {
        status: "read-error",
        message:
          "The runtime model catalog has no reasoning effort for the selected provider and model.",
      };
    }
    const result = composePlanStageTaskMonitorSetup({
      organizationId,
      projectId,
      ...sourceResult.source,
      preparedAt,
      launchConfiguration: {
        method: TaskMonitorLaunchMethod.Quick,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        ...(supportsFastMode(selection.provider, selection.model)
          ? { fastMode: selection.fastMode ?? false }
          : {}),
      },
      launchPolicy: {
        ...(sourceResult.source.configuration.worktreeBranch !== null
          ? {
              worktree: {
                enabled: true,
                branch: sourceResult.source.configuration.worktreeBranch,
              },
            }
          : {}),
        terminalSupervision: { mode: TaskMonitorReviewMode.AgentDecides },
      },
      preparedByAgentSessionId,
    });
    if (result.ok) return { status: "ready", draft: result.draft };
    return {
      status: result.error.code,
      messages: result.error.messages,
    };
  }, [
    catalogSource,
    catalogState,
    error,
    hasRequiredContext,
    organizationId,
    preparedAt,
    preparedByAgentSessionId,
    projectId,
    registryQuery.isFetched,
    registryQuery.workItemTypes,
    sourceResult,
  ]);

  return {
    state,
    catalogSource,
    machineSelection,
    setup: state.status === "ready" ? state.draft : null,
    plan: sourceResult.ok ? sourceResult.source.plan : null,
    stage: sourceResult.ok ? sourceResult.source.stage : null,
    isLoading,
    isRefreshingTaskServices: tasksQuery.isFetching,
    isFetched,
    error,
    refetchTaskServices: tasksQuery.refetch,
  };
};
