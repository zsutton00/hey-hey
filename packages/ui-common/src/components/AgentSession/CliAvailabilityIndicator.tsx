import CodeIcon from "@mui/icons-material/Code";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import React from "react";
type CliAvailabilityStatus = "loading" | "available" | "unavailable" | "error";

export interface CliAvailabilityIndicatorProps {
  status: CliAvailabilityStatus;
  error: string | null;
  onSync: () => void;
  syncDisabled?: boolean;
}

export const CliAvailabilityIndicator: React.FC<
  CliAvailabilityIndicatorProps
> = ({ status, error, onSync, syncDisabled = false }) => {
  if (status === "loading") {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 0.5,
        }}
      >
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Checking CLI availability…
        </Typography>
      </Box>
    );
  }

  if (status === "available") {
    return (
      <Tooltip title="Open a coding agent session to validate this task">
        <span>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CodeIcon />}
            onClick={onSync}
            disabled={syncDisabled}
            data-testid="think-with-code-button"
          >
            Think with Code
          </Button>
        </span>
      </Tooltip>
    );
  }

  if (status === "error") {
    return (
      <Alert
        severity="warning"
        icon={<ErrorIcon fontSize="small" />}
        sx={{ py: 0, "& .MuiAlert-message": { py: 0.5 } }}
      >
        <Typography variant="body2">
          Unable to detect CLI. {error ? `${error}. ` : ""}
          Start the local runtime with <code>pnpm dev</code> from{" "}
          <code>../cli</code>.
        </Typography>
      </Alert>
    );
  }

  // unavailable — render nothing by default (button is hidden)
  return null;
};
