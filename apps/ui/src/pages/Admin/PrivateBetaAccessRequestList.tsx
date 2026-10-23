import type { PrivateBetaAccessRequestReviewDto } from "@hey-hey/ui-common/api";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

interface PrivateBetaAccessRequestListProps {
  requests: PrivateBetaAccessRequestReviewDto[];
  selectedRequestId: string | null;
  isLoading: boolean;
  error: Error | null;
  onSelect: (requestId: string) => void;
}

const statusLabel = (
  status: PrivateBetaAccessRequestReviewDto["status"],
): string => status.replace(/_/g, " ");

const statusColor = (
  status: PrivateBetaAccessRequestReviewDto["status"],
): "default" | "warning" | "success" | "error" | "info" => {
  switch (status) {
    case "PENDING":
      return "warning";
    case "APPROVAL_IN_PROGRESS":
      return "info";
    case "APPROVED":
      return "success";
    case "REJECTED":
    case "PROVISIONING_FAILED":
      return "error";
    case "EXISTING_ACCOUNT":
      return "default";
    default:
      return "default";
  }
};

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

export const PrivateBetaAccessRequestList: React.FC<
  PrivateBetaAccessRequestListProps
> = ({ requests, selectedRequestId, isLoading, error, onSelect }) => {
  if (isLoading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <CircularProgress size={20} />
          <Typography>Loading beta requests…</Typography>
        </Stack>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Beta requests could not be loaded. Refresh and try again.
      </Alert>
    );
  }

  if (requests.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography color="text.secondary">
          No beta access requests are waiting for review.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Access requests ({requests.length})
        </Typography>
      </Box>
      <List disablePadding>
        {requests.map((request) => (
          <ListItemButton
            key={request.requestId}
            selected={request.requestId === selectedRequestId}
            onClick={() => onSelect(request.requestId)}
            alignItems="flex-start"
            sx={{
              borderBottom: 1,
              borderColor: "divider",
              "&:last-child": { borderBottom: 0 },
            }}
          >
            <ListItemText
              primary={
                <Stack
                  direction="row"
                  spacing={1}
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Typography component="span" fontWeight={600} noWrap>
                    {request.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={statusLabel(request.status)}
                    color={statusColor(request.status)}
                  />
                </Stack>
              }
              secondary={
                <Stack component="span" spacing={0.25} sx={{ mt: 0.5 }}>
                  <Typography component="span" variant="body2">
                    {request.organizationName}
                  </Typography>
                  <Typography component="span" variant="body2">
                    {request.workEmail}
                  </Typography>
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                  >
                    Submitted {formatDate(request.createdAt)}
                  </Typography>
                </Stack>
              }
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
};
