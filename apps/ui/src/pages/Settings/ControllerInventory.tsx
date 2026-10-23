import type {
  ControllerCredentialSummaryDto,
  MachineDto,
} from "@hey-hey/ui-common/api";
import { MachineExecutionReadinessState } from "@hey-hey/ui-common/api";
import {
  ControllerManagementDenialError as ControllerManagementDenialErrorClass,
  useControllerInventory,
  useRevokeController,
} from "@hey-hey/ui-common/data";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  AlertTitle,
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
import { useState } from "react";
import { ControllerRevokeDialog } from "./ControllerRevokeDialog";

interface ControllerInventoryProps {
  machine: MachineDto;
}

const formatEvidenceDate = (value: string | null): string => {
  if (value === null) {
    return "Never";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : format(date, "PP p");
};

const isFinalControllerState = (controllerCount: number): boolean =>
  controllerCount === 0;

const recoveryStateCopy = (machine: MachineDto): string => {
  if (
    machine.executionReadiness === MachineExecutionReadinessState.LegacyProtocol
  ) {
    return machine.active
      ? "This saved Agent Bridge uses an older Hey Hey CLI and needs authorization."
      : "This saved Agent Bridge is offline, uses an older Hey Hey CLI, and needs authorization.";
  }

  return machine.active
    ? "This Agent Bridge has no active Passkey and cannot run work."
    : "This saved Agent Bridge is offline and needs authorization.";
};

const ControllerEvidenceRow: React.FC<{
  controller: ControllerCredentialSummaryDto;
  onRevoke: (controller: ControllerCredentialSummaryDto) => void;
  isRevoking: boolean;
}> = ({ controller, onRevoke, isRevoking }) => (
  <Stack
    direction={{ xs: "column", sm: "row" }}
    alignItems={{ xs: "stretch", sm: "center" }}
    justifyContent="space-between"
    spacing={1.5}
    data-testid="settings-controller-row"
    sx={{ py: 1.25, borderBottom: 1, borderColor: "divider" }}
  >
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600 }}
        data-testid="settings-controller-label"
      >
        {controller.label}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="settings-controller-fingerprint"
      >
        Fingerprint {controller.fingerprint}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="settings-controller-created-at"
      >
        Created {formatEvidenceDate(controller.createdAt)} · Last used{" "}
        <span data-testid="settings-controller-last-used">
          {formatEvidenceDate(controller.lastUsedAt)}
        </span>
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="settings-controller-backup"
      >
        {controller.backupEligible
          ? "Eligible for backup"
          : "Not eligible for backup"}{" "}
        · {controller.backupState ? "Backed up" : "Not backed up"}
      </Typography>
    </Box>
    <Tooltip title="Remove Passkey">
      <span>
        <IconButton
          onClick={() => onRevoke(controller)}
          disabled={isRevoking}
          color="error"
          size="small"
          aria-label={"Remove Passkey " + controller.label}
          data-testid="settings-controller-revoke"
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  </Stack>
);

export const ControllerInventory: React.FC<ControllerInventoryProps> = ({
  machine,
}) => {
  const inventoryQuery = useControllerInventory(machine.machineId);
  const [selectedController, setSelectedController] =
    useState<ControllerCredentialSummaryDto | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revokeMutation = useRevokeController({
    onSuccess: () => {
      setSelectedController(null);
      setRevokeError(null);
    },
    onError: (error) => {
      setRevokeError(
        error instanceof ControllerManagementDenialErrorClass
          ? "This Passkey could not be removed because it is no longer active."
          : "Unable to remove this Passkey right now. Check your connection and try again.",
      );
    },
  });

  const handleConfirm = (): void => {
    if (!selectedController) {
      return;
    }

    void revokeMutation
      .mutate({
        machineId: machine.machineId,
        controllerCredentialId: selectedController.credentialId,
      })
      .catch(() => {
        // The mutation callback owns the user-visible error state.
      });
  };

  if (inventoryQuery.isLoading) {
    return (
      <Box
        data-testid="settings-controller-inventory-loading"
        sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}
      >
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Loading Passkeys…
        </Typography>
      </Box>
    );
  }

  if (inventoryQuery.error) {
    const isSafeDenial =
      inventoryQuery.error instanceof ControllerManagementDenialErrorClass;
    return (
      <Alert
        severity={isSafeDenial ? "info" : "warning"}
        data-testid={
          isSafeDenial
            ? "settings-controller-inventory-denial"
            : "settings-controller-inventory-transport-error"
        }
        sx={{ mt: 1 }}
      >
        {isSafeDenial
          ? `Passkeys are not available for ${machine.name}.`
          : `Unable to load Passkeys for ${machine.name} right now. Check your connection and try again.`}
      </Alert>
    );
  }

  const inventory = inventoryQuery.data;
  if (!inventory) {
    return null;
  }

  const hasControllers = inventory.controllers.length > 0;

  return (
    <Box
      data-testid="settings-controller-inventory"
      data-machine-id={machine.machineId}
    >
      <Typography
        variant="subtitle1"
        component="h3"
        data-testid="settings-passkeys-heading"
        sx={{ fontWeight: 600 }}
      >
        Passkeys
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="settings-controller-passkey-copy"
        sx={{ mt: 0.5 }}
      >
        Passkeys authorize this Agent Bridge. They can sync through your
        authenticator ecosystem and are not tied to one browser.
      </Typography>

      {revokeError ? (
        <Alert
          severity="error"
          data-testid="settings-controller-revoke-error"
          sx={{ mt: 1 }}
          onClose={() => setRevokeError(null)}
        >
          {revokeError}
        </Alert>
      ) : null}

      {hasControllers ? (
        <Box data-testid="settings-controller-list" sx={{ pl: 2 }}>
          {inventory.controllers.map((controller) => (
            <ControllerEvidenceRow
              key={controller.credentialId}
              controller={controller}
              onRevoke={setSelectedController}
              isRevoking={revokeMutation.isPending}
            />
          ))}
        </Box>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="settings-controller-empty"
          sx={{ mt: 1 }}
        >
          No active Passkeys are saved for this Agent Bridge.
        </Typography>
      )}

      {isFinalControllerState(inventory.controllers.length) ? (
        <Alert
          severity="warning"
          data-testid="settings-controller-recovery"
          data-machine-id={machine.machineId}
          sx={{ mt: 1 }}
        >
          <AlertTitle>“{machine.name}” can’t run work</AlertTitle>
          {recoveryStateCopy(machine)} On that computer, run{" "}
          <code>heyhey controllers add</code> to add a Passkey, then complete
          pairing in your browser. If you no longer use it, remove this Agent
          Bridge. Signing in alone cannot restore execution.
        </Alert>
      ) : null}

      <ControllerRevokeDialog
        open={selectedController !== null}
        machine={machine}
        controller={selectedController}
        isRevoking={revokeMutation.isPending}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!revokeMutation.isPending) {
            setSelectedController(null);
          }
        }}
      />
    </Box>
  );
};
