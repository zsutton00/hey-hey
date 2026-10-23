import { useCallback, useMemo } from "react";
import { Box, Button, Stack } from "@mui/material";
import type { GoalPmRoutingCreation } from "../../../api";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import { buildEntityConversationSessionConfig } from "../../AgentSession/entityConversationSessionConfig";
import type { ModelSelectorMachineSelectionProps } from "../../AgentSession/ModelSelector";
import { RuntimeModelSelector } from "../../AgentSession/RuntimeModelSelector";
import { resolveAgentBridgeRecoveryState } from "../../AgentSession/agentBridgeRecoveryState";
import { useMachineResolution } from "../../AgentSession/runtime/coding/useMachineResolution";
import {
  GOAL_PM_NEW_CONVERSATION_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../../AgentSession/useSurfaceSelection";

interface GoalPmNewConversationActionProps {
  organizationId: string;
  projectId: string;
  /** Label of the Start Conversation button. */
  label: string;
  optionId: string;
  disabled: boolean;
  onStart: (creation: GoalPmRoutingCreation) => void;
}

/**
 * The Start Conversation button with the runtime selector beneath it. The
 * selector state is local; the button starts the conversation with exactly the
 * provider, model, effort, Fast mode and machine the selector displays.
 */
export function GoalPmNewConversationAction({
  organizationId,
  projectId,
  label,
  optionId,
  disabled,
  onStart,
}: GoalPmNewConversationActionProps) {
  const machineResolution = useMachineResolution();
  const selectedMachineId =
    machineResolution.selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId: GOAL_PM_NEW_CONVERSATION_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const updateSelection = useCallback(
    (patch: (prev: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((prev) => {
        const next = patch(prev);
        writeSurfaceSelection(GOAL_PM_NEW_CONVERSATION_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );
  const machineSelection = useMemo<ModelSelectorMachineSelectionProps>(
    () => ({
      machines: machineResolution.machines,
      machineMode: machineResolution.mode,
      selectedMachineId,
      onSelectMachine: machineResolution.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machineResolution.isReady,
        machines: machineResolution.machines,
        selectedMachineId,
      }),
    }),
    [
      machineResolution.isReady,
      machineResolution.machines,
      machineResolution.mode,
      machineResolution.setSelectedMachineId,
      selectedMachineId,
    ],
  );

  const start = () => {
    if (!selection || !selectedMachineId) return;
    onStart({
      config: buildEntityConversationSessionConfig(selection),
      provider: selection.provider,
      machineId: selectedMachineId,
      ...(supportsFastMode(selection.provider, selection.model)
        ? { fastMode: selection.fastMode ?? false }
        : {}),
    });
  };

  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Button
        variant="outlined"
        data-testid="goal-pm-record-choice"
        data-option-id={optionId}
        disabled={disabled || !selection || !selectedMachineId}
        onClick={start}
        sx={{ alignSelf: "flex-start", textTransform: "none" }}
      >
        {label}
      </Button>
      <Box sx={{ minWidth: 0 }} data-testid="goal-pm-runtime-selector">
        <RuntimeModelSelector
          testIdPrefix="goal-pm-runtime"
          disabled={disabled}
          catalogSource={catalogSource}
          provider={selection?.provider ?? null}
          model={selection?.model ?? null}
          reasoningEffort={selection?.reasoningEffort ?? null}
          fastMode={selection?.fastMode ?? false}
          onProviderChange={(provider) =>
            updateSelection((prev) => ({ ...prev, provider }))
          }
          onModelChange={(model) =>
            updateSelection((prev) => ({ ...prev, model }))
          }
          onReasoningEffortChange={(reasoningEffort) =>
            updateSelection((prev) => ({ ...prev, reasoningEffort }))
          }
          onFastModeChange={(fastMode) =>
            updateSelection((prev) => ({ ...prev, fastMode }))
          }
          machineSelection={machineSelection}
        />
      </Box>
    </Stack>
  );
}
