import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import LinkOffOutlinedIcon from "@mui/icons-material/LinkOffOutlined";
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useState } from "react";
import type {
  AgentBridgeMachineUnavailableState,
  AgentBridgeRecoveryState,
} from "./agentBridgeRecoveryState";

export interface AgentBridgeRecoveryNoticeProps {
  state: AgentBridgeRecoveryState;
  onStartNewSession?: () => void;
  presentation?: "agent-session" | "inline" | "composer";
  testId?: string;
}

type GeneralGuidance =
  "no_paired_machines" | "bound_machine_missing" | "status_unavailable";

type GuidanceTarget =
  | { kind: "machine"; state: AgentBridgeMachineUnavailableState }
  | { kind: "general"; type: GeneralGuidance };

const browserAuthorizationUrl = (
  state: AgentBridgeMachineUnavailableState,
): string => {
  const params = new URLSearchParams({
    section: "pairing",
    intent: "authorize-browser",
    machineId: state.machine.machineId,
    machineName: state.machine.name,
  });
  return `/pairing?${params.toString()}`;
};

const machineStatus = (state: AgentBridgeMachineUnavailableState): string => {
  switch (state.type) {
    case "disconnected":
      return "Disconnected";
    case "controller_pairing_required":
    case "controller_enrollment_required":
      return "Controller setup required";
    case "controller_revoked":
      return "All controller authority revoked";
    case "browser_authorization_required":
      return "Authorize this browser";
    case "browser_authorization_revoked":
      return "Browser authorization revoked";
    case "controller_selection_required":
      return "Controller selection required";
    case "controller_context_unavailable":
      return "Controller status unavailable";
    case "machine_revoked":
      return "Agent Bridge revoked";
    case "legacy_protocol":
      return "CLI update required";
  }
};

export const getAgentBridgeRecoveryActionLabel = (
  state: AgentBridgeMachineUnavailableState,
): string => {
  switch (state.type) {
    case "browser_authorization_required":
    case "browser_authorization_revoked":
      return "Authorize this browser";
    case "disconnected":
      return "How to reconnect";
    case "legacy_protocol":
      return "View update steps";
    case "controller_selection_required":
      return "View controller details";
    case "controller_context_unavailable":
      return "How to restore";
    case "machine_revoked":
      return "View details";
    case "controller_pairing_required":
    case "controller_enrollment_required":
    case "controller_revoked":
      return "View controller setup";
  }
};

const Command = ({ children }: { children: string }) => (
  <Box
    component="code"
    sx={{
      display: "block",
      px: 1.5,
      py: 1.25,
      borderRadius: 1,
      bgcolor: "action.hover",
      fontFamily: "monospace",
      overflowWrap: "anywhere",
    }}
  >
    {children}
  </Box>
);

const MachineGuidance = ({
  state,
}: {
  state: AgentBridgeMachineUnavailableState;
}) => {
  const name = state.machine.name;
  switch (state.type) {
    case "browser_authorization_required":
      return (
        <Stack spacing={2}>
          <Typography>
            This browser is not authorized to control {name}.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This can happen when using a different browser or device, after the
            controller authorization expires, or after clearing this site’s
            cookies.
          </Typography>
          <Typography>On {name}, run:</Typography>
          <Command>heyhey controllers add</Command>
          <Typography variant="body2" color="text.secondary">
            Keep that terminal open. The next screen will ask for its one-time
            code, create a passkey, and wait for explicit confirmation on {name}
            .
          </Typography>
        </Stack>
      );
    case "browser_authorization_revoked":
      return (
        <Stack spacing={2}>
          <Typography>
            This browser’s previous controller authorization for {name} was
            revoked. Account access and a synced passkey cannot restore it.
          </Typography>
          <Typography>On {name}, run:</Typography>
          <Command>heyhey controllers add</Command>
          <Typography variant="body2" color="text.secondary">
            Complete the passkey claim and confirm the new controller in that
            terminal.
          </Typography>
        </Stack>
      );
    case "disconnected":
      return (
        <Stack spacing={2}>
          <Typography>
            {name} is paired, but its CLI is not currently connected. Start the
            Hey Hey CLI on that machine and keep it running.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This page will refresh its connection status automatically. If the
            CLI is already running, check its network connection and status
            output.
          </Typography>
        </Stack>
      );
    case "controller_pairing_required":
      return (
        <Stack spacing={2}>
          <Typography>
            {name} does not yet have usable controller authority. Begin its
            secure pairing ceremony from that machine.
          </Typography>
          <Command>heyhey pair</Command>
        </Stack>
      );
    case "controller_enrollment_required":
    case "controller_revoked":
      return (
        <Stack spacing={2}>
          <Typography>
            {name} needs a locally confirmed controller before it can run work.
          </Typography>
          <Typography>On {name}, run:</Typography>
          <Command>heyhey controllers add</Command>
        </Stack>
      );
    case "legacy_protocol":
      return (
        <Stack spacing={2}>
          <Typography>
            Update the Hey Hey CLI on {name}, then upgrade its controller
            authority in place.
          </Typography>
          <Command>heyhey pair</Command>
        </Stack>
      );
    case "controller_selection_required":
      return (
        <Typography>
          This browser has multiple enrolled controllers for {name}. An exact
          controller must be selected before authorizing work. No controller has
          been selected automatically.
        </Typography>
      );
    case "controller_context_unavailable":
      return (
        <Stack spacing={2}>
          <Typography>
            This browser does not have controller identity for {name}.
            Refreshing cannot restore it.
          </Typography>
          <Typography>On {name}, run:</Typography>
          <Command>heyhey controllers add</Command>
          <Typography variant="body2" color="text.secondary">
            Keep that terminal open, then continue here with its one-time code
            and complete the passkey confirmation.
          </Typography>
        </Stack>
      );
    case "machine_revoked":
      return (
        <Typography>
          {name} was revoked and cannot receive work. Adding a browser
          controller does not restore a revoked Agent Bridge.
        </Typography>
      );
  }
};

const GuidanceDialog = ({
  target,
  onClose,
}: {
  target: GuidanceTarget | null;
  onClose: () => void;
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const machineState = target?.kind === "machine" ? target.state : null;
  const title = machineState
    ? `${machineStatus(machineState)} — ${machineState.machine.name}`
    : target?.kind === "general" && target.type === "no_paired_machines"
      ? "Pair an Agent Bridge"
      : target?.kind === "general" && target.type === "bound_machine_missing"
        ? "Agent Bridge no longer paired"
        : "Agent Bridge status unavailable";
  const authorizable =
    machineState?.type === "browser_authorization_required" ||
    machineState?.type === "browser_authorization_revoked" ||
    machineState?.type === "controller_context_unavailable";

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      fullWidth
      fullScreen={fullScreen}
      maxWidth="sm"
      data-testid="agent-bridge-recovery-guidance-dialog"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {machineState ? (
          <MachineGuidance state={machineState} />
        ) : target?.kind === "general" &&
          target.type === "no_paired_machines" ? (
          <Stack spacing={2}>
            <Typography>
              Run the pairing command on the computer that should become an
              Agent Bridge, then complete its passkey claim in Hey Hey.
            </Typography>
            <Command>heyhey pair</Command>
          </Stack>
        ) : target?.kind === "general" &&
          target.type === "bound_machine_missing" ? (
          <Typography>
            This session’s previous Agent Bridge is no longer in your paired
            inventory. Open Agent Bridge settings to review or pair a machine.
          </Typography>
        ) : (
          <Typography>
            Hey Hey could not verify Agent Bridge status. Refresh after the
            connection is restored.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {authorizable && machineState ? (
          <Button
            variant="contained"
            href={browserAuthorizationUrl(machineState)}
            data-testid="agent-bridge-authorize-browser-continue"
          >
            Continue
          </Button>
        ) : target?.kind === "general" &&
          (target.type === "no_paired_machines" ||
            target.type === "bound_machine_missing") ? (
          <Button variant="contained" href="/pairing">
            Continue
          </Button>
        ) : target?.kind === "general" &&
          target.type === "status_unavailable" ? (
          <Button variant="contained" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
};

export const AgentBridgeMachineGuidanceDialog = ({
  state,
  onClose,
}: {
  state: AgentBridgeMachineUnavailableState | null;
  onClose: () => void;
}) => (
  <GuidanceDialog
    target={state ? { kind: "machine", state } : null}
    onClose={onClose}
  />
);

const NoticeText = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2" color="text.secondary">
    {children}
  </Typography>
);

const RecoveryRow = ({
  state,
  onOpen,
}: {
  state: AgentBridgeMachineUnavailableState;
  onOpen: (state: AgentBridgeMachineUnavailableState) => void;
}) => (
  <Stack
    direction={{ xs: "column", sm: "row" }}
    spacing={1}
    alignItems={{ xs: "stretch", sm: "center" }}
    data-testid="agent-bridge-recovery-machine-row"
    data-machine-id={state.machine.machineId}
  >
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
      {(state.type === "browser_authorization_required" ||
        state.type === "browser_authorization_revoked") && (
        <LinkOffOutlinedIcon color="warning" fontSize="small" />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {state.machine.name}
        </Typography>
        <NoticeText>{machineStatus(state)}</NoticeText>
      </Box>
    </Stack>
    <Button
      size="small"
      variant="outlined"
      onClick={() => onOpen(state)}
      data-testid="agent-bridge-recovery-action"
    >
      {getAgentBridgeRecoveryActionLabel(state)}
    </Button>
  </Stack>
);

export const AgentBridgeRecoveryNotice = ({
  state,
  onStartNewSession,
  presentation = "agent-session",
  testId = "agent-bridge-recovery-notice",
}: AgentBridgeRecoveryNoticeProps) => {
  const [guidanceTarget, setGuidanceTarget] = useState<GuidanceTarget | null>(
    null,
  );
  if (state.type === "loading" || state.type === "ready") return null;

  const openMachineGuidance = (
    unavailableState: AgentBridgeMachineUnavailableState,
  ) => setGuidanceTarget({ kind: "machine", state: unavailableState });

  const content = (() => {
    switch (state.type) {
      case "status_unavailable":
        return (
          <Button
            size="small"
            onClick={() =>
              setGuidanceTarget({ kind: "general", type: "status_unavailable" })
            }
          >
            Agent Bridge status unavailable
          </Button>
        );
      case "multiple_ready":
        return (
          <NoticeText>Select a ready Agent Bridge to continue.</NoticeText>
        );
      case "no_paired_machines":
        return (
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              setGuidanceTarget({ kind: "general", type: "no_paired_machines" })
            }
          >
            Pair an Agent Bridge
          </Button>
        );
      case "bound_machine_missing":
        return (
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              setGuidanceTarget({
                kind: "general",
                type: "bound_machine_missing",
              })
            }
          >
            Review Agent Bridge settings
          </Button>
        );
      case "legacy_non_resumable":
        return (
          <Stack spacing={1} alignItems="center">
            <NoticeText>
              This session predates the current Agent Bridge pairing system and
              cannot continue. Its conversation history remains available.
            </NoticeText>
            {onStartNewSession ? (
              <Button size="small" onClick={onStartNewSession}>
                Start a new session
              </Button>
            ) : (
              <NoticeText>Start a new session to continue.</NoticeText>
            )}
          </Stack>
        );
      case "paired_none_ready":
        return (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {state.machines.map((machineState) => (
              <RecoveryRow
                key={machineState.machine.machineId}
                state={machineState}
                onOpen={openMachineGuidance}
              />
            ))}
          </Stack>
        );
      case "disconnected":
      case "controller_pairing_required":
      case "controller_enrollment_required":
      case "controller_revoked":
      case "browser_authorization_required":
      case "browser_authorization_revoked":
      case "controller_context_unavailable":
      case "controller_selection_required":
      case "machine_revoked":
      case "legacy_protocol":
        return <RecoveryRow state={state} onOpen={openMachineGuidance} />;
    }
  })();

  return (
    <Box
      data-testid={testId}
      sx={{
        width: "100%",
        ...(presentation === "composer"
          ? {
              p: { xs: 1.5, sm: 2 },
              minHeight: 84,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
            }
          : {}),
        ...(presentation === "agent-session"
          ? { mt: 2, mx: "auto", maxWidth: 640 }
          : {}),
      }}
    >
      {content}
      <GuidanceDialog
        target={guidanceTarget}
        onClose={() => setGuidanceTarget(null)}
      />
    </Box>
  );
};
