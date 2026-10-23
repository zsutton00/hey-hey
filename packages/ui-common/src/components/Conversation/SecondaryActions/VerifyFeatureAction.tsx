import { Stack } from "@mui/material";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import type { VerifyFeaturePayload } from "../../../api";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { useMachineResolution } from "../../AgentSession/runtime/coding/useMachineResolution";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import {
  DISCUSS_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../../AgentSession/useSurfaceSelection";
import {
  EntityConversationPromptDialog,
  type EntityConversationPromptRuntimeSelection,
} from "../../InteractionComponent";
import { useFeatureSyncConversationLauncher } from "../../InteractionComponent/useFeatureSyncConversationLauncher";
import type { SecondaryActionContext } from "../../LlmForms/Registry/types";
import type { ReasoningEffort } from "../../AgentSession/runtime/types";
import { ProjectTopologyButton } from "../../shared/ProjectTopologyButton";
import {
  VerificationRuntimeContext,
  resolveVerificationRuntimeContext,
} from "./verificationRuntimeContext";

export function VerifyFeatureAction({
  check,
  context,
}: {
  check: VerifyFeaturePayload;
  context: SecondaryActionContext;
}) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const source = useAgentSession(
    context.organizationId,
    context.projectId,
    context.agentSessionId,
  );
  const runtime = useContext(VerificationRuntimeContext);
  const runtimeContext = useMemo(
    () => resolveVerificationRuntimeContext(runtime, source.data),
    [runtime, source.data],
  );
  const launcher = useFeatureSyncConversationLauncher(context);
  const { machines, selectedMachine, setSelectedMachineId } =
    useMachineResolution(runtimeContext.machineId);
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? {
            organizationId: context.organizationId,
            projectId: context.projectId,
            machineId: selectedMachineId,
          }
        : null,
    [context.organizationId, context.projectId, selectedMachineId],
  );
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });

  // The dialog may change the selection and submit in one event, before this
  // component re-renders, so submit reads the latest choice from the ref.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const updateSelection = useCallback(
    (patch: (current: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((current) => {
        const next = patch(current);
        selectionRef.current = next;
        writeSurfaceSelection(DISCUSS_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );

  const handleSubmit = useCallback(
    (prompt: string): void => {
      const currentSelection = selectionRef.current;
      if (!currentSelection || !runtimeContext.parentAgentSessionId) return;
      void launcher
        .launch({
          prompt,
          provider: currentSelection.provider,
          model: currentSelection.model,
          reasoningEffort:
            currentSelection.reasoningEffort as ReasoningEffort | null,
          machineId: selectedMachine?.machineId ?? "",
          ...(supportsFastMode(
            currentSelection.provider,
            currentSelection.model,
          )
            ? { fastMode: currentSelection.fastMode ?? false }
            : {}),
          check,
          parentAgentSessionId: runtimeContext.parentAgentSessionId,
          ...(runtimeContext.serviceIds.length > 0
            ? { serviceIds: runtimeContext.serviceIds }
            : {}),
          ...(runtimeContext.launchServiceId
            ? { launchServiceId: runtimeContext.launchServiceId }
            : {}),
        })
        .then((succeeded) => {
          if (succeeded) {
            setOpen(false);
            setGuidance("");
          }
        });
    },
    [check, launcher, runtimeContext, selectedMachine],
  );

  const handleClose = useCallback(() => {
    if (launcher.isLoading) return;
    setOpen(false);
    setGuidance("");
    launcher.clearError();
  }, [launcher]);

  const handleOpen = useCallback(() => {
    setGuidance("");
    launcher.clearError();
    setOpen(true);
  }, [launcher]);

  const runtimeSelection: EntityConversationPromptRuntimeSelection = {
    machines,
    selectedMachineId: selectedMachine?.machineId ?? null,
    onMachineChange: setSelectedMachineId,
    catalogSource,
    provider: selection?.provider ?? null,
    model: selection?.model ?? null,
    reasoningEffort: selection?.reasoningEffort ?? null,
    fastMode: selection?.fastMode ?? false,
    onProviderChange: (provider) =>
      updateSelection((current) => ({ ...current, provider })),
    onModelChange: (model) =>
      updateSelection((current) => ({ ...current, model })),
    onReasoningEffortChange: (reasoningEffort) =>
      updateSelection((current) => ({ ...current, reasoningEffort })),
    onFastModeChange: (fastMode) =>
      updateSelection((current) => ({ ...current, fastMode })),
  };

  return (
    <Stack spacing={1} alignItems="flex-start">
      <ProjectTopologyButton
        loading={launcher.isLoading}
        disabled={!runtimeContext.parentAgentSessionId}
        onClick={handleOpen}
      />
      {open && (
        <EntityConversationPromptDialog
          open
          onClose={handleClose}
          onSubmit={handleSubmit}
          title="Verify Feature"
          question="Look closely at the flagged concern and determine whether feature or task updates are warranted."
          preCannedPrompt={check.explanation}
          userInput={guidance}
          onUserInputChange={setGuidance}
          primaryAction={{
            label: "Start verification",
            pendingLabel: "Starting verification…",
            pending: launcher.isLoading,
            testId: "verify-feature-submit",
            error: launcher.error
              ? {
                  message: launcher.error,
                  testId: "verify-feature-launch-error",
                }
              : null,
          }}
          runtimeSelection={runtimeSelection}
          inputLabel="Additional guidance (optional)"
          testIdPrefix="verify-feature"
          questionTestId="verify-feature-question"
          inputTestId="verify-feature-guidance"
          runtimeTestId="verify-feature-runtime"
        />
      )}
    </Stack>
  );
}
