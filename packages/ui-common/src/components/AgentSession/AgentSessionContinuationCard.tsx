import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  AgentSessionContinuationInspectionReason,
  type MachineDto,
} from "../../api";
import { AgentBridgeRecoveryNotice } from "./AgentBridgeRecoveryNotice";
import type {
  ContinuationAttemptActionState,
  ContinuationOfferState,
  ContinuationPendingState,
} from "./agentSessionContinuationRecoveryState";
import type {
  AgentSessionContinuationControls,
  ContinuationFailureCause,
} from "./useAgentSessionContinuation";

export interface AgentSessionContinuationCardProps {
  state:
    | ContinuationOfferState
    | ContinuationPendingState
    | ContinuationAttemptActionState;
  controls: AgentSessionContinuationControls;
  selectedDestinationId: string | null;
  onSelectDestination: (machineId: string) => void;
  /** Validated internal path of this conversation, kept through pairing. */
  pairingHref: string;
  /** Names of paired computers by id, for a destination outside `destinations`. */
  machineNames: ReadonlyMap<string, string>;
}

const failureKey = (cause: ContinuationFailureCause): string =>
  `agentSession.continuation.failure.${cause}`;

const reasonKey = (reason: AgentSessionContinuationInspectionReason): string =>
  `agentSession.continuation.reason.${reason}`;

const Frame = ({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: React.ReactNode;
}) => (
  <Box data-testid={testId} sx={{ width: "100%", py: 0.5 }}>
    <Typography
      component="h2"
      variant="subtitle1"
      sx={{ fontWeight: 600, mb: 0.75 }}
    >
      {title}
    </Typography>
    {children}
  </Box>
);

const Body = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>
    {children}
  </Typography>
);

const Note = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="body2"
    color="text.secondary"
    sx={{ mt: 1.5, opacity: 0.85 }}
  >
    {children}
  </Typography>
);

/**
 * Replaces the reply editor when the session's previous computer is revoked
 * or removed. Render-only: readiness comes from the recovery state owner and
 * every action goes through the continuation coordinator.
 */
export const AgentSessionContinuationCard = ({
  state,
  controls,
  selectedDestinationId,
  onSelectDestination,
  pairingHref,
  machineNames,
}: AgentSessionContinuationCardProps) => {
  const { t } = useTranslation();
  const { phase } = controls;

  if (state.type === "continuation_pending") {
    const name = machineNames.get(state.continuation.destinationMachineId);
    return (
      <Frame
        testId="agent-session-continuation-pending"
        title={t("agentSession.continuation.pending.title")}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {name
              ? t("agentSession.continuation.pending.body", { name })
              : t("agentSession.continuation.pending.bodyUnnamed")}
          </Typography>
        </Stack>
      </Frame>
    );
  }

  const busy = phase.kind === "inspecting" || phase.kind === "committing";
  const failure =
    phase.kind === "failed" ? (
      <Alert
        severity="error"
        sx={{ mt: 1.5 }}
        data-testid="agent-session-continuation-failure"
        data-cause={phase.cause}
        action={
          phase.canRetry ? (
            <Button
              color="inherit"
              size="small"
              onClick={controls.retry}
              data-testid="agent-session-continuation-retry"
            >
              {t("agentSession.continuation.retry")}
            </Button>
          ) : undefined
        }
      >
        {t(failureKey(phase.cause), { name: phase.destination.name })}
      </Alert>
    ) : null;
  const unreadyDestination = (name: string) => (
    <Body>
      {t("agentSession.continuation.attempt.destinationUnready", { name })}
    </Body>
  );
  const attemptDestinationName =
    state.type === "continuation_failed" ||
    state.type === "continuation_uncertain" ||
    state.type === "continuation_confirm_history"
      ? (state.destination?.name ??
        machineNames.get(state.continuation.destinationMachineId) ??
        t("agentSession.continuation.attempt.unnamed"))
      : "";

  if (state.type === "continuation_confirm_history") {
    const { continuation, destination } = state;
    const reason = continuation.inspectionReason;
    const showReason =
      continuation.nativeResumeRejectedAt === null &&
      reason !== AgentSessionContinuationInspectionReason.NoLocalRun &&
      reason !== AgentSessionContinuationInspectionReason.ProviderStatePresent;
    return (
      <Frame
        testId="agent-session-continuation-saved-history"
        title={t("agentSession.continuation.savedHistory.title")}
      >
        <Body>{t("agentSession.continuation.savedHistory.body")}</Body>
        {continuation.nativeResumeRejectedAt !== null ? (
          <Body>
            {t("agentSession.continuation.savedHistory.resumeRejected")}
          </Body>
        ) : null}
        {showReason ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 1.75 }}
            data-testid="agent-session-continuation-inspection-reason"
            data-reason={reason}
          >
            {t(reasonKey(reason))}
          </Typography>
        ) : null}
        {destination ? null : unreadyDestination(attemptDestinationName)}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            disabled={busy || destination === null}
            onClick={() =>
              destination &&
              controls.confirmSavedHistory(continuation, destination)
            }
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            data-testid="agent-session-continuation-confirm-history"
          >
            {t("agentSession.continuation.savedHistory.confirm")}
          </Button>
          <Button
            color="inherit"
            disabled={busy}
            onClick={() => controls.cancel(continuation)}
            data-testid="agent-session-continuation-cancel"
          >
            {t("agentSession.continuation.cancel")}
          </Button>
        </Stack>
        {failure}
      </Frame>
    );
  }

  if (state.type === "continuation_uncertain") {
    const { continuation, destination } = state;
    const name = attemptDestinationName;
    return (
      <Frame
        testId="agent-session-continuation-attempt-uncertain"
        title={t("agentSession.continuation.title")}
      >
        <Body>
          {t("agentSession.continuation.attempt.uncertainBody", { name })}
        </Body>
        {destination ? (
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => controls.retryDelivery(continuation, destination)}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            data-testid="agent-session-continuation-check-again"
            data-machine-id={destination.machineId}
          >
            {t("agentSession.continuation.attempt.checkAgain", { name })}
          </Button>
        ) : (
          unreadyDestination(name)
        )}
        {failure}
      </Frame>
    );
  }

  if (state.type === "continuation_failed") {
    const { continuation, destination } = state;
    const name = attemptDestinationName;
    return (
      <Frame
        testId="agent-session-continuation-attempt-failed"
        title={t("agentSession.continuation.title")}
      >
        <Body>
          <span
            data-testid="agent-session-continuation-outcome-code"
            data-code={continuation.outcomeCode ?? ""}
          >
            {t("agentSession.continuation.attempt.failedBody", {
              name,
              code: continuation.outcomeCode,
            })}
          </span>
        </Body>
        {destination ? null : unreadyDestination(name)}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {destination ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => controls.retryDelivery(continuation, destination)}
              startIcon={busy ? <CircularProgress size={16} /> : undefined}
              data-testid="agent-session-continuation-retry-delivery"
              data-machine-id={destination.machineId}
            >
              {t("agentSession.continuation.attempt.retry", { name })}
            </Button>
          ) : null}
          <Button
            color="inherit"
            disabled={busy}
            onClick={() => controls.cancel(continuation)}
            data-testid="agent-session-continuation-release"
          >
            {t("agentSession.continuation.attempt.chooseAnother")}
          </Button>
        </Stack>
        {failure}
      </Frame>
    );
  }

  const { destinations, unavailable } = state;

  if (destinations.length === 0 && unavailable.length > 0) {
    return (
      <Frame
        testId="agent-session-continuation-unready"
        title={t("agentSession.continuation.title")}
      >
        <Body>{t("agentSession.continuation.unready.body")}</Body>
        <AgentBridgeRecoveryNotice
          state={{ type: "paired_none_ready", machines: unavailable }}
          presentation="inline"
          testId="agent-session-continuation-unready-machines"
        />
      </Frame>
    );
  }

  if (destinations.length === 0) {
    return (
      <Frame
        testId="agent-session-continuation-pair"
        title={t("agentSession.continuation.title")}
      >
        <Body>{t("agentSession.continuation.pair.body")}</Body>
        <Button
          variant="outlined"
          href={pairingHref}
          data-testid="agent-session-continuation-pair-button"
        >
          {t("agentSession.continuation.pair.action")}
        </Button>
        <Note>{t("agentSession.continuation.pair.note")}</Note>
      </Frame>
    );
  }

  const selected =
    destinations.find(
      (machine) => machine.machineId === selectedDestinationId,
    ) ?? destinations[0]!;

  return (
    <Frame
      testId="agent-session-continuation-offer"
      title={t("agentSession.continuation.title")}
    >
      <Body>{t("agentSession.continuation.offer.body")}</Body>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        {destinations.length > 1 ? (
          <TextField
            select
            size="small"
            label={t("agentSession.continuation.offer.destinationLabel")}
            value={selected.machineId}
            onChange={(event) => onSelectDestination(event.target.value)}
            disabled={busy}
            sx={{ minWidth: 220 }}
            slotProps={{
              htmlInput: {
                "data-testid": "agent-session-continuation-destination",
              },
            }}
          >
            {destinations.map((machine: MachineDto) => (
              <MenuItem
                key={machine.machineId}
                value={machine.machineId}
                data-testid="agent-session-continuation-destination-option"
                data-machine-id={machine.machineId}
              >
                {machine.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => controls.continueOn(selected)}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          data-testid="agent-session-continuation-continue"
          data-machine-id={selected.machineId}
        >
          {phase.kind === "inspecting"
            ? t("agentSession.continuation.offer.checking", {
                name: selected.name,
              })
            : phase.kind === "committing"
              ? t("agentSession.continuation.offer.continuing", {
                  name: selected.name,
                })
              : t("agentSession.continuation.offer.action", {
                  name: selected.name,
                })}
        </Button>
      </Stack>
      {failure}
    </Frame>
  );
};
