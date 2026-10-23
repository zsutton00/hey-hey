import {
  Alert,
  AlertTitle,
  Button,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { classifySessionError } from "./classifySessionError";

interface SessionErrorAlertProps {
  error: string;
  onRetry?: (() => void) | null;
  /** Stable identity for the current failure attempt. */
  failureIdentity?: string;
  /** Enables presentation-only dismissal of the current failure. */
  onDismiss?: (() => void) | null;
  /**
   * Structured error code from the server error body (e.g. `NO_CLI_CONNECTION`).
   * When present it drives classification instead of the message string, so
   * actionable states render distinctly from generic failures.
   */
  errorCode?: string | null;
}

export const SessionErrorAlert = ({
  error,
  onRetry,
  errorCode,
  failureIdentity,
  onDismiss,
}: SessionErrorAlertProps) => {
  const [showDetails, setShowDetails] = useState(false);
  const classified = classifySessionError(error, errorCode);
  const currentFailureIdentity =
    failureIdentity ?? `${errorCode ?? "SESSION_ERROR"}:${error}`;
  const [hiddenFailureIdentity, setHiddenFailureIdentity] = useState<
    string | null
  >(null);

  useEffect(() => {
    setHiddenFailureIdentity((hidden) =>
      hidden === currentFailureIdentity ? hidden : null
    );
  }, [currentFailureIdentity]);

  if (hiddenFailureIdentity === currentFailureIdentity) {
    return null;
  }

  const handleRetry = () => {
    setHiddenFailureIdentity(null);
    onRetry?.();
  };

  const handleDismiss = () => {
    setHiddenFailureIdentity(currentFailureIdentity);
    onDismiss?.();
  };

  const actions =
    classified.retryable && onRetry ? (
      <Stack direction="row" spacing={0.5}>
        <Button
          color="inherit"
          size="small"
          onClick={handleRetry}
          data-testid="session-error-retry"
        >
          Retry
        </Button>
        {onDismiss ? (
          <Button
            color="inherit"
            size="small"
            onClick={handleDismiss}
            data-testid="session-error-dismiss"
          >
            Hide
          </Button>
        ) : null}
      </Stack>
    ) : onDismiss ? (
      <Button
        color="inherit"
        size="small"
        onClick={handleDismiss}
        data-testid="session-error-dismiss"
      >
        Hide
      </Button>
    ) : undefined;

  return (
    <Alert
      severity={classified.severity}
      action={actions}
      data-testid="session-error-alert"
    >
      <AlertTitle>{classified.title}</AlertTitle>
      <Typography variant="body2">{classified.description}</Typography>
      {classified.raw !== classified.description && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            sx={{
              cursor: "pointer",
              textDecoration: "underline",
              opacity: 0.7,
            }}
            onClick={() => setShowDetails((prev) => !prev)}
          >
            {showDetails ? "Hide details" : "Show details"}
          </Typography>
          <Collapse in={showDetails}>
            <Typography
              variant="caption"
              component="pre"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                opacity: 0.7,
                mt: 0.5,
              }}
            >
              {classified.raw}
            </Typography>
          </Collapse>
        </Stack>
      )}
    </Alert>
  );
};
