import CloseIcon from "@mui/icons-material/Close";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useRunContextUsageSelection } from "./runtime/hooks/useRunContextUsageSelection";
import type { RunContextUsageState } from "./runtime/runContextUsageState";
import type {
  CliReadProviderSessionUsageCost,
  CliReadProviderUsage,
  CliReadRunContextUsageResult,
} from "../../api";
import type { ProviderSessionChoice } from "./RunContextUsageCapsules";
import { useRunContextUsage } from "./runtime/hooks/useRunContextUsage";
import type { AgentProvider } from "./runtime/types";
import { useProviderUsage } from "../../data/hooks/useProviderUsage";
import { StateContent } from "../Activity/ProviderUsage/ProviderUsageActivityView";
import {
  resolveProviderUsageViewState,
  type ProviderUsageViewState,
} from "../Activity/ProviderUsage/resolveProviderUsageViewState";

const formatTokens = (value: number): string => value.toLocaleString();
const formatCost = (cost: CliReadProviderSessionUsageCost): string =>
  cost.state === "available"
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: cost.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(cost.amountUsd)
    : "Unavailable";

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" justifyContent="space-between" spacing={3}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
      {value}
    </Typography>
  </Stack>
);

const UsageBody = ({
  result,
  usage,
  providerUsage,
}: {
  result: CliReadRunContextUsageResult;
  usage: RunContextUsageState;
  providerUsage: ReactNode;
}) => {
  const cost = usage.lastSuccessfulCost ?? result.cost;
  const lastKnownCost =
    usage.lastSuccessfulCost &&
    (result.cost.state === "unavailable" || usage.status === "unavailable");
  const data = result.contextData;
  return (
    <Stack spacing={3} data-testid="run-context-usage-content">
      <Stack spacing={0.5}>
        <SummaryRow label="Model" value={data.model} />
        <SummaryRow
          label="Total tokens"
          value={`${formatTokens(data.totalTokens)} / ${formatTokens(
            data.rawMaxTokens,
          )}`}
        />
        <SummaryRow
          label="Context used"
          value={`${data.percentage.toFixed(1)}%`}
        />
        <Box data-testid="run-context-usage-cost">
          <SummaryRow
            label={lastKnownCost ? "Last known cost" : "Cost"}
            value={formatCost(cost)}
          />
        </Box>
        {usage.contextReceivedAt != null ? (
          <Typography
            variant="caption"
            data-testid="run-context-usage-context-freshness"
          >
            Context received{" "}
            {new Date(usage.contextReceivedAt).toLocaleString()} (
            {Math.max(
              0,
              Math.floor((Date.now() - usage.contextReceivedAt) / 1000),
            )}
            s ago)
          </Typography>
        ) : null}
        {usage.costReceivedAt != null ? (
          <Typography
            variant="caption"
            data-testid="run-context-usage-cost-freshness"
          >
            Cost received {new Date(usage.costReceivedAt).toLocaleString()} (
            {Math.max(
              0,
              Math.floor((Date.now() - usage.costReceivedAt) / 1000),
            )}
            s ago)
          </Typography>
        ) : null}
        {result.cost.state === "unavailable" ? (
          <Alert
            severity="info"
            data-testid="run-context-usage-cost-unavailable"
          >
            {result.cost.message ||
              "Cost is unavailable for this provider session."}{" "}
            ({result.cost.reason})
          </Alert>
        ) : null}
      </Stack>

      {providerUsage}

      {data.categories.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Categories</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell align="right">Tokens</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.categories.map((category) => (
                <TableRow key={category.name}>
                  <TableCell>{category.name}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                    {formatTokens(category.tokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      ) : null}

      {data.memoryFiles.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Memory files</Typography>
          {data.memoryFiles.map((file) => (
            <SummaryRow
              key={file.path}
              label={file.path}
              value={formatTokens(file.tokens)}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
};

/** Mounted only while the modal is open, so the CLI is read on open. */
const ProviderUsageSection = ({
  organizationId,
  projectId,
  agentSessionId,
  provider,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  provider: AgentProvider;
}) => {
  const usage = useProviderUsage(organizationId, projectId, agentSessionId, {
    refetchOnMount: true,
  });
  const state = resolveProviderUsageViewState(usage);

  if (state.kind !== "ready") {
    return <StateContent state={state} />;
  }

  const providerUsage =
    state.providers.find((entry) => entry.provider === provider) ??
    ({
      provider,
      status: "error",
      observedAt: null,
      fiveHour: null,
      weekly: null,
    } satisfies CliReadProviderUsage);
  const selectedProviderState: ProviderUsageViewState = {
    kind: "ready",
    providers: [providerUsage],
  };

  return <StateContent state={selectedProviderState} />;
};

export const RunContextUsageModal = ({
  open,
  onClose,
  organizationId,
  projectId,
  agentSessionId,
  runId,
  providerSessions,
  provider,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string;
  providerSessions: ProviderSessionChoice[];
  provider: AgentProvider;
}) => {
  const { providerSessionId, selectSession } = useRunContextUsageSelection(
    JSON.stringify([organizationId, projectId, agentSessionId, runId]),
    providerSessions,
  );
  const usage = useRunContextUsage({
    organizationId,
    projectId,
    agentSessionId,
    runId,
    ...(providerSessionId ? { providerSessionId } : {}),
    enabled: open,
  });
  const isWaitingForSelectedSession =
    usage.data !== null &&
    (usage.data.runId !== runId ||
      usage.data.providerSessionId !== providerSessionId);
  const providerUsage = (
    <ProviderUsageSection
      organizationId={organizationId}
      projectId={projectId}
      agentSessionId={agentSessionId}
      provider={provider}
    />
  );
  const handleSessionChange = (event: SelectChangeEvent<string>) =>
    selectSession(event.target.value);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="run-context-usage-modal"
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography component="span" variant="h6">
          Context usage
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="Close context usage"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {providerSessions.length > 1 ? (
          <FormControl size="small" fullWidth sx={{ mb: 2 }}>
            <InputLabel id="run-context-usage-session-picker-label">
              Session
            </InputLabel>
            <Select
              labelId="run-context-usage-session-picker-label"
              label="Session"
              value={providerSessionId ?? ""}
              onChange={handleSessionChange}
              data-testid="run-context-usage-session-picker"
            >
              {providerSessions.map((session) => (
                <MenuItem key={session.id} value={session.id}>
                  {session.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        {(providerSessionId &&
          !usage.data &&
          (usage.status === "loading" || usage.status === "idle")) ||
        isWaitingForSelectedSession ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid="run-context-usage-loading"
          >
            <CircularProgress size={32} />
          </Box>
        ) : null}
        {usage.status === "unavailable" ? (
          <Alert
            severity={usage.errorCode === "TIMEOUT" ? "warning" : "error"}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={usage.retry}
                data-testid="run-context-usage-retry"
              >
                Retry
              </Button>
            }
            data-testid="run-context-usage-error"
          >
            {usage.errorCode === "TIMEOUT"
              ? "Context usage timed out. The connected computer may be unavailable."
              : usage.error}
          </Alert>
        ) : null}
        {usage.data &&
        usage.status === "loading" &&
        !isWaitingForSelectedSession ? (
          <Typography role="status" data-testid="run-context-usage-refreshing">
            Refreshing…
          </Typography>
        ) : null}
        {usage.data && !isWaitingForSelectedSession ? (
          <UsageBody
            result={usage.data}
            usage={usage}
            providerUsage={providerUsage}
          />
        ) : (
          <Box sx={{ mb: 3 }}>{providerUsage}</Box>
        )}
        {usage.data?.cost.state === "unavailable" &&
        usage.status !== "unavailable" &&
        !isWaitingForSelectedSession ? (
          <Button
            onClick={usage.retry}
            disabled={usage.status === "loading"}
            data-testid="run-context-usage-retry"
          >
            Retry
          </Button>
        ) : null}
        {!providerSessionId && usage.status === "idle" ? (
          <Alert severity="info">
            No provider session is available for this Run.
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
