import { Box, Typography } from "@mui/material";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  ModelSelectorMachineSelection,
  resolveAgentBridgeRecoveryState,
  useMachineResolution,
  type ModelSelectorMachineSelectionProps,
  type RuntimeModelCatalogSource,
} from "@hey-hey/ui-common/components";

export interface EvalRunMachine {
  machineId: string | null;
  /** Addresses the chosen machine's CLI for its model catalog. */
  catalogSource: RuntimeModelCatalogSource | null;
  selection: ModelSelectorMachineSelectionProps;
}

/** The machine a run starts on, chosen from the person's ready machines. */
export const useEvalRunMachine = (
  organizationId: string,
  projectId: string,
): EvalRunMachine => {
  const { machines, isReady, mode, selectedMachine, setSelectedMachineId } =
    useMachineResolution(null);
  const machineId = selectedMachine?.machineId ?? null;
  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !isReady,
        machines,
        selectedMachineId: machineId,
      }),
    [isReady, machineId, machines],
  );
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [machineId, organizationId, projectId],
  );
  return {
    machineId,
    catalogSource,
    selection: {
      machines,
      machineMode: mode,
      selectedMachineId: machineId,
      onSelectMachine: setSelectedMachineId,
      recoveryState,
    },
  };
};

export const EvalRunMachinePicker: React.FC<{
  machine: EvalRunMachine;
  testIdPrefix: string;
}> = ({ machine, testIdPrefix }) => {
  const { t } = useTranslation();
  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
        {t("eval.run.setup.runsOn")}
      </Typography>
      <ModelSelectorMachineSelection
        testIdPrefix={testIdPrefix}
        machineSelection={machine.selection}
      />
    </Box>
  );
};
