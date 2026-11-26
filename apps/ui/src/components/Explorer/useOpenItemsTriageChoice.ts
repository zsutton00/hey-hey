import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listModels,
  listProviders,
  OPEN_ITEMS_TRIAGE_SURFACE_ID,
  readStoredSurfaceSelection,
  reconcileSurfaceSelection,
  resolveAgentBridgeRecoveryState,
  supportsFastMode,
  useMachineResolution,
  useRuntimeModelCatalog,
  writeSurfaceSelection,
  type OpenItemsTriageRunOptions,
  type RuntimeModelSelectorProps,
  type StoredSurfaceSelection,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";
import { useUserPairedMachines } from "@hey-hey/ui-common/data";
import { buildTriageProviderSelection } from "../../utils/lowCostModelDefault";

/**
 * What the start screen shows for the active catalog: the held choice while its
 * model is offered, else the held provider's triage default, else the first
 * provider's. Null when the catalog offers nothing.
 */
const resolveTriageSelection = (
  held: StoredSurfaceSelection | null,
): SurfaceSelection | null => {
  if (held) {
    const offered = listModels(held.provider);
    if (offered.some((model) => model.id === held.model)) {
      return reconcileSurfaceSelection({
        ...held,
        fastMode: held.fastMode ?? false,
      });
    }
    if (offered.length > 0) {
      return buildTriageProviderSelection(held.provider);
    }
  }

  const firstProvider = listProviders().find(
    (provider) => listModels(provider).length > 0,
  );
  return firstProvider ? buildTriageProviderSelection(firstProvider) : null;
};

/**
 * The machine and runtime chosen on the triage start screen. Only a change the
 * user makes is remembered, so an untouched default keeps following later
 * defaults. The machine is never remembered.
 */
export function useOpenItemsTriageChoice(
  organizationId: string,
  projectId: string,
) {
  const machines = useMachineResolution();
  const { error: machinesError } = useUserPairedMachines();
  const machineId = machines.selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [organizationId, projectId, machineId],
  );
  const catalog = useRuntimeModelCatalog(catalogSource);

  const [remembered] = useState(() =>
    readStoredSurfaceSelection(OPEN_ITEMS_TRIAGE_SURFACE_ID),
  );
  const [chosen, setChosen] = useState<StoredSurfaceSelection | null>(null);
  const selection =
    catalog.status === "ready"
      ? resolveTriageSelection(chosen ?? remembered)
      : null;

  // One picker change arrives as several callbacks (provider, then model, then
  // effort), so each builds on the one before it.
  const selectionRef = useRef<StoredSurfaceSelection | null>(selection);
  selectionRef.current = selection;
  const handleChange = useCallback((patch: Partial<SurfaceSelection>) => {
    if (!selectionRef.current) {
      return;
    }
    const next = { ...selectionRef.current, ...patch };
    selectionRef.current = next;
    setChosen(next);

    const shown = resolveTriageSelection(next);
    if (shown) {
      writeSurfaceSelection(OPEN_ITEMS_TRIAGE_SURFACE_ID, shown);
    }
  }, []);

  useEffect(() => {
    if (machinesError) {
      console.error(
        "Open Items triage: the machine list is unavailable:",
        machinesError,
      );
    }
  }, [machinesError]);

  const recoveryState = resolveAgentBridgeRecoveryState({
    type: "inventory",
    isLoading: !machines.isReady,
    machines: machines.machines,
    selectedMachineId: machineId,
  });

  const picker: RuntimeModelSelectorProps = {
    catalogSource,
    provider: selection?.provider ?? null,
    model: selection?.model ?? null,
    reasoningEffort: selection?.reasoningEffort ?? null,
    fastMode: selection?.fastMode ?? false,
    onProviderChange: (provider) => handleChange({ provider }),
    onModelChange: (model) => handleChange({ model }),
    onReasoningEffortChange: (reasoningEffort) =>
      handleChange({ reasoningEffort }),
    onFastModeChange: (fastMode) => handleChange({ fastMode }),
    resolveProviderSwitch: buildTriageProviderSelection,
    machineSelection: {
      machines: machines.machines,
      machineMode: machines.mode,
      selectedMachineId: machineId,
      onSelectMachine: machines.setSelectedMachineId,
      recoveryState,
    },
    testIdPrefix: "open-items-triage-model",
  };

  /** Null until a ready machine and a complete runtime are chosen. */
  const choice: Pick<
    OpenItemsTriageRunOptions,
    "machineId" | "runtime"
  > | null =
    !machinesError && machineId && selection
      ? {
          machineId,
          runtime: {
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            // Fast mode is said explicitly wherever the model supports it, so
            // the provider's own saved preference never decides the speed.
            ...(supportsFastMode(selection.provider, selection.model)
              ? { fastMode: selection.fastMode ?? false }
              : {}),
          },
        }
      : null;

  return {
    picker,
    choice,
    machinesError,
    /** Set when machines are paired but none can run, to say why. */
    unreadyMachines:
      machines.isReady &&
      machines.mode === "zero" &&
      machines.machines.length > 0
        ? recoveryState
        : null,
  };
}
