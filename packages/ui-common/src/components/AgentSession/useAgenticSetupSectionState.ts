import { getMethodConfig } from "../../agents/coordination/sessionMethodRegistry";
import { useFileAttachments } from "./runtime/hooks/useFileAttachments";
import { prepareInitialPromptSubmission } from "./runtime/coding/prepareInitialPromptSubmission";
import type { RunAttachmentReference } from "../../api";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  useAgentSetup,
  type AgentProvider,
  type SessionMethodSelection,
} from "./runtime";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import type { MachineResolutionMode } from "./runtime/coding/useMachineResolution";
import type { MachineDto } from "../../api";
import type { SessionLaunchOptions } from "./AgenticSetupSection";
import { submitMachinePingViaPlatform } from "./runtime/hooks/submitMachinePingViaPlatform";
import { supportsFastMode } from "./capabilityCatalog";
import {
  buildAgentSetupDraftContextKey,
  removeAgentSetupDraft,
} from "./agentSetupDraftMemory";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import type { SessionMethod } from "../../agents/coordination/types";
import type { ProjectModeCatalogEntry } from "../../agents/coordination/projectModeCatalog";

interface UseAgenticSetupSectionStateParams {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  userId: string | null;
  boundServiceId: string | null;
  taskServiceIds: string[];
  boundProvider: AgentProvider | null;
  taskName: string | null;
  lockedWorktreeBranch?: string | null;
  skipServiceSelection?: boolean;
  /**
   * Fired when the user submits the prompt — the single moment a
   * coding session's run is materialized. Carries the prompt text the user
   * authored (may be empty for workflow-orchestrated methods that don't need
   * a user kickoff).
   */
  onPromptSubmitted: (
    sessionMethodSelection: SessionMethodSelection,
    launchOptions: SessionLaunchOptions,
    promptDraft: string,
    attachments: RunAttachmentReference[],
  ) => void;
  onLaunchValidation?: () => Promise<void> | void;
  compatibleSessionMethods: readonly SessionMethod[];
  projectModeCatalog: readonly ProjectModeCatalogEntry[];
}

export const useAgenticSetupSectionState = ({
  organizationId,
  projectId,
  agentSessionId,
  userId,
  boundServiceId,
  taskServiceIds,
  boundProvider,
  taskName,
  lockedWorktreeBranch,
  skipServiceSelection,
  onPromptSubmitted,
  onLaunchValidation,
  compatibleSessionMethods,
  projectModeCatalog,
}: UseAgenticSetupSectionStateParams) => {
  const { machines, mode, selectedMachine, setSelectedMachineId, isReady } =
    useMachineResolution();

  const setup = useAgentSetup({
    runtimeReady: true,
    organizationId,
    projectId,
    agentSessionId,
    userId,
    boundServiceId,
    taskServiceIds,
    boundProvider,
    taskName,
    lockedWorktreeBranch: lockedWorktreeBranch ?? null,
    skipServiceSelection,
    selectedMachine,
    projectModeCatalog,
  });

  const canStart = setup.canStart && selectedMachine !== null;

  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !isReady,
        machines,
        selectedMachineId: selectedMachine?.machineId ?? null,
      }),
    [isReady, machines, selectedMachine?.machineId],
  );

  const taskServiceIdSet = useMemo(
    () => new Set(taskServiceIds),
    [taskServiceIds],
  );

  const allServiceOptions = useMemo(
    () =>
      setup.services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
      })),
    [setup.services],
  );

  const primaryServices = useMemo(
    () =>
      allServiceOptions.filter((service) => taskServiceIdSet.has(service.id)),
    [allServiceOptions, taskServiceIdSet],
  );

  const additionalServices = useMemo(
    () =>
      allServiceOptions.filter((service) => !taskServiceIdSet.has(service.id)),
    [allServiceOptions, taskServiceIdSet],
  );

  const [pingError, setPingError] = useState<string | null>(null);
  const [pingingMachine, setPingingMachine] = useState(false);
  const [submittingPrompt, setSubmittingPrompt] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const selectedMethod = setup.sessionMethodSelection.method;
  const handlerDriven =
    Boolean(setup.sessionMethodSelection.projectModeSelection) ||
    Boolean(
      selectedMethod &&
      selectedMethod !== "validation" &&
      getMethodConfig(selectedMethod).dispatch.kind === "handler",
    );
  const attachments = useFileAttachments(
    selectedMachine
      ? { kind: "pre-run", machineId: selectedMachine.machineId }
      : null,
    agentSessionId,
    !handlerDriven
      ? "File attachments are unavailable for workflow methods."
      : !submittingPrompt && !pingingMachine,
  );

  // Run materialization. The single commit point: ping the chosen
  // machine, validate path mappings, persist the agent session record (and
  // create the conversation if missing), then fire `onStarted` with the
  // kickoff prompt the user authored. The consumer flips page mode to
  // "active" and threads the prompt into CodingSession, which auto-dispatches
  // the start-run as the sole moment the coding session's run is materialized.
  const handleSubmitPrompt = useCallback(async () => {
    if (submittingRef.current) return;
    setPingError(null);
    setLaunchError(null);
    const selectedMethod = setup.sessionMethodSelection.method;
    if (!setup.sessionMethodSelection.projectModeSelection) {
      if (
        selectedMethod === "validation" ||
        !selectedMethod ||
        !compatibleSessionMethods.includes(selectedMethod)
      ) {
        setLaunchError(
          "The selected session method is not available for this work-item type. Choose an available method before submitting.",
        );
        return;
      }
    }
    if (!setup.validateProjectModeSelection()) {
      setLaunchError(
        "The selected project mode is no longer available for this task. Choose an available mode before submitting.",
      );
      return;
    }
    if (!selectedMachine?.active) {
      setPingError("Select an active machine before submitting the prompt.");
      return;
    }
    const submission = prepareInitialPromptSubmission({
      prompt: setup.promptDraft,
      machineId: selectedMachine?.machineId ?? null,
      entries: attachments.entries,
      handlerDriven,
    });
    if (!submission.ok) {
      setLaunchError(submission.error);
      return;
    }

    submittingRef.current = true;
    setSubmittingPrompt(true);
    try {
      if (selectedMachine?.machineId) {
        setPingingMachine(true);
        try {
          const pingResult = await submitMachinePingViaPlatform(
            selectedMachine.machineId,
          );
          if (!pingResult.ok) {
            setPingError(pingResult.error);
            return;
          }
          if (!pingResult.acknowledged) {
            setPingError(
              "The selected machine is not reachable. Make sure the CLI is running and connected.",
            );
            return;
          }
        } finally {
          setPingingMachine(false);
        }
      }

      if (!skipServiceSelection) {
        const mapped = await setup.mapDirectory();
        if (mapped === false) return;
      }
      const result = await setup.start();
      if (!result.ok) {
        return;
      }
      onPromptSubmitted(
        setup.sessionMethodSelection,
        {
          provider: setup.selectedProvider,
          model: setup.selectedModel,
          reasoningEffort: setup.selectedReasoningEffort,
          ...(setup.selectedProvider &&
          setup.selectedModel &&
          supportsFastMode(setup.selectedProvider, setup.selectedModel)
            ? { fastMode: setup.selectedFastMode }
            : {}),
          machineId: submission.machineId,
        },
        submission.prompt,
        submission.attachments,
      );
      attachments.clearSubmitted(submission.attachments);
      removeAgentSetupDraft(
        userId,
        buildAgentSetupDraftContextKey(
          organizationId,
          projectId,
          agentSessionId,
        ),
      );
    } finally {
      submittingRef.current = false;
      setSubmittingPrompt(false);
    }
  }, [
    agentSessionId,
    attachments,
    handlerDriven,
    compatibleSessionMethods,
    onPromptSubmitted,
    organizationId,
    projectId,
    selectedMachine,
    setup,
    skipServiceSelection,
    userId,
  ]);

  const [startingValidation, setStartingValidation] = useState(false);

  const handleStartValidation = useCallback(async () => {
    if (!onLaunchValidation) return;
    setStartingValidation(true);
    try {
      await onLaunchValidation();
    } finally {
      setStartingValidation(false);
    }
  }, [onLaunchValidation]);

  return {
    setup,
    attachments,
    primaryServices,
    additionalServices,
    canStart,
    recoveryState,
    mode,
    machines,
    selectedMachine,
    setSelectedMachineId,
    handleSubmitPrompt,
    submittingPrompt,
    handleStartValidation,
    startingValidation,
    pingError,
    pingingMachine,
    launchError,
  };
};

export type { MachineResolutionMode, MachineDto };
