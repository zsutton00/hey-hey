import type { PrivateBetaAccessRequestReviewDto } from "@hey-hey/ui-common/api";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

interface PrivateBetaAccessRequestDetailProps {
  request: PrivateBetaAccessRequestReviewDto | null;
  isLoading: boolean;
  error: Error | null;
  isActionPending: boolean;
  onDecision: (decision: "APPROVE" | "REJECT") => Promise<void>;
}

const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "—";

const statusLabel = (
  status: PrivateBetaAccessRequestReviewDto["status"],
): string => status.replace(/_/g, " ");

const valueOrDash = (
  value: string | number | null | undefined,
): string | number => value ?? "—";

export const PrivateBetaAccessRequestDetail: React.FC<
  PrivateBetaAccessRequestDetailProps
> = ({ request, isLoading, error, isActionPending, onDecision }) => {
  if (isLoading) {
    return (
      <Paper sx={{ p: 3, minHeight: 360 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <CircularProgress size={20} />
          <Typography>Loading request details…</Typography>
        </Stack>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        This request could not be loaded. Refresh and try again.
      </Alert>
    );
  }

  if (!request) {
    return (
      <Paper sx={{ p: 3, minHeight: 360 }}>
        <Typography color="text.secondary">
          Select a request to inspect its submitted context and outcome.
        </Typography>
      </Paper>
    );
  }

  const isPending = request.status === "PENDING";
  const canRetry =
    request.status === "PROVISIONING_FAILED" &&
    request.provisioningOutcome?.retryable === true;
  const isInProgress = request.status === "APPROVAL_IN_PROGRESS";
  const isTerminal =
    request.status === "APPROVED" || request.status === "REJECTED";
  const isExistingAccount = request.status === "EXISTING_ACCOUNT";

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={1}
        >
          <Box>
            <Typography variant="h5" component="h2">
              {request.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {request.organizationName} · {request.workEmail}
            </Typography>
          </Box>
          <Chip
            label={statusLabel(request.status)}
            color={
              isPending
                ? "warning"
                : isExistingAccount
                  ? "default"
                  : isTerminal
                    ? "success"
                    : canRetry
                      ? "error"
                      : "info"
            }
          />
        </Stack>

        <Divider />

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Submitted context
          </Typography>
          <Stack spacing={1}>
            <Typography>
              <strong>Request ID:</strong> {request.requestId}
            </Typography>
            <Typography>
              <strong>Team size:</strong>{" "}
              {request.teamSize === null ? "Not provided" : request.teamSize}
            </Typography>
            <Typography>
              <strong>Product or project context:</strong>{" "}
              {valueOrDash(request.productContext)}
            </Typography>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              <strong>Access rationale:</strong>{" "}
              {valueOrDash(request.accessRationale)}
            </Typography>
            <Typography>
              <strong>Created:</strong> {formatDate(request.createdAt)}
            </Typography>
            <Typography>
              <strong>Decision recorded:</strong>{" "}
              {formatDate(request.decidedAt)}
            </Typography>
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Provisioning outcome
          </Typography>
          {request.provisioningOutcome ? (
            <Stack spacing={1}>
              <Typography>
                <strong>Attempt status:</strong>{" "}
                {request.provisioningOutcome.status}
              </Typography>
              <Typography>
                <strong>Attempted:</strong>{" "}
                {formatDate(request.provisioningOutcome.attemptedAt)}
              </Typography>
              <Typography>
                <strong>Completed:</strong>{" "}
                {formatDate(request.provisioningOutcome.completedAt)}
              </Typography>
              <Typography>
                <strong>Organization ID:</strong>{" "}
                {valueOrDash(request.provisioningOutcome.organizationId)}
              </Typography>
              <Typography>
                <strong>User ID:</strong>{" "}
                {valueOrDash(request.provisioningOutcome.userId)}
              </Typography>
              <Typography>
                <strong>Retryable:</strong>{" "}
                {request.provisioningOutcome.retryable ? "Yes" : "No"}
              </Typography>
              {request.provisioningOutcome.failureCode && (
                <Typography>
                  <strong>Failure category:</strong>{" "}
                  {request.provisioningOutcome.failureCode}
                </Typography>
              )}
              {request.provisioningOutcome.failureMessage && (
                <Alert severity="error">
                  {request.provisioningOutcome.failureMessage}
                </Alert>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">
              No provisioning attempt has been recorded.
            </Typography>
          )}
        </Box>

        {(isPending ||
          canRetry ||
          isInProgress ||
          isTerminal ||
          isExistingAccount) && (
          <Box>
            {isPending && (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={isActionPending}
                  onClick={() => onDecision("APPROVE")}
                >
                  Approve access
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={isActionPending}
                  onClick={() => onDecision("REJECT")}
                >
                  Reject request
                </Button>
              </Stack>
            )}
            {canRetry && (
              <Button
                variant="contained"
                disabled={isActionPending}
                onClick={() => onDecision("APPROVE")}
              >
                Retry approval
              </Button>
            )}
            {isInProgress && (
              <Alert severity="info">
                Approval is in progress. No additional action is available until
                the persisted result changes.
              </Alert>
            )}
            {isTerminal && (
              <Typography color="text.secondary">
                This request has a terminal decision. No duplicate action is
                available.
              </Typography>
            )}
            {isExistingAccount && (
              <Typography color="text.secondary">
                This email already belongs to an account. The requester was
                emailed a sign-in link instead of being provisioned; no action
                is needed.
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </Paper>
  );
};
