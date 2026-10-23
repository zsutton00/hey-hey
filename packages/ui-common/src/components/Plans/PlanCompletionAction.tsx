import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { useCallback, useMemo, useState } from "react";
import { EntityType, WorkStatus } from "../../api";
import { useCanonicalPlanMutations } from "../../data";
import {
  EntityConversationPromptDialog,
  type EntityConversationPromptRuntimeSelection,
} from "../InteractionComponent";
import { useEntityConversationLauncher } from "../InteractionComponent/useEntityConversationLauncher";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import {
  DISCUSS_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import { CapsuleAction } from "../ActionsCapsule";
import { buildPlanCompletionReviewPrompt } from "./planCompletionPrompt";
import type { ReasoningEffort } from "../AgentSession/runtime/types";

export interface PlanCompletionActionProps {
  organizationId: string;
  projectId: string;
  planId: string;
  planTitle: string;
  planStatus: WorkStatus;
  disabled?: boolean;
}

type CompletionState = "idle" | "completing" | "launching";

const getFailureMessage = (failure: unknown, fallback: string): string =>
  failure instanceof Error && failure.message ? failure.message : fallback;

export const PlanCompletionAction = ({
  organizationId,
  projectId,
  planId,
  planTitle,
  planStatus,
  disabled = false,
}: PlanCompletionActionProps) => {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [completionState, setCompletionState] =
    useState<CompletionState>("idle");
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [reviewLaunchError, setReviewLaunchError] = useState<string | null>(
    null,
  );
  const [completionSucceeded, setCompletionSucceeded] = useState(false);
  const { machines, selectedMachine, setSelectedMachineId } =
    useMachineResolution();
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const { updatePlan } = useCanonicalPlanMutations(organizationId, projectId);
  const conversationLauncher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });

  const updateSelection = useCallback(
    (patch: (current: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((current) => {
        const next = patch(current);
        writeSurfaceSelection(DISCUSS_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );

  const resetAndClose = useCallback(() => {
    if (completionState !== "idle") return;
    setOpen(false);
    setCompletionState("idle");
    setGuidance("");
    setCompletionError(null);
    setReviewLaunchError(null);
    setCompletionSucceeded(false);
  }, [completionState]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setCompletionError(null);
    setReviewLaunchError(null);
  }, []);

  const completePlan = useCallback(async () => {
    const result = await updatePlan(planId, { status: WorkStatus.Completed });
    if (result.status === "pending") {
      throw new Error(
        "The Plan completion is waiting for approval and was not applied.",
      );
    }
  }, [planId, updatePlan]);

  const launchReview = useCallback(
    async (prompt: string) => {
      const currentSelection = selection;
      if (!currentSelection) {
        setReviewLaunchError(
          "Wait for the machine's model choices to load, then pick a model.",
        );
        return;
      }
      setReviewLaunchError(null);
      setCompletionState("launching");
      try {
        const launched = await conversationLauncher.launch({
          prompt,
          context: {
            entityId: projectId,
            entityType: EntityType.Project,
          },
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
        });
        if (!launched) {
          setReviewLaunchError(
            conversationLauncher.error?.message ??
              "The Plan was completed, but the project review could not be started.",
          );
          return;
        }
        setOpen(false);
        setGuidance("");
        setCompletionError(null);
        setReviewLaunchError(null);
        setCompletionSucceeded(false);
      } catch (failure) {
        setReviewLaunchError(
          getFailureMessage(
            failure,
            "The Plan was completed, but the project review could not be started.",
          ),
        );
      } finally {
        setCompletionState("idle");
      }
    },
    [conversationLauncher, projectId, selectedMachine, selection],
  );

  const completeAndReview = useCallback(
    async (prompt: string) => {
      if (completionState !== "idle") return;
      if (completionSucceeded) {
        await launchReview(prompt);
        return;
      }

      setCompletionState("completing");
      setCompletionError(null);
      setReviewLaunchError(null);
      try {
        await completePlan();
        setCompletionSucceeded(true);
        await launchReview(prompt);
      } catch (failure) {
        setCompletionError(
          getFailureMessage(failure, "The Plan could not be completed."),
        );
        setCompletionState("idle");
      }
    },
    [completionState, completionSucceeded, completePlan, launchReview],
  );

  const complete = useCallback(async () => {
    if (completionState !== "idle") return;
    setCompletionState("completing");
    setCompletionError(null);
    setReviewLaunchError(null);
    try {
      await completePlan();
      resetAndClose();
    } catch (failure) {
      setCompletionError(
        getFailureMessage(failure, "The Plan could not be completed."),
      );
      setCompletionState("idle");
    }
  }, [completePlan, completionState, resetAndClose]);

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

  if (planStatus !== WorkStatus.Verifying && !open) {
    return null;
  }

  return (
    <>
      {planStatus === WorkStatus.Verifying ? (
        <CapsuleAction
          id="complete-plan"
          label="Complete"
          icon={CheckCircleOutlineIcon}
          behavior="click"
          onClick={handleOpen}
          disabled={disabled || completionState !== "idle"}
          inProgress={completionState !== "idle"}
          actionGroup="page"
          tier="page"
          order={20}
        />
      ) : null}
      <EntityConversationPromptDialog
        open={open}
        title={`Complete Plan: ${planTitle}`}
        question={
          "Would you like to check the project for updates resulting from this completed Plan?"
        }
        preCannedPrompt={buildPlanCompletionReviewPrompt(planTitle)}
        userInput={guidance}
        onUserInputChange={setGuidance}
        onClose={resetAndClose}
        onSubmit={(prompt) => void completeAndReview(prompt)}
        primaryAction={{
          label: "Complete and Review",
          pendingLabel: "Starting review…",
          pending: completionState === "launching",
          testId: "plan-completion-complete-and-review",
          error: reviewLaunchError
            ? {
                message: reviewLaunchError,
                testId: "plan-review-launch-error",
              }
            : null,
        }}
        secondaryAction={{
          label: "Complete",
          pendingLabel: "Completing…",
          pending: completionState === "completing",
          testId: "plan-completion-complete",
          error: completionError
            ? {
                message: completionError,
                testId: "plan-completion-error",
              }
            : null,
          onClick: () => void complete(),
        }}
        inputLabel="Additional guidance (optional)"
        testIdPrefix="plan-completion"
        questionTestId="plan-completion-review-question"
        inputTestId="plan-completion-guidance"
        runtimeTestId="plan-completion-runtime"
        runtimeSelection={runtimeSelection}
      />
    </>
  );
};
