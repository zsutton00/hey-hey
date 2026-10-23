import type { RunAttachmentReference } from "../../api";
import type {
  AgentProvider,
  ReasoningEffort,
  SessionMethodSelection,
} from "./runtime";
import { useCallback, useMemo } from "react";
import { Stack } from "@mui/material";
import { useAgenticSetupSectionState } from "./useAgenticSetupSectionState";
import { AgentSetupView } from "../AgentSessions";
import { EntityType } from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import {
  listCompatibleSessionMethods,
  listSessionMethods,
} from "../../agents/coordination/sessionMethodRegistry";
import { useProjectModeCatalog } from "../../data/hooks/useProjectModeCatalog";
import { useFullEntityContext } from "../../data/hooks/useFullEntityContext";
import { useFeatureLookup } from "../../data/hooks/useFeatureHierarchy";
import { useModalService } from "../../contexts/ModalService";
import { useGuidedWalkthroughControls } from "../GuidedWalkthrough";
import { buildAddServiceWalkthrough } from "../Help/buildAddServiceWalkthrough";

export interface SessionLaunchOptions {
  provider: AgentProvider | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  fastMode?: boolean;
  machineId?: string;
}

interface AgenticSetupSectionProps {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  userId: string | null;
  boundServiceId: string | null;
  taskServiceIds?: string[];
  boundProvider: AgentProvider | null;
  lockedWorktreeBranch?: string | null;
  skipServiceSelection?: boolean;
  onPromptSubmitted: (
    sessionMethodSelection: SessionMethodSelection,
    launchOptions: SessionLaunchOptions,
    promptDraft: string,
    attachments: RunAttachmentReference[],
  ) => void;
  onLaunchValidation?: () => Promise<void> | void;
  /**
   * Task the session was launched against. Surfaced in the unified setup so
   * the user has task context visible while configuring the kickoff prompt.
   * Optional — surfaces without a task (Discuss-style launches) omit it.
   */
  taskData?: WorkItemResponseDto | null;
}

export const AgenticSetupSection = ({
  organizationId,
  projectId,
  agentSessionId,
  userId,
  boundServiceId,
  taskServiceIds = [],
  boundProvider,
  lockedWorktreeBranch,
  skipServiceSelection,
  onPromptSubmitted,
  onLaunchValidation,
  taskData = null,
}: AgenticSetupSectionProps) => {
  const { workItemTypeDefinition } = useWorkItemTypeByKey(
    organizationId,
    projectId,
    taskData?.type,
  );
  const compatibleSessionMethods = useMemo(
    () =>
      !taskData
        ? listSessionMethods()
        : workItemTypeDefinition
          ? listCompatibleSessionMethods(workItemTypeDefinition.key)
          : [],
    [taskData, workItemTypeDefinition],
  );
  const featureLookup = useFeatureLookup(organizationId, projectId);
  const cachedAncestry =
    taskData && featureLookup.isReady
      ? featureLookup.resolveAncestry(taskData.parentTaskId ?? null)
      : null;
  // The entity-context read is only the fallback for ancestry the cached
  // hierarchy cannot resolve (non-feature parents or features newer than it).
  const needsContextFallback =
    Boolean(taskData?.id) &&
    !featureLookup.isLoading &&
    !cachedAncestry?.complete;
  const taskContext = useFullEntityContext({
    organizationId,
    projectId,
    entityType: EntityType.Task,
    entityId: taskData?.id ?? "",
    enabled: needsContextFallback,
    includeRelatedEntities: false,
    includeFeatureHierarchy: true,
    includeProposals: false,
    includeAvailableMcpTools: false,
  });
  const cachedAncestorKey = cachedAncestry?.complete
    ? cachedAncestry.ancestors.map((ancestor) => ancestor.id).join(",")
    : null;
  const focalFeatureIds = useMemo(() => {
    if (!taskData) return null;
    const ids = new Set<string>();
    if (taskData.type === "FEATURE") ids.add(taskData.id);
    if (cachedAncestorKey !== null) {
      for (const id of cachedAncestorKey.split(",")) if (id) ids.add(id);
      return ids;
    }
    if (!needsContextFallback || !taskContext.data) return null;
    for (const entry of taskContext.data.featureHierarchy ?? []) {
      if (
        entry.relationshipType === "structural" &&
        entry.relationship === "ancestor"
      ) {
        ids.add(entry.id);
      }
    }
    return ids;
  }, [cachedAncestorKey, needsContextFallback, taskContext.data, taskData]);
  const projectModeCatalog = useProjectModeCatalog({
    organizationId,
    projectId,
    effectiveWorkItemTypeKey: workItemTypeDefinition?.key ?? null,
    focalFeatureIds,
  });
  const {
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
  } = useAgenticSetupSectionState({
    organizationId,
    projectId,
    agentSessionId,
    userId,
    boundServiceId,
    taskServiceIds,
    boundProvider,
    taskName: taskData?.name ?? null,
    lockedWorktreeBranch,
    skipServiceSelection,
    onPromptSubmitted,
    onLaunchValidation,
    compatibleSessionMethods,
    projectModeCatalog: projectModeCatalog.catalog,
  });

  const modals = useModalService();
  const walkthroughs = useGuidedWalkthroughControls();
  const handleAddService = useCallback((): void => {
    if (modals === null) return;
    // The services list refreshes from the create mutation; setup state is
    // untouched, so the new Service simply appears in the list.
    modals.showCreateService({
      projectId,
      onClose: () => walkthroughs?.exitWalkthrough(),
    });
    walkthroughs?.startWalkthrough(buildAddServiceWalkthrough());
  }, [modals, projectId, walkthroughs]);

  return (
    <Stack
      spacing={2}
      inert={submittingPrompt || pingingMachine || setup.starting}
    >
      <AgentSetupView
        promptAttachments={attachments}
        step={setup.step}
        primaryServices={primaryServices}
        additionalServices={additionalServices}
        loadingServices={setup.loadingServices}
        servicesError={setup.servicesError}
        selectedServiceId={setup.selectedServiceId}
        selectedServiceIds={setup.selectedServiceIds}
        isMultiServiceMode={setup.isMultiServiceMode}
        serviceSelectionLocked={Boolean(
          boundServiceId &&
          setup.services.some((service) => service.id === boundServiceId),
        )}
        onSelectService={setup.selectService}
        onToggleService={setup.toggleService}
        onContinueToSelection={setup.goToSelection}
        onBackToSessionMethod={setup.goToSessionMethod}
        sessionMethod={setup.sessionMethodSelection.method ?? null}
        onSelectSessionMethod={setup.selectSessionMethod}
        compatibleSessionMethods={compatibleSessionMethods}
        projectModeCatalog={projectModeCatalog.catalog}
        projectModeCatalogLoading={projectModeCatalog.isLoading}
        projectModeCatalogError={projectModeCatalog.error?.message ?? null}
        onSelectProjectMode={setup.selectProjectMode}
        projectModeSelection={setup.projectModeSelection}
        recoveryState={recoveryState}
        repositoryPath={setup.directoryPath}
        directoryPaths={setup.directoryPaths}
        worktreeBranch={setup.worktreeBranch}
        worktreeLocked={setup.worktreeLocked}
        setWorktreeBranch={setup.setWorktreeBranch}
        launchServiceId={setup.launchServiceId}
        onSelectLaunchService={setup.setLaunchServiceId}
        hasActiveRun={false}
        canStartCoding={canStart}
        onStartValidation={
          onLaunchValidation
            ? () => {
                void handleStartValidation();
              }
            : undefined
        }
        startingValidation={startingValidation}
        skipServiceSelection={skipServiceSelection}
        promptDraft={setup.promptDraft}
        onPromptDraftChange={setup.setPromptDraft}
        onSubmitPrompt={() => {
          void handleSubmitPrompt();
        }}
        onBackToSelection={setup.goToSelection}
        submittingPrompt={submittingPrompt || pingingMachine || setup.starting}
        launchErrorMessages={[setup.error, pingError, launchError].filter(
          (message): message is string => Boolean(message),
        )}
        catalogSource={
          selectedMachine
            ? {
                organizationId,
                projectId,
                machineId: selectedMachine.machineId,
              }
            : null
        }
        promptProvider={setup.selectedProvider}
        promptModel={setup.selectedModel}
        promptReasoningEffort={setup.selectedReasoningEffort}
        promptFastMode={setup.selectedFastMode}
        onPromptProviderChange={setup.selectProvider}
        onPromptModelChange={setup.selectModel}
        onPromptReasoningEffortChange={setup.selectReasoningEffort}
        onPromptFastModeChange={setup.selectFastMode}
        taskData={taskData}
        machines={machines}
        machineMode={mode}
        selectedMachineId={selectedMachine?.machineId ?? null}
        onSelectMachine={setSelectedMachineId}
        onAddService={modals === null ? null : handleAddService}
      />
    </Stack>
  );
};
