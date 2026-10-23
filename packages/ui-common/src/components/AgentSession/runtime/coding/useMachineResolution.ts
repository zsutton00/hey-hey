import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import type { MachineDto } from "../../../../api";
import { classifyMachineExecutionReadiness } from "./machineExecutionReadiness";

export type MachineResolutionMode = "zero" | "one" | "many";

export interface UseMachineResolutionResult {
  machines: MachineDto[];
  executionReadyMachines: MachineDto[];
  isReady: boolean;
  mode: MachineResolutionMode;
  selectedMachine: MachineDto | null;
  setSelectedMachineId: (id: string) => void;
}

/**
 * `isEligible` narrows which machines the surface offers at all (for example,
 * only machines holding every project repository). Pass a stable reference.
 */
export const useMachineResolution = (
  preferredMachineId: string | null = null,
  isEligible?: (machine: MachineDto) => boolean,
): UseMachineResolutionResult => {
  const { machines: pairedMachines, isReady } = useUserPairedMachines();
  const machines = useMemo(
    () => (isEligible ? pairedMachines.filter(isEligible) : pairedMachines),
    [isEligible, pairedMachines],
  );
  const executionReadyMachines = useMemo(
    () =>
      machines.filter(
        (machine) => classifyMachineExecutionReadiness(machine).selectable,
      ),
    [machines],
  );
  const mode: MachineResolutionMode =
    executionReadyMachines.length === 0
      ? "zero"
      : executionReadyMachines.length === 1
        ? "one"
        : "many";

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(
    null,
  );
  const initializedSelection = useRef(false);
  const selectionWasInvalidated = useRef(false);

  useEffect(() => {
    if (!isReady) return;

    if (!initializedSelection.current) {
      initializedSelection.current = true;
      const preferredMachine = executionReadyMachines.find(
        (machine) => machine.machineId === preferredMachineId,
      );
      if (preferredMachine) {
        setSelectedMachineId(preferredMachine.machineId);
      } else if (executionReadyMachines.length === 1) {
        setSelectedMachineId(executionReadyMachines[0].machineId);
      }
      return;
    }

    // The machine query can be marked ready before its first non-empty result
    // arrives. If that first result was empty, select the sole ready machine
    // when it becomes available. Do not do this after an existing selection
    // was invalidated; that case requires an explicit user choice.
    if (selectedMachineId === null && !selectionWasInvalidated.current) {
      const preferredMachine = executionReadyMachines.find(
        (machine) => machine.machineId === preferredMachineId,
      );
      if (preferredMachine) {
        setSelectedMachineId(preferredMachine.machineId);
        return;
      }
      if (executionReadyMachines.length === 1) {
        setSelectedMachineId(executionReadyMachines[0].machineId);
        return;
      }
    }

    if (
      selectedMachineId !== null &&
      !executionReadyMachines.some(
        (machine) => machine.machineId === selectedMachineId,
      )
    ) {
      selectionWasInvalidated.current = true;
      setSelectedMachineId(null);
    }
  }, [executionReadyMachines, isReady, preferredMachineId, selectedMachineId]);

  const selectedMachine = useMemo(() => {
    return (
      executionReadyMachines.find(
        (machine) => machine.machineId === selectedMachineId,
      ) ?? null
    );
  }, [executionReadyMachines, selectedMachineId]);

  const selectMachine = useCallback(
    (id: string): void => {
      if (executionReadyMachines.some((machine) => machine.machineId === id)) {
        setSelectedMachineId(id);
      }
    },
    [executionReadyMachines],
  );

  return {
    machines,
    executionReadyMachines,
    isReady,
    mode,
    selectedMachine,
    setSelectedMachineId: selectMachine,
  };
};
