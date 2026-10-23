import {
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import { ControllerInventory } from "./ControllerInventory";

interface MachineListItemProps {
  machine: MachineDto;
  onRevoke: (machine: MachineDto) => void;
}

interface AgentBridgeReadinessPresentation {
  label: string;
  reason: string;
}

const AGENT_BRIDGE_READINESS = {
  [MachineExecutionReadinessState.NoMachineSelected]: {
    label: "Unavailable",
    reason: "This Agent Bridge is not available for local work.",
  },
  [MachineExecutionReadinessState.LegacyProtocol]: {
    label: "Update needed",
    reason:
      "This Agent Bridge uses an older Hey Hey CLI. Update it on this computer, then add a Passkey.",
  },
  [MachineExecutionReadinessState.ControllerEnrollmentRequired]: {
    label: "Needs a Passkey",
    reason:
      "On this computer, run heyhey controllers add to authorize this Agent Bridge.",
  },
  [MachineExecutionReadinessState.ControllerRevoked]: {
    label: "Passkey removed",
    reason:
      "On this computer, run heyhey controllers add to authorize this Agent Bridge again.",
  },
  [MachineExecutionReadinessState.MachineRevoked]: {
    label: "Removed",
    reason: "This Agent Bridge can no longer run work.",
  },
  [MachineExecutionReadinessState.Disconnected]: {
    label: "Offline",
    reason: "Open the Hey Hey CLI on this computer to reconnect.",
  },
  [MachineExecutionReadinessState.Ready]: {
    label: "Ready to run work",
    reason: "This Agent Bridge is connected and authorized.",
  },
} satisfies Record<
  MachineDto["executionReadiness"],
  AgentBridgeReadinessPresentation
>;

const formatLastSeen = (lastSeen: string | null | undefined): string => {
  if (!lastSeen) {
    return "Never";
  }
  const parsed = new Date(lastSeen);
  if (Number.isNaN(parsed.getTime())) {
    return "Never";
  }
  return formatDistanceToNow(parsed, { addSuffix: true });
};

export const MachineListItem: React.FC<MachineListItemProps> = ({
  machine,
  onRevoke,
}) => {
  const readiness = AGENT_BRIDGE_READINESS[machine.executionReadiness];
  const handleRevoke = (): void => {
    onRevoke(machine);
  };

  return (
    <Card
      variant="outlined"
      data-testid="settings-agent-bridge-card"
      data-machine-id={machine.machineId}
      data-machine-readiness={machine.executionReadiness}
      data-machine-active={machine.active ? "true" : "false"}
      sx={{ mb: 2 }}
    >
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "flex-start" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Agent Bridge
            </Typography>
            <Typography
              variant="h6"
              component="h3"
              data-testid="settings-agent-bridge-name"
              sx={{ fontWeight: 600 }}
            >
              {machine.name}
            </Typography>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.75 }}
            >
              <Chip
                size="small"
                label={machine.active ? "Online" : "Offline"}
                color={machine.active ? "success" : "default"}
                data-testid="settings-agent-bridge-connection"
              />
              <Typography
                variant="body2"
                color="text.secondary"
                data-testid="settings-agent-bridge-last-seen"
              >
                Last seen {formatLastSeen(machine.lastSeen)}
              </Typography>
            </Stack>
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="settings-agent-bridge-readiness"
              sx={{ mt: 1 }}
            >
              <Box
                component="span"
                sx={{ fontWeight: 600, color: "text.primary" }}
              >
                {readiness.label}.
              </Box>{" "}
              {readiness.reason}
            </Typography>
          </Box>
          <Button
            onClick={handleRevoke}
            aria-label={"Remove Agent Bridge " + machine.name}
            data-testid="settings-remove-agent-bridge"
            data-machine-id={machine.machineId}
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
          >
            Remove Agent Bridge
          </Button>
        </Stack>
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
          <ControllerInventory machine={machine} />
        </Box>
      </CardContent>
    </Card>
  );
};
