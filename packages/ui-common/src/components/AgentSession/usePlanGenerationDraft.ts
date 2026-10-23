import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlanCombinationAggressiveness,
  type PlanConfigurationV1,
} from "../../api";
import { plansClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import { resolveDefaultPlanWorktreeBranch } from "../Plans/planWorktreeBranch";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import {
  writeSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";
import { useSurfaceSelection } from "./useSurfaceSelection";
import { usePlanFromDesignDocSeed } from "./usePlanFromDesignDocSeed";
import type { PlanFromDesignDocPreStartProps } from "./PlanFromDesignDocPreStart";

export interface PlanGenerationLaunchSettings {
  selection: SurfaceSelection;
  machineId: string;
  worktreeBranch: string | null;
  planCombinationAggressiveness: PlanCombinationAggressiveness;
}
export interface PlanGenerationLaunchHandoff {
  conversationId: string;
  agentSessionId: string;
  settings: PlanGenerationLaunchSettings;
}
export interface PlanGenerationDraftProps {
  organizationId: string;
  projectId: string;
  planId: string;
  planName: string;
  configuration: PlanConfigurationV1;
  onPreparingChange: (preparing: boolean) => void;
  onPrepared: (handoff: PlanGenerationLaunchHandoff) => void;
}

export function usePlanGenerationDraft({
  organizationId,
  projectId,
  planId,
  planName,
  configuration,
  onPreparingChange,
  onPrepared,
}: PlanGenerationDraftProps) {
  const navigate = useNavigate();
  const paths = usePathService();
  const document = usePlanFromDesignDocSeed(organizationId, projectId, planId);
  const machines = useMachineResolution(null);
  const [worktreeEnabled, setWorktreeEnabled] = useState(
    configuration.worktreeBranch !== null,
  );
  const [worktreeBranch, setWorktreeBranch] = useState(
    configuration.worktreeBranch ?? "",
  );
  const [aggressiveness, setAggressiveness] =
    useState<PlanCombinationAggressiveness>(
      PlanCombinationAggressiveness.Medium,
    );
  const pending = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const machineId = machines.selectedMachine?.machineId ?? null;
  const { selection, updateSelection } = useSurfaceSelection({
    surfaceId: "plan-generation",
    catalogSource: machineId ? { organizationId, projectId, machineId } : null,
    resetKey: null,
  });
  const select = (change: Partial<SurfaceSelection>) => {
    updateSelection((previous) => {
      const next = { ...previous, ...change };
      writeSurfaceSelection("plan-generation", next);
      return next;
    });
  };
  const start = async () => {
    if (
      pending.current ||
      !machineId ||
      !selection ||
      !machines.isReady ||
      !document.seed ||
      document.isLoading ||
      (worktreeEnabled && !worktreeBranch.trim())
    )
      return;
    pending.current = true;
    setIsStarting(true);
    setStartError(null);
    onPreparingChange(true);
    try {
      const { data: session } = await plansClient.prepareWorkItemPlanGeneration(
        { organizationId, projectId, taskId: planId },
      );
      if (!session.conversationId)
        throw new Error(
          "Unable to start generation: no conversation was returned.",
        );
      onPrepared({
        conversationId: session.conversationId,
        agentSessionId: session.id,
        settings: {
          selection,
          machineId,
          worktreeBranch: worktreeEnabled ? worktreeBranch.trim() : null,
          planCombinationAggressiveness: aggressiveness,
        },
      });
    } catch (cause) {
      setStartError(
        cause instanceof Error
          ? cause.message
          : "Unable to start Plan generation.",
      );
    } finally {
      pending.current = false;
      setIsStarting(false);
      onPreparingChange(false);
    }
  };
  const designDocId = document.designDocId;
  const preStartProps: PlanFromDesignDocPreStartProps = {
    organizationId,
    projectId,
    navigate,
    seed: document.seed,
    isLoadingSeed: document.isLoading,
    isStarting,
    onStartGenerating: () => {
      void start();
    },
    onEditDesignDoc: designDocId
      ? () =>
          navigate(paths.designDoc({ projectId, designDocId, editing: true }))
      : undefined,
    isBridgeSelected: machines.isReady && machineId !== null,
    provider: selection?.provider ?? null,
    model: selection?.model ?? null,
    reasoningEffort: selection?.reasoningEffort ?? null,
    fastMode: selection?.fastMode ?? false,
    onProviderChange: (provider) => select({ provider }),
    onModelChange: (model) => select({ model }),
    onReasoningEffortChange: (reasoningEffort) => select({ reasoningEffort }),
    onFastModeChange: (fastMode) => select({ fastMode }),
    machineSelection: {
      machines: machines.machines,
      machineMode: machines.mode,
      selectedMachineId: machineId,
      onSelectMachine: machines.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machines.isReady,
        machines: machines.machines,
        selectedMachineId: machineId,
      }),
    },
    worktreeEnabled,
    worktreeBranch,
    onWorktreeEnabledChange: (enabled) => {
      setWorktreeEnabled(enabled);
      if (enabled && !worktreeBranch.trim())
        setWorktreeBranch(resolveDefaultPlanWorktreeBranch(planName));
    },
    onWorktreeBranchChange: setWorktreeBranch,
    planCombinationAggressiveness: aggressiveness,
    onPlanCombinationAggressivenessChange: setAggressiveness,
  };
  return { preStartProps, startError, document };
}
