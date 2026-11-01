import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import axios from "axios";
import {
  usePlatformAdminAccess,
  usePrivateBetaAdmissionMode,
} from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";

const safeAdmissionModeError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) {
      return "Your session is no longer authorized. Sign in again and retry.";
    }
    if (error.response?.status === 403) {
      return "You are not authorized to change self-service admissions.";
    }
  }
  return "The admission mode could not be changed. Refresh and try again.";
};

const PrivateBetaAdmissionModeControlContent: React.FC = () => {
  const admissionMode = usePrivateBetaAdmissionMode();
  const [confirmOpen, setConfirmOpen, confirmOpenOwnerKey] =
    useModalState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const currentMode = admissionMode.data?.mode;
  const nextMode = currentMode === "OPEN" ? "PAUSED" : "OPEN";
  const actionLabel =
    nextMode === "PAUSED"
      ? "Pause self-service admissions"
      : "Resume self-service admissions";

  const handleConfirm = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await admissionMode.update.mutate(nextMode);
      setConfirmOpen(false);
      setSuccessMessage(
        result.mode === "OPEN"
          ? "Self-service admissions are open."
          : "Self-service admissions are paused.",
      );
    } catch (error) {
      setConfirmOpen(false);
      setErrorMessage(safeAdmissionModeError(error));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Box>
          <Typography component="h2" variant="h6">
            Self-service admissions
          </Typography>
          <Typography color="text.secondary">
            Pause signup self-service provisioning while keeping manual beta
            approvals and existing organization access available.
          </Typography>
        </Box>

        {admissionMode.isLoading && !admissionMode.data ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={20} />
            <Typography>Loading admission mode…</Typography>
          </Stack>
        ) : admissionMode.error || !currentMode ? (
          <Alert severity="error">
            The current admission mode could not be loaded. Refresh and try
            again.
          </Alert>
        ) : (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ sm: "center" }}
          >
            <Typography>
              Current state: <strong>{currentMode}</strong>
            </Typography>
            <Button
              variant={nextMode === "PAUSED" ? "outlined" : "contained"}
              color={nextMode === "PAUSED" ? "warning" : "primary"}
              disabled={admissionMode.update.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {actionLabel}
            </Button>
          </Stack>
        )}

        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      </Stack>

      <Dialog
        ownerKey={confirmOpenOwnerKey}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <DialogTitle>{actionLabel}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {nextMode === "PAUSED"
              ? "New signups will remain pending until an authenticated operator approves them. Existing access is unchanged."
              : "New signups will be authorized immediately and sent an activation email."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmOpen(false)}
            disabled={admissionMode.update.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={admissionMode.update.isPending}
            color={nextMode === "PAUSED" ? "warning" : "primary"}
            variant="contained"
          >
            {admissionMode.update.isPending ? "Saving…" : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export const PrivateBetaAdmissionModeControl: React.FC = () => {
  const { isPlatformAdmin } = usePlatformAdminAccess();

  return isPlatformAdmin ? <PrivateBetaAdmissionModeControlContent /> : null;
};
