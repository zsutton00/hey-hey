import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import CancelIcon from "@mui/icons-material/Cancel";
import SaveIcon from "@mui/icons-material/Save";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Typography,
} from "@mui/material";
// Icons are now imported in the useConversationPanel hook
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  StagedContentTypeId,
  TargetEntityType,
  WorkStatus,
  EntityType,
} from "../../api";
import { TrackingProvider } from "../../contexts/TrackingContext";
import { useConversation } from "../../data/hooks/useConversation";
import { useConversationPolling } from "../../data/hooks/useConversationPolling";
import { useDeleteConversation } from "../../data/hooks/useDeleteConversation";
import { useProject } from "../../data/hooks/useProject";
import { RefinerChat } from "../AgentSession/RefinerChat";
import { useStagedContentReveal } from "../../data/hooks/useStagedContentReveal";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
// Removed useInitiativeWebSocket - now handled at page level with automatic cache sync
import { useLocalDraftRecovery } from "../../hooks/useLocalDraftRecovery";
import { useLockedEditorSync } from "../../hooks/useLockedEditorSync";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard";
import { subscribeSuggestionAppliedEvent } from "../../services/editorSync/suggestionAppliedBus";
import { compose } from "../../i18n/compose";
import { KEYS } from "../../i18n/keys";
import type { LevelType } from "../../types/workItem";
import { buildFeatureDiffMessage } from "../../utils/featureDiffMessage";
import { log } from "../../utils/logger";
import {
  getTaskContentFromSections,
  hasSelectedSection,
  selectWorkItemSections,
  taskContentToSectionInputs,
  type WorkItemSectionSelection,
} from "../../utils/workItemSections";
import { getCurrentLevelFromStatus } from "../../utils/workItemUtils";
import { CapsuleAction } from "../ActionsCapsule";
import { useEntityConversationLauncher } from "../InteractionComponent/useEntityConversationLauncher";
import { DISCUSS_SURFACE_ID } from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import { EditorConversationPanel } from "../Conversation";
import {
  RunBrowserProvider,
  type RunBrowserContextValue,
} from "../AgentSession/runtime/RunBrowserContext";
import {
  ConversationViewer,
  DISABLED_CONVERSATION_SCROLL_POLICY,
} from "../Conversation/ConversationViewer";
import { CreateDocumentModal } from "../DesignDoc/CreateDocumentModal";
import { SaveReasonModal } from "../ProposalDispatchers/SaveReasonModal";
import { ThinkingIndicator } from "../ThinkingIndicator";
import { MOCKUP_TYPE_KEY } from "../shared/visualArtifacts";
import { createProgressiveTemplate } from "./progressiveTemplate";
import { UnifiedWorkItemEditor } from "./UnifiedWorkItemEditor";
import { WorkItemRefinementActions } from "./WorkItemRefinementActions";
import { useRegisterWorkItemUnsavedChanges } from "./WorkItemUnsavedChangesBridge";
import { resolveFileReferenceScope } from "../SmarterTextAreaCard/fileReferences/types";
import { MachinePicker } from "../AgentSession/MachinePicker";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";

// Multi-level types for progressive disclosure

interface MultiLevelContent extends Record<string, string> {
  description: string;
  acceptanceCriteria: string;
  requirements: string;
}

const LEGACY_INITIATIVE_CONTENT_KEYS = [
  "description",
  "acceptanceCriteria",
  "requirements",
] as const;

type WorkItemContentKey = string;
type RevealableWorkItemLevel = Exclude<LevelType, "description">;

const EMPTY_MULTI_LEVEL_CONTENT: MultiLevelContent = {
  description: "",
  acceptanceCriteria: "",
  requirements: "",
};

const INITIATIVE_SECTION_SELECTION: WorkItemSectionSelection = {
  status: "resolved",
  typeKey: "INITIATIVE",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
    { key: "requirements", label: "Requirements" },
  ],
};

const REVEAL_STAGE_LABEL: Record<RevealableWorkItemLevel, string> = {
  acceptanceCriteria: "acceptance criteria",
};

export interface WorkItemEditorProps {
  /** Entity type - 'initiative' or 'task' */
  entityType: "initiative" | "task";
  /** Work item ID for context */
  workItemId: string;
  /** Organization ID for API calls */
  organizationId: string;
  /** Project ID for API calls */
  projectId: string;
  /** Initiative ID when editing a task */
  initiativeId?: string;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Optional title for the work item */
  title?: string;
  /** Called when clean completion should return the current entity to read mode. */
  onDone?: (workItemId: string) => void;
}

export const WorkItemEditor: React.FC<WorkItemEditorProps> = ({
  entityType,
  workItemId,
  organizationId,
  projectId,
  disabled = false,
  title,
  onDone,
}) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen, deleteDialogOpenOwnerKey] =
    useModalState(false);
  const [discardDialogOpen, setDiscardDialogOpen, discardDialogOpenOwnerKey] =
    useModalState(false);
  const [
    revealAllDialogOpen,
    setRevealAllDialogOpen,
    revealAllDialogOpenOwnerKey,
  ] = useModalState(false);
  const [pendingRevealStage, setPendingRevealStage] =
    useState<RevealableWorkItemLevel | null>(null);
  const [isRevealingAll, setIsRevealingAll] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [saveMode, setSaveMode] = useState<"silent" | "feedback" | null>(null);
  const [saveSuccessCount, setSaveSuccessCount] = useState(0);
  const [reasonModalOpen, setReasonModalOpen, reasonModalOpenOwnerKey] =
    useModalState(false);
  const [pendingProposalMessage, setPendingProposalMessage] = useState<
    string | null
  >(null);
  const reasonModalResolverRef = useRef<((ok: boolean) => void) | null>(null);

  // Multi-level state management
  const [currentLevel, setCurrentLevel] = useState<LevelType>("description");

  // Load work item data before deriving editor state. The registry definition
  // is the only source of task section membership.
  const {
    workItem: workItemData,
    isLoading: isWorkItemLoading,
    error: workItemError,
    refetch: refetchWorkItem,
    markStale: markWorkItemStale,
  } = useWorkItem(organizationId, entityType, workItemId, {
    projectId,
    enabled: !!organizationId && !!workItemId,
    includeServiceRelations: true,
  });

  const workItemStatus = workItemData?.status;
  const taskType =
    entityType === "task" && workItemData && "type" in workItemData
      ? workItemData.type
      : undefined;
  const fileReferenceScope = resolveFileReferenceScope(taskType, workItemId);
  const fileReferenceConfig = fileReferenceScope
    ? { organizationId, projectId, scope: fileReferenceScope }
    : undefined;
  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(
      organizationId,
      projectId,
      entityType === "task" ? taskType : undefined,
    );
  const taskSectionSelection = useMemo(
    () =>
      selectWorkItemSections({
        typeKey: taskType,
        definition: workItemTypeDefinition,
        isFetched: isWorkItemTypeFetched,
      }),
    [isWorkItemTypeFetched, taskType, workItemTypeDefinition],
  );
  const sectionSelection: WorkItemSectionSelection =
    entityType === "task" ? taskSectionSelection : INITIATIVE_SECTION_SELECTION;
  const workItemContentKeys = useMemo<readonly WorkItemContentKey[]>(
    () =>
      sectionSelection.status === "resolved"
        ? sectionSelection.sections.map((section) => section.key)
        : [],
    [sectionSelection],
  );
  const workItemContentKeySet = useMemo(
    () => new Set(workItemContentKeys),
    [workItemContentKeys],
  );

  // Multi-level content state
  const [contentLoaded, setContentLoaded] = useState(false);
  const {
    state: contentSyncState,
    hasUnsavedChanges: hasAnyUnsavedChanges,
    applyUserPatch,
    applyAcceptedSuggestion,
    applyServerRefresh,
    replaceDraft,
    discardDraft,
    commitDraftAsBase,
  } = useLockedEditorSync<MultiLevelContent, WorkItemContentKey>({
    documentKey: workItemId,
    initialDocument: EMPTY_MULTI_LEVEL_CONTENT,
    fields:
      entityType === "task"
        ? workItemContentKeys
        : LEGACY_INITIATIVE_CONTENT_KEYS,
  });
  const multiLevelContent = contentSyncState.draft;

  useEffect(() => {
    const unsubscribe = subscribeSuggestionAppliedEvent((event) => {
      if (
        event.target !== "work-item" ||
        event.workItemId !== workItemId ||
        event.entityType !== entityType
      ) {
        return;
      }

      const patch: Partial<Pick<MultiLevelContent, WorkItemContentKey>> = {};
      for (const section of event.sections) {
        if (workItemContentKeySet.has(section.key)) {
          patch[section.key] = section.content;
        }
      }

      applyAcceptedSuggestion(patch);
      setContentLoaded(true);
    });

    return unsubscribe;
  }, [applyAcceptedSuggestion, entityType, workItemContentKeySet, workItemId]);

  useUnsavedChangesGuard({
    when: hasAnyUnsavedChanges && !isSavingContent,
  });

  useLocalDraftRecovery<MultiLevelContent>({
    storageKey: `work-item-draft:${organizationId}:${projectId}:${entityType}:${workItemId}`,
    value: multiLevelContent,
    isDirty: hasAnyUnsavedChanges,
    isSaving: isSavingContent,
    onRestore: (draftValue) => {
      replaceDraft(draftValue);
      setSaveMode(null);
      setContentLoaded(true);
    },
    clearSignal: saveSuccessCount,
  });

  // Determine content type based on entity type
  const contentType = StagedContentTypeId.WorkItem;

  // Track conversationId for staged-content reveal and initiative refinement.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [
    isCreateDesignDocOpen,
    setIsCreateDesignDocOpen,
    isCreateDesignDocOpenOwnerKey,
  ] = useModalState(false);
  const { searchEntities } = useMentionEntitySearch(
    organizationId,
    projectId,
    conversationId,
  );
  const entitySlashConfig = useMemo(
    () => ({
      organizationId,
      projectId,
      focalEntity: {
        kind: "entity" as const,
        entityType:
          entityType === "task" ? EntityType.Task : EntityType.Initiative,
        entityId: workItemId,
      },
      onSearchEntities: searchEntities,
    }),
    [entityType, organizationId, projectId, searchEntities, workItemId],
  );

  const parentTaskId = workItemData?.parentTaskId ?? null;
  const requirementsEditorConfig = useMemo(
    () =>
      entityType === "task"
        ? {
            typeKey: taskType,
            organizationId,
            projectId,
            featureId: workItemId,
            parentId: parentTaskId,
            onSearchEntities: searchEntities,
          }
        : undefined,
    [
      entityType,
      organizationId,
      parentTaskId,
      projectId,
      searchEntities,
      taskType,
      workItemId,
    ],
  );

  // Load project data
  const {
    data: project,
    isLoading: isProjectLoading,
    error: projectError,
  } = useProject(organizationId, projectId);

  // Launches the feature's entity-conversation for the "Submit and Create
  // Task" flow — the agent there owns task-proposal creation.
  const conversationLauncher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });
  const {
    machines,
    mode: machineMode,
    selectedMachine,
    setSelectedMachineId,
  } = useMachineResolution();
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const { selection: runtimeSelection } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });

  // The mockup pencil opens tabs in the conversation's Run, so it exists only
  // while that window is open and its session has a conversation.
  const [isConversationOpen, setIsConversationOpen] = useState(false);
  const [refinerRunContext, setRefinerRunContext] =
    useState<RunBrowserContextValue | null>(null);
  const runBrowserContext = isConversationOpen ? refinerRunContext : null;

  const handleConversationReady = useCallback(
    (readyConversationId: string) => {
      setConversationId((previous) => previous ?? readyConversationId);
      void refetchWorkItem();
    },
    [refetchWorkItem],
  );

  const handleCreateNewConversation = useCallback(async () => {
    // No-op: session is managed by RefinerChat.
  }, []);

  // Get update functions for work items
  const { updateTask } = useWorkItems(organizationId, "task", projectId);

  const skipsAcceptanceCriteriaReveal =
    sectionSelection.status === "resolved" &&
    !hasSelectedSection(sectionSelection, "acceptanceCriteria");

  // Check if all sections have content for reveal all button
  const canRevealAll = sectionSelection.status === "resolved";

  const refreshWorkItemData = useCallback(async () => {
    markWorkItemStale?.();
    try {
      await refetchWorkItem();
    } catch (refreshError) {
      log.error(
        "general",
        "Failed to refresh work item after staged update",
        refreshError,
      );
    }
  }, [markWorkItemStale, refetchWorkItem]);

  // Load conversation
  const {
    data: conversation,
    isLoading: isConversationLoading,
    error: conversationError,
    refetch: originalRefetchConversation,
  } = useConversation(
    organizationId,
    projectId,
    { conversationId: conversationId! },
    {
      enabled: !!conversationId && entityType === "initiative",
      includeSuggestionDecisions: true,
    },
  );

  const refetchConversation = useCallback(async (): Promise<void> => {
    await originalRefetchConversation();
  }, [originalRefetchConversation]);

  // Polling for conversation updates
  const { isWaitingForFirstMessage } = useConversationPolling(conversation, {
    enabled: !!conversation,
    interval: 3000,
    onPoll: refetchConversation,
  });

  // Computed states
  const refinementData = conversationId ? { conversationId } : null;

  // Progressive disclosure using staged content reveal
  const { revealStage } = useStagedContentReveal({
    organizationId,
    projectId,
    contentType,
    entityId: workItemId,
    conversationId: conversationId ?? undefined,
    onError: setError,
  });

  // Create wrapper functions for progressive template
  const revealNextStage = useCallback(
    async (targetStage: RevealableWorkItemLevel): Promise<void> => {
      if (!conversationId) {
        return;
      }

      try {
        const result = await revealStage(targetStage);
        if (result !== undefined) {
          setCurrentLevel(targetStage);
          await refreshWorkItemData();
        }
      } catch (err) {
        log.error(
          "general",
          `Failed to reveal ${REVEAL_STAGE_LABEL[targetStage]}`,
          err,
        );
      }
    },
    [conversationId, refreshWorkItemData, revealStage],
  );

  const handleSaveBeforeRevealDialogClose = useCallback(() => {
    if (isSavingContent) {
      return;
    }
    setPendingRevealStage(null);
  }, [isSavingContent]);

  const performSaveContent = useCallback(
    async (reason: string): Promise<boolean> => {
      if (isSavingContent) {
        return false;
      }

      if (entityType === "task" && sectionSelection.status !== "resolved") {
        setError("Work item type definition is unavailable. Please try again.");
        return false;
      }

      setIsSavingContent(true);
      setSaveMode("silent");
      setError(null);
      setPendingProposalMessage(null);

      try {
        await updateTask(
          workItemId,
          {
            sections: taskContentToSectionInputs(multiLevelContent, {
              selection: sectionSelection,
            }),
            reason,
          },
          {
            sectionSelection,
            onPendingProposal: () => {
              setPendingProposalMessage(
                t(
                  "Your edits were submitted as a proposal and are waiting for review.",
                ),
              );
            },
          },
        );

        commitDraftAsBase();
        setSaveSuccessCount((current) => current + 1);
        return true;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to save work item content";
        setError(message);
        return false;
      } finally {
        setSaveMode(null);
        setIsSavingContent(false);
      }
    },
    [
      commitDraftAsBase,
      entityType,
      isSavingContent,
      multiLevelContent,
      sectionSelection,
      t,
      updateTask,
      workItemId,
    ],
  );

  const handleSaveContent = useCallback(async (): Promise<boolean> => {
    if (isSavingContent) {
      return false;
    }

    if (!hasAnyUnsavedChanges) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      reasonModalResolverRef.current = resolve;
      setReasonModalOpen(true);
    });
  }, [hasAnyUnsavedChanges, isSavingContent]);

  const handleReasonModalSubmit = useCallback(
    async (reason: string) => {
      setReasonModalOpen(false);
      const ok = await performSaveContent(reason);
      const resolver = reasonModalResolverRef.current;
      reasonModalResolverRef.current = null;
      resolver?.(ok);
    },
    [performSaveContent],
  );

  // "Submit and Create Task": save the feature edit, then hand the agent a
  // synthetic message describing what changed so it can draft an
  // implementation task. Only wired in for Feature work items.
  const handleReasonModalSecondaryAction = useCallback(
    async (reason: string) => {
      if (!selectedMachine) {
        setError(
          machineMode === "zero"
            ? "No CLI is connected. Connect or pair a CLI machine to create a task."
            : "Select a CLI machine before creating a task.",
        );
        return;
      }
      if (!runtimeSelection) {
        setError(
          t(
            "The selected machine's model choices have not loaded yet. Try again in a moment.",
          ),
        );
        return;
      }
      // Capture the before/after content now — performSaveContent commits the
      // draft as the new base, which would erase the diff if read afterwards.
      const syntheticMessage = buildFeatureDiffMessage(
        contentSyncState.base,
        contentSyncState.draft,
      );

      setReasonModalOpen(false);
      const ok = await performSaveContent(reason);
      const resolver = reasonModalResolverRef.current;
      reasonModalResolverRef.current = null;
      resolver?.(ok);

      if (!ok) {
        return;
      }

      const launched = await conversationLauncher.launch({
        prompt: syntheticMessage,
        context: {
          entityId: workItemId,
          entityType: TargetEntityType.Task,
          entityTitle: title,
          ...(taskType ? { entitySubtype: taskType } : {}),
        },
        provider: runtimeSelection.provider,
        model: runtimeSelection.model,
        reasoningEffort: runtimeSelection.reasoningEffort,
        machineId: selectedMachine.machineId,
      });

      if (!launched) {
        setError(
          t(
            "Your changes were saved, but we couldn't start drafting a task. Please try again.",
          ),
        );
      }
    },
    [
      contentSyncState.base,
      contentSyncState.draft,
      conversationLauncher,
      performSaveContent,
      t,
      taskType,
      title,
      workItemId,
      machineMode,
      selectedMachine,
      runtimeSelection,
    ],
  );

  const handleReasonModalClose = useCallback(() => {
    if (isSavingContent) {
      return;
    }
    setReasonModalOpen(false);
    const resolver = reasonModalResolverRef.current;
    reasonModalResolverRef.current = null;
    resolver?.(false);
  }, [isSavingContent]);

  const handleSaveAndReveal = useCallback(async (): Promise<void> => {
    if (!pendingRevealStage || isSavingContent) {
      return;
    }

    const revealTarget = pendingRevealStage;
    const saveSucceeded = await handleSaveContent();
    if (!saveSucceeded) {
      return;
    }

    setPendingRevealStage(null);
    await revealNextStage(revealTarget);
  }, [handleSaveContent, isSavingContent, pendingRevealStage, revealNextStage]);

  const handleDoneEditing = useCallback(() => {
    onDone?.(workItemId);
  }, [onDone, workItemId]);

  const discardUnsavedChanges = useCallback(() => {
    discardDraft();
    setSaveMode(null);
    setError(null);
    setSaveSuccessCount((current) => current + 1);
  }, [discardDraft]);

  const handleCancelEdit = useCallback(() => {
    if (disabled || isSavingContent) {
      return;
    }

    if (hasAnyUnsavedChanges) {
      setDiscardDialogOpen(true);
      return;
    }

    handleDoneEditing();
  }, [disabled, handleDoneEditing, hasAnyUnsavedChanges, isSavingContent]);

  const handleDiscardDialogClose = useCallback(() => {
    if (isSavingContent) {
      return;
    }
    setDiscardDialogOpen(false);
  }, [isSavingContent]);

  const handleDiscardConfirm = useCallback(() => {
    discardUnsavedChanges();
    setDiscardDialogOpen(false);
  }, [discardUnsavedChanges]);

  useRegisterWorkItemUnsavedChanges({
    hasUnsavedChanges: hasAnyUnsavedChanges,
    save: handleSaveContent,
    discard: discardUnsavedChanges,
  });

  const handleCloseCreateDesignDoc = useCallback(() => {
    setIsCreateDesignDocOpen(false);
  }, []);

  const handleRevealAllSections = useCallback(async () => {
    setIsRevealingAll(true);
    setRevealAllDialogOpen(false);

    try {
      const nextStatus = skipsAcceptanceCriteriaReveal
        ? WorkStatus.Backlog
        : WorkStatus.RefiningAcceptanceCriteria;

      await updateTask(workItemId, {
        status: nextStatus,
      });

      // Update local level state
      setCurrentLevel(
        nextStatus === WorkStatus.RefiningAcceptanceCriteria
          ? "acceptanceCriteria"
          : "description",
      );

      // Refresh work item data to reflect new status
      await refreshWorkItemData();
    } catch (err) {
      log.error("general", "Failed to reveal all sections", err);
      setError("Failed to reveal all sections. Please try again.");
    } finally {
      setIsRevealingAll(false);
    }
  }, [
    skipsAcceptanceCriteriaReveal,
    updateTask,
    workItemId,
    refreshWorkItemData,
  ]);

  const handleSetReady = useCallback(async () => {
    setIsRevealingAll(true);

    try {
      await updateTask(workItemId, {
        status: WorkStatus.Backlog,
      });

      await refreshWorkItemData();
    } catch (err) {
      log.error("general", "Failed to set ready", err);
      setError("Failed to set to ready. Please try again.");
    } finally {
      setIsRevealingAll(false);
    }
  }, [updateTask, workItemId, refreshWorkItemData]);

  const handleRevealAllClick = () => {
    if (!canRevealAll) {
      return;
    }

    if (skipsAcceptanceCriteriaReveal) {
      void handleSetReady();
      return;
    }

    // If already at acceptance criteria stage, set to ready directly without dialog
    if (workItemStatus === WorkStatus.RefiningAcceptanceCriteria) {
      void handleSetReady();
    } else {
      // Otherwise show the skip refinement dialog
      setRevealAllDialogOpen(true);
    }
  };

  const handleRevealAllCancel = () => {
    setRevealAllDialogOpen(false);
  };

  // Delete conversation functionality (development only)
  const { mutate: deleteConversation, isPending: isDeleting } =
    useDeleteConversation({
      onSuccess: () => {
        setDeleteDialogOpen(false);
        // Conversation state will update automatically via refetchConversation
      },
      onError: (error) => {
        setDeleteDialogOpen(false);
        setError(error.message || "Failed to delete conversation");
      },
    });

  const handleDeleteConfirm = () => {
    if (conversation && refinementData?.conversationId) {
      deleteConversation({
        organizationId,
        projectId,
        conversationId: conversation.id,
      });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  // WebSocket integration is now handled at the page level with automatic cache sync
  // This ensures TanStack Query cache stays in sync without manual state updates

  // Debug logging
  log.debug("general", "WorkItemEditor Debug", {
    refinementData,
    conversation,
    project,
    workItemData,
    isProjectLoading,
    isWorkItemLoading,
    isConversationLoading,
    // WebSocket logging now handled at page level
  });

  // Sync server content into the locked draft state.
  // Clean drafts auto-refresh; dirty drafts keep user edits and track pending server updates.
  useEffect(() => {
    if (workItemData) {
      const taskContent = getTaskContentFromSections(
        workItemData.sections,
        sectionSelection,
      );
      applyServerRefresh(taskContent);

      if (workItemData.status) {
        setCurrentLevel(
          getCurrentLevelFromStatus(workItemData.status, {
            entityType: "task",
            sectionSelection,
          }),
        );
      }
    }

    if (!isWorkItemLoading) {
      setContentLoaded(true);
    }
  }, [
    applyServerRefresh,
    entityType,
    isWorkItemLoading,
    sectionSelection,
    workItemData,
  ]);

  // Note: handleDirectEdit removed as the unified editor handles content changes directly

  const onContentChange = useCallback(
    (newContent: MultiLevelContent) => {
      log.editorChange("WorkItemEditor.onContentChange called", {
        newContent,
        previousContent: multiLevelContent,
        entityType,
        workItemId,
      });

      const patch: Partial<Pick<MultiLevelContent, WorkItemContentKey>> = {};
      for (const key of workItemContentKeys) {
        if (newContent[key] !== multiLevelContent[key]) {
          patch[key] = newContent[key];
        }
      }

      if (Object.keys(patch).length > 0) {
        applyUserPatch(patch);
      }
    },
    [
      applyUserPatch,
      entityType,
      multiLevelContent,
      workItemContentKeys,
      workItemId,
    ],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {pendingProposalMessage && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => setPendingProposalMessage(null)}
          data-testid="pending-proposal-indicator"
        >
          {pendingProposalMessage}
        </Alert>
      )}

      {/* Main Editor Layout - Side by Side */}
      <RunBrowserProvider value={runBrowserContext}>
        <EditorConversationPanel
          initiallyOpen={entityType === "task" && taskType === MOCKUP_TYPE_KEY}
          onConversationOpenChange={setIsConversationOpen}
          leftContent={
            <>
              {/* Main Editor Area */}
              {isWorkItemLoading ||
              !contentLoaded ||
              (entityType === "task" &&
                sectionSelection.status === "unavailable" &&
                sectionSelection.reason === "loading") ? (
                /* Loading State for Main Editor */
                <Paper
                  elevation={0}
                  sx={{
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 400,
                    p: 4,
                    gap: 2,
                  }}
                >
                  <CircularProgress size={40} />
                  <Typography variant="h6" color="text.secondary">
                    {isWorkItemLoading
                      ? t("Loading work item content...")
                      : t("Preparing editor...")}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ textAlign: "center" }}
                  >
                    {isWorkItemLoading
                      ? t("Fetching work item details and content...")
                      : t("Setting up the work item editor interface...")}
                  </Typography>
                </Paper>
              ) : entityType === "task" &&
                sectionSelection.status === "unavailable" ? (
                <Paper
                  elevation={0}
                  data-testid="work-item-type-unavailable"
                  sx={{
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                    minHeight: 240,
                    p: 4,
                  }}
                >
                  <Alert severity="error">
                    {t(
                      "The work item type definition is unavailable, so this item cannot be edited yet.",
                    )}
                  </Alert>
                </Paper>
              ) : (
                /* Unified Initiative Editor */
                <>
                  <UnifiedWorkItemEditor
                    content={multiLevelContent}
                    onContentChange={onContentChange}
                    currentLevel={currentLevel}
                    saveMode={saveMode}
                    hasUnsavedChanges={hasAnyUnsavedChanges}
                    isLoading={!contentLoaded}
                    disabled={disabled}
                    placeholder={t(KEYS.initiatives.textArea.placeholder)}
                    showSaveButtons={false}
                    onSaveWithoutFeedback={handleSaveContent}
                    isSaving={isSavingContent}
                    template={createProgressiveTemplate({
                      entityType,
                      definition: workItemTypeDefinition,
                      content: multiLevelContent,
                      workItemStatus,
                      materializedProposalIds: new Map(
                        workItemData?.sections?.map((section) => [
                          section.key,
                          "materializedProposalId" in section
                            ? String(section.materializedProposalId)
                            : "",
                        ]) ?? [],
                      ),
                    })}
                    workItemStatus={workItemStatus}
                    mentionConfig={{
                      organizationId,
                      projectId,
                    }}
                    entitySlashConfig={entitySlashConfig}
                    fileReferenceConfig={fileReferenceConfig}
                    requirementsEditorConfig={requirementsEditorConfig}
                    workItemId={workItemId}
                  />
                  <WorkItemRefinementActions
                    canRevealAll={canRevealAll}
                    isRevealingAll={isRevealingAll}
                    disabled={disabled}
                    workItemStatus={workItemStatus}
                    onRevealAll={handleRevealAllClick}
                  />
                </>
              )}
            </>
          }
          rightContent={
            entityType === "task" ? (
              // Tasks: lazy, entity-scoped refinement conversation.
              isProjectLoading || isWorkItemLoading ? (
                <Paper
                  elevation={1}
                  sx={{
                    flexGrow: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    p: 4,
                  }}
                >
                  <ThinkingIndicator
                    animationType="minimal"
                    text={
                      isProjectLoading
                        ? t("Loading project...")
                        : t("Loading work item...")
                    }
                    size="medium"
                  />
                </Paper>
              ) : projectError || workItemError ? (
                <Paper
                  elevation={1}
                  sx={{
                    flexGrow: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    p: 4,
                  }}
                >
                  <Alert severity="error">
                    {workItemError
                      ? t("Error loading work item")
                      : t("Error loading project")}
                  </Alert>
                </Paper>
              ) : workItemData ? (
                <RefinerChat
                  organizationId={organizationId}
                  projectId={projectId}
                  entityType={EntityType.Task}
                  entityId={workItemId}
                  entityName={workItemData.name}
                  entitySummary={multiLevelContent.description}
                  onConversationReady={handleConversationReady}
                  onRunBrowserContextChange={setRefinerRunContext}
                />
              ) : null
            ) : // Initiatives: platform conversation via ConversationViewer
            isProjectLoading || isWorkItemLoading || isConversationLoading ? (
              <Paper
                elevation={1}
                sx={{
                  flexGrow: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 4,
                }}
              >
                <ThinkingIndicator
                  animationType="minimal"
                  text={
                    isProjectLoading
                      ? t("Loading project...")
                      : isWorkItemLoading
                        ? t("Loading work item...")
                        : isConversationLoading
                          ? t("Loading conversation...")
                          : t("Loading initial data...")
                  }
                  size="medium"
                />
              </Paper>
            ) : projectError || workItemError || conversationError ? (
              <Paper
                elevation={1}
                sx={{
                  flexGrow: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 4,
                }}
              >
                <Alert severity="error">
                  {conversationError
                    ? t("Error loading conversation")
                    : workItemError
                      ? t("Error loading work item")
                      : t("Error loading project")}
                </Alert>
              </Paper>
            ) : project && conversation ? (
              <TrackingProvider
                context={{
                  page: {
                    name: "work-item-editor",
                    path: `/${entityType}s/${workItemId}/edit`,
                  },
                  [entityType]: {
                    id: workItemId,
                    name:
                      title ||
                      compose(
                        entityType === "initiative"
                          ? "{{term.Initiative}}"
                          : "{{term.Task}}",
                      ),
                    status: "draft",
                    priority: "medium",
                  },
                }}
              >
                <Box
                  data-testid="conversation-viewer"
                  sx={{
                    width: "100%",
                    "& [data-conversation-content]": {
                      width: "100% !important",
                      maxWidth: "100% !important",
                    },
                    "& .initiative-conversation-viewer": {
                      width: "100%",
                      maxWidth: "100%",
                    },
                  }}
                >
                  <ConversationViewer
                    className="work-item-conversation-viewer"
                    animationType="minimal"
                    conversation={conversation}
                    project={project}
                    showNavigation={false}
                    scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
                    isWaitingForMessages={isWaitingForFirstMessage || false}
                    onConversationUpdated={async () => {
                      await refetchConversation();
                    }}
                    onCreateNewConversation={handleCreateNewConversation}
                  />
                </Box>
              </TrackingProvider>
            ) : project && refinementData && !conversation ? (
              <Paper
                elevation={1}
                sx={{
                  flexGrow: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 4,
                }}
              >
                <Alert severity="info">
                  {t("No conversation found for this work item")}
                </Alert>
              </Paper>
            ) : (
              <Paper
                elevation={1}
                sx={{
                  flexGrow: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 4,
                }}
              >
                <Alert severity="error">
                  {t("Unable to load conversation")}
                </Alert>
              </Paper>
            )
          }
        />
      </RunBrowserProvider>
      <CapsuleAction
        id="cancel-work-item"
        label={hasAnyUnsavedChanges ? t("Cancel") : t("Done")}
        icon={CancelIcon}
        actionGroup="page"
        behavior="click"
        onClick={handleCancelEdit}
        disabled={isSavingContent || disabled}
      />
      <CapsuleAction
        id="save-work-item"
        label={isSavingContent ? t("Saving...") : t("Save")}
        icon={SaveIcon}
        actionGroup="page"
        behavior="click"
        onClick={handleSaveContent}
        inProgress={isSavingContent}
        disabled={!hasAnyUnsavedChanges || isSavingContent || disabled}
      />

      <Dialog
        open={pendingRevealStage !== null}
        onClose={handleSaveBeforeRevealDialogClose}
        aria-labelledby="save-before-reveal-dialog-title"
        aria-describedby="save-before-reveal-dialog-description"
        data-testid="save-before-reveal-dialog"
      >
        <DialogTitle id="save-before-reveal-dialog-title">
          {t("Save changes before generating?")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="save-before-reveal-dialog-description">
            {t(
              "You have unsaved changes. Save before generating the next section.",
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleSaveBeforeRevealDialogClose}
            disabled={isSavingContent}
            data-testid="save-before-reveal-cancel"
          >
            {t("Keep editing")}
          </Button>
          <Button
            onClick={handleSaveAndReveal}
            variant="contained"
            disabled={isSavingContent}
            data-testid="save-before-reveal-confirm"
          >
            {isSavingContent ? t("Saving...") : t("Save and reveal")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Discard Unsaved Changes Dialog */}
      <Dialog
        ownerKey={discardDialogOpenOwnerKey}
        open={discardDialogOpen}
        onClose={handleDiscardDialogClose}
        aria-labelledby="discard-work-item-changes-title"
        aria-describedby="discard-work-item-changes-description"
      >
        <DialogTitle id="discard-work-item-changes-title">
          {t("Discard unsaved changes?")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="discard-work-item-changes-description">
            {t("Your unsaved edits will be lost.")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDiscardDialogClose} disabled={isSavingContent}>
            {t("Keep editing")}
          </Button>
          <Button
            onClick={handleDiscardConfirm}
            color="error"
            variant="contained"
            disabled={isSavingContent}
          >
            {t("Discard changes")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Conversation Confirmation Dialog */}
      <Dialog
        ownerKey={deleteDialogOpenOwnerKey}
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-conversation-dialog-title"
        aria-describedby="delete-conversation-dialog-description"
      >
        <DialogTitle id="delete-conversation-dialog-title">
          Delete Conversation
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-conversation-dialog-description">
            Are you sure you want to delete this conversation? This action
            cannot be undone and will terminate the associated workflow.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="warning"
            variant="contained"
            disabled={isDeleting}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Skip Refinement Confirmation Dialog */}
      <Dialog
        ownerKey={revealAllDialogOpenOwnerKey}
        open={revealAllDialogOpen}
        onClose={handleRevealAllCancel}
        aria-labelledby="skip-refinement-dialog-title"
        aria-describedby="skip-refinement-dialog-description"
      >
        <DialogTitle id="skip-refinement-dialog-title">
          Skip Progressive Refinement?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="skip-refinement-dialog-description">
            This will unlock all sections (Description, Details, and Acceptance
            Criteria) for editing at once, bypassing the progressive refinement
            workflow.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRevealAllCancel} variant="contained">
            Keep Refining
          </Button>
          <Button
            onClick={handleRevealAllSections}
            color="inherit"
            disabled={isRevealingAll}
          >
            Skip Refinement
          </Button>
        </DialogActions>
      </Dialog>

      <ModalWorkOwner.Provider value={reasonModalOpenOwnerKey}>
        <SaveReasonModal
          open={reasonModalOpen}
          onClose={handleReasonModalClose}
          onSubmit={handleReasonModalSubmit}
          title={t("Save changes")}
          submitLabel={t("Submit")}
          cancelLabel={t("Cancel")}
          helperText={t(
            "Add an optional note explaining why you're making this change.",
          )}
          secondaryAction={
            // Gated explicitly on the FEATURE core-type marker until the
            // registry exposes a "creates implementation tasks" affordance.
            taskType === "FEATURE"
              ? {
                  label: t("Submit and Create Task"),
                  onAction: handleReasonModalSecondaryAction,
                  disabled: selectedMachine === null,
                  configuration: (
                    <Box sx={{ mt: 2 }}>
                      {machineMode === "zero" ? (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                          No execution-ready CLI is available. Review the
                          machine state below to continue.
                        </Alert>
                      ) : null}
                      {machines.length > 0 ? (
                        <MachinePicker
                          machines={machines}
                          selectedMachineId={selectedMachine?.machineId ?? null}
                          onSelect={setSelectedMachineId}
                          mobileMode="editor"
                        />
                      ) : null}
                    </Box>
                  ),
                }
              : undefined
          }
        />
      </ModalWorkOwner.Provider>

      <ModalWorkOwner.Provider value={isCreateDesignDocOpenOwnerKey}>
        <CreateDocumentModal
          open={isCreateDesignDocOpen}
          onClose={handleCloseCreateDesignDoc}
          projectId={projectId}
          organizationId={organizationId}
          workItemSelectorMode="workItem"
          workItemSelectorInitialValue={
            workItemData?.id
              ? {
                  type: entityType,
                  id: workItemData.id,
                }
              : null
          }
          workItemSelectorReadOnly
        />
      </ModalWorkOwner.Provider>
    </Box>
  );
};
