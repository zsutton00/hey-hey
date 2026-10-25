import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
  type SelectChangeEvent,
} from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useState } from "react";
import type { MachineDto } from "../../api";
import {
  AgentBridgeMachineGuidanceDialog,
  getAgentBridgeRecoveryActionLabel,
} from "./AgentBridgeRecoveryNotice";
import {
  resolveMachineUnavailableState,
  type AgentBridgeMachineUnavailableState,
} from "./agentBridgeRecoveryState";
import {
  classifyMachineExecutionReadiness,
  getMachineExecutionLabel,
} from "./runtime/coding/machineExecutionReadiness";

interface MachinePickerProps {
  machines: MachineDto[];
  selectedMachineId: string | null;
  onSelect: (machineId: string) => void;
  disabled?: boolean;
  mobileMode?: "summary" | "editor";
}

export const MachinePicker = ({
  machines,
  selectedMachineId,
  onSelect,
  disabled = false,
  mobileMode = "summary",
}: MachinePickerProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [mobileEditorOpen, setMobileEditorOpen, mobileEditorOpenOwnerKey] =
    useModalState(false);
  const [recoveryState, setRecoveryState] =
    useState<AgentBridgeMachineUnavailableState | null>(null);
  const selectedMachine =
    machines.find((machine) => machine.machineId === selectedMachineId) ?? null;
  const displayMachine = selectedMachine
    ? getMachineExecutionLabel(selectedMachine)
    : machines.length > 0
      ? "No machine selected"
      : "No machine available";
  const handleSelectionChange = (event: SelectChangeEvent<string>): void => {
    const machineId = event.target.value;
    const machine = machines.find(
      (candidate) => candidate.machineId === machineId,
    );
    if (machine === undefined) {
      return;
    }
    if (!classifyMachineExecutionReadiness(machine).selectable) {
      setMobileEditorOpen(false);
      setRecoveryState(resolveMachineUnavailableState(machine));
      return;
    }
    onSelect(machineId);
  };

  const editor = (
    <FormControl
      size="small"
      fullWidth
      disabled={disabled}
      data-testid="machine-picker"
      sx={{
        maxWidth: 500,
      }}
    >
      <InputLabel id="machine-picker-label">CLI machine</InputLabel>
      <Select
        labelId="machine-picker-label"
        value={selectedMachineId ?? ""}
        label="CLI machine"
        onChange={handleSelectionChange}
        data-testid="machine-picker-select"
        renderValue={() => displayMachine}
      >
        <MenuItem disabled value="" data-testid="machine-picker-placeholder">
          Select a ready CLI machine
        </MenuItem>
        {machines.map((machine) => {
          const readiness = classifyMachineExecutionReadiness(machine);
          const unavailableState = readiness.selectable
            ? null
            : resolveMachineUnavailableState(machine);
          return (
            <MenuItem
              key={machine.machineId}
              value={machine.machineId}
              data-testid="machine-picker-option"
              data-machine-id={machine.machineId}
              data-machine-readiness={readiness.state}
              data-machine-selectable={readiness.selectable ? "true" : "false"}
              aria-label={getMachineExecutionLabel(machine)}
            >
              <ListItemText
                primary={getMachineExecutionLabel(machine)}
                secondary={readiness.reason}
                slotProps={{
                  primary: { component: "span" },
                  secondary: { component: "span" },
                }}
              />
              {unavailableState ? (
                <Button
                  component="span"
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1, flexShrink: 0 }}
                >
                  {getAgentBridgeRecoveryActionLabel(unavailableState)}
                </Button>
              ) : null}
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );

  if (isMobile && mobileMode === "summary") {
    return (
      <>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ minWidth: 0 }}
          data-testid="machine-picker-mobile-summary"
        >
          <Typography
            component="span"
            variant="body2"
            noWrap
            aria-label={`CLI machine: ${displayMachine}`}
            sx={{ minWidth: 0, flex: 1, overflow: "hidden" }}
          >
            <Box component="span" sx={{ fontWeight: 600 }}>
              CLI machine:
            </Box>{" "}
            {displayMachine}
          </Typography>
          <Button
            size="small"
            startIcon={<EditOutlinedIcon />}
            onClick={() => setMobileEditorOpen(true)}
            disabled={disabled}
            data-testid="machine-picker-mobile-edit"
          >
            Edit
          </Button>
        </Stack>
        <Dialog
          ownerKey={mobileEditorOpenOwnerKey}
          open={mobileEditorOpen}
          onClose={() => setMobileEditorOpen(false)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Edit CLI machine</DialogTitle>
          <DialogContent>{editor}</DialogContent>
          <DialogActions>
            <Button onClick={() => setMobileEditorOpen(false)}>Done</Button>
          </DialogActions>
        </Dialog>
        <AgentBridgeMachineGuidanceDialog
          state={recoveryState}
          onClose={() => setRecoveryState(null)}
        />
      </>
    );
  }

  return (
    <>
      {editor}
      <AgentBridgeMachineGuidanceDialog
        state={recoveryState}
        onClose={() => setRecoveryState(null)}
      />
    </>
  );
};
