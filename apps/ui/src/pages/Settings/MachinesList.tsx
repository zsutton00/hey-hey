import type { MachineDto } from "@hey-hey/ui-common/api";
import {
  useRevokeMachine,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useState } from "react";
import { MachineListItem } from "./MachineListItem";
import { RevokeMachineDialog } from "./RevokeMachineDialog";

export const MachinesList: React.FC = () => {
  const { machines, isLoading, error } = useUserPairedMachines();
  const [selectedMachine, setSelectedMachine] = useState<MachineDto | null>(
    null,
  );
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const revokeMutation = useRevokeMachine({
    onSuccess: () => {
      setSelectedMachine(null);
      setRevokeError(null);
    },
    onError: (err) => {
      setRevokeError(err.message || "Failed to remove Agent Bridge.");
    },
  });

  const handleRequestRevoke = (machine: MachineDto): void => {
    setRevokeError(null);
    setSelectedMachine(machine);
  };

  const handleCancel = (): void => {
    if (revokeMutation.isPending) {
      return;
    }
    setSelectedMachine(null);
  };

  const handleConfirm = (): void => {
    if (!selectedMachine) {
      return;
    }
    void revokeMutation
      .mutate({ machineId: selectedMachine.machineId })
      .catch(() => {
        // onError handler captures the error message for display
      });
  };

  if (isLoading) {
    return (
      <Box
        data-testid="settings-machines-loading"
        sx={{ display: "flex", justifyContent: "center", py: 4 }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" data-testid="settings-machines-error">
        {error.message || "Failed to load Agent Bridges."}
      </Alert>
    );
  }

  return (
    <Box>
      {revokeError ? (
        <Alert
          severity="error"
          data-testid="settings-machines-revoke-error"
          sx={{ mb: 2 }}
          onClose={() => setRevokeError(null)}
        >
          {revokeError}
        </Alert>
      ) : null}

      {machines.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="settings-machines-empty"
        >
          No Agent Bridges yet. Run <code>heyhey pair</code> in the Hey Hey CLI
          on the computer you want to connect.
        </Typography>
      ) : (
        <Box data-testid="settings-machines-list">
          {machines.map((machine) => (
            <MachineListItem
              key={machine.machineId}
              machine={machine}
              onRevoke={handleRequestRevoke}
            />
          ))}
        </Box>
      )}

      <RevokeMachineDialog
        open={selectedMachine !== null}
        machine={selectedMachine}
        isRevoking={revokeMutation.isPending}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </Box>
  );
};
