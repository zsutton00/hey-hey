import { useMemo, useState } from "react";
import {
  AgentSessionContinuationMode,
  AgentSessionContinuationState,
} from "../../api";
import { useAgentSessionContinuationStatus } from "../../data/hooks/useAgentSessionContinuationStatus";
import { useUserPairedMachines } from "../../data/hooks/useUserPairedMachines";
import type { AgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import {
  resolveAgentSessionRecoveryState,
  type AgentSessionRecoveryState,
} from "./agentSessionContinuationRecoveryState";
import {
  useAgentSessionContinuation,
  type AgentSessionContinuationControls,
} from "./useAgentSessionContinuation";

export interface AgentSessionContinuationOutcome {
  mode: AgentSessionContinuationMode;
  machineName: string;
}

export interface AgentSessionContinuationRecovery {
  state: AgentSessionRecoveryState;
  controls: AgentSessionContinuationControls;
  selectedDestinationId: string | null;
  selectDestination: (machineId: string) => void;
  pairingHref: string;
  machineNames: ReadonlyMap<string, string>;
  /** The session's continuation whose provider startup was confirmed. */
  outcome: AgentSessionContinuationOutcome | null;
}

/** Pairing returns to this exact in-app location; only same-origin paths. */
const currentConversationPath = (): string =>
  `${window.location.pathname}${window.location.search}`;

export function useAgentSessionContinuationRecovery(input: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  base: AgentBridgeRecoveryState;
  enabled: boolean;
}): AgentSessionContinuationRecovery {
  const [boundMachineId, setBoundMachineId] = useState<string | null>(null);
  const controls = useAgentSessionContinuation({
    organizationId: input.organizationId,
    projectId: input.projectId,
    agentSessionId: input.agentSessionId,
    conversationId: input.conversationId,
    boundMachineId,
  });
  // Always read: a durable attempt can be pending, failed or awaiting
  // confirmation after the destination already became the bound computer,
  // so the local bridge state alone cannot tell whether one exists.
  const needsStatus = input.enabled;
  const status = useAgentSessionContinuationStatus(
    input.organizationId,
    input.projectId,
    input.agentSessionId,
    { enabled: needsStatus },
  );
  const machines = useUserPairedMachines({ enabled: needsStatus });
  const serverBoundMachineId = status.data?.boundMachineId ?? null;
  if (
    serverBoundMachineId !== boundMachineId &&
    controls.phase.kind === "idle"
  ) {
    setBoundMachineId(serverBoundMachineId);
  }
  const [selectedDestinationId, selectDestination] = useState<string | null>(
    null,
  );

  const state = resolveAgentSessionRecoveryState({
    base: input.base,
    machines: machines.machines,
    continuation: {
      isLoading: status.isLoading && status.data === null,
      failed: Boolean(status.error),
      status: status.data,
    },
  });

  const machineNames = useMemo(
    () =>
      new Map(
        machines.machines.map((machine) => [machine.machineId, machine.name]),
      ),
    [machines.machines],
  );

  const attempt = status.data?.attempt ?? null;
  // An outcome describes where the session went; once the binding has moved
  // on to another computer it is history, not the current state.
  const startedName =
    attempt?.state === AgentSessionContinuationState.Succeeded &&
    serverBoundMachineId === attempt.destinationMachineId
      ? machineNames.get(attempt.destinationMachineId)
      : undefined;

  return {
    state,
    controls,
    selectedDestinationId,
    selectDestination,
    pairingHref: `/pairing?${new URLSearchParams({
      returnTo: currentConversationPath(),
    }).toString()}`,
    machineNames,
    outcome:
      attempt && startedName
        ? { mode: attempt.mode, machineName: startedName }
        : null,
  };
}
