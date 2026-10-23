import CancelIcon from "@mui/icons-material/Cancel";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from "@mui/icons-material/Save";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  EntityType,
  type DesignDocDraftSection,
  type MaterializedDesignDocSection,
} from "../../api";
import { DesignDocCollabProvider } from "../../contexts";
import {
  useUpdateDesignDoc,
  UpdateDesignDocResultStatus,
} from "../../data/hooks/useUpdateDesignDoc";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import { useLocalDraftRecovery } from "../../hooks/useLocalDraftRecovery";
import { useLockedEditorSync } from "../../hooks/useLockedEditorSync";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard";
import { subscribeSuggestionAppliedEvent } from "../../services/editorSync/suggestionAppliedBus";
import { CapsuleAction } from "../ActionsCapsule";
import { RefinerChat } from "../AgentSession/RefinerChat";
import { EditorConversationPanel } from "../Conversation";
import { SaveReasonModal } from "../ProposalDispatchers/SaveReasonModal";
import { SmartTextAreaCard } from "../SmartTextAreaCard";
import { DesignDocExportPanel } from "./DesignDocExportPanel";
import { DesignDocSingleSectionEditorContent } from "./DesignDocSingleSectionEditorContent";
import { useDesignDocCollabBridgeValue } from "./useDesignDocCollabBridgeValue";

export interface DesignDocSingleSectionEditorProps {
  designDocId: string;
  organizationId: string;
  projectId: string;
  title?: string;
  summary?: string;
  sections: MaterializedDesignDocSection[];
  disabled?: boolean;
  status?: string;
  templateLabel: string;
  titlePlaceholder: string;
  summaryPlaceholder: string;
  contentPlaceholder: string;
  exportHeaderText: string;
  exportDescriptionText: string;
  exportButtonText: string;
  exportFallbackFilename: string;
  onDone?: (designDocId: string) => void;
}

interface SingleSectionDraftContent {
  content: string;
}

const EMPTY_SINGLE_SECTION_CONTENT: SingleSectionDraftContent = {
  content: "",
};

const SINGLE_SECTION_CONTENT_FIELDS = ["content"] as const;

export const DesignDocSingleSectionEditor: React.FC<
  DesignDocSingleSectionEditorProps
> = ({
  designDocId,
  organizationId,
  projectId,
  title = "",
  summary = "",
  sections,
  disabled = false,
  titlePlaceholder,
  summaryPlaceholder,
  contentPlaceholder,
  exportHeaderText,
  exportDescriptionText,
  exportButtonText,
  exportFallbackFilename,
  onDone,
}) => {
  const { t } = useTranslation();
  const [contentLoaded, setContentLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"draft" | "saving" | "saved">(
    "saved"
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftClearCount, setDraftClearCount] = useState(0);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [pendingProposalMessage, setPendingProposalMessage] = useState<
    string | null
  >(null);
  const initializedDesignDocIdRef = useRef<string | null>(null);

  const { searchEntities } = useMentionEntitySearch(
    organizationId,
    projectId,
    null
  );

  const initialContent = useMemo(
    () =>
      sections.find((section) => section.key.toLowerCase() === "content")
        ?.materializedMarkdown ?? "",
    [sections]
  );
  const {
    state: contentSyncState,
    hasUnsavedChanges: hasUnsavedContentChanges,
    applyUserPatch,
    applyAcceptedSuggestion,
    applyServerRefresh,
    replaceDraft,
    discardDraft,
    commitDraftAsBase,
  } = useLockedEditorSync<SingleSectionDraftContent, "content">({
    documentKey: designDocId,
    initialDocument: EMPTY_SINGLE_SECTION_CONTENT,
    fields: SINGLE_SECTION_CONTENT_FIELDS,
  });
  const draftContent = contentSyncState.draft.content;
  const persistedContent = contentSyncState.base.content;
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftSummary, setDraftSummary] = useState(summary);
  const [persistedTitle, setPersistedTitle] = useState(title);
  const [persistedSummary, setPersistedSummary] = useState(summary);

  const { mutate: updateDesignDoc } = useUpdateDesignDoc();

  useEffect(() => {
    if (initializedDesignDocIdRef.current === designDocId) {
      return;
    }

    setDraftTitle(title);
    setPersistedTitle(title);
    setDraftSummary(summary);
    setPersistedSummary(summary);
    initializedDesignDocIdRef.current = designDocId;
  }, [designDocId, initialContent, summary, title]);

  useEffect(() => {
    applyServerRefresh({ content: initialContent });
  }, [applyServerRefresh, initialContent]);

  useEffect(() => {
    const unsubscribe = subscribeSuggestionAppliedEvent((event) => {
      if (event.target !== "design-doc" || event.designDocId !== designDocId) {
        return;
      }

      const contentSection = event.sections.find(
        (section) => section.key.toLowerCase() === "content"
      );
      if (!contentSection) {
        return;
      }

      applyAcceptedSuggestion({ content: contentSection.content });
    });

    return unsubscribe;
  }, [applyAcceptedSuggestion, designDocId]);

  const entitySlashConfig = useMemo(
    () => ({
      organizationId,
      projectId,
      focalEntity: {
        kind: "entity" as const,
        entityType: EntityType.DesignDoc,
        entityId: designDocId,
      },
      onSearchEntities: searchEntities,
    }),
    [designDocId, organizationId, projectId, searchEntities]
  );

  useEffect(() => {
    setContentLoaded(true);
  }, []);

  const handleTitleChange = useCallback((newTitle: string) => {
    setDraftTitle(newTitle);
    setSaveStatus("draft");
  }, []);

  const handleSummaryChange = useCallback((newSummary: string) => {
    setDraftSummary(newSummary);
    setSaveStatus("draft");
  }, []);

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (newContent === draftContent) {
        return;
      }

      applyUserPatch({ content: newContent });
      setSaveStatus("draft");
    },
    [applyUserPatch, draftContent]
  );

  const hasUnsavedChanges =
    draftTitle !== persistedTitle ||
    draftSummary !== persistedSummary ||
    hasUnsavedContentChanges;
  const isSaving = saveStatus === "saving";

  useUnsavedChangesGuard({
    when: hasUnsavedChanges && !isSaving,
  });

  useLocalDraftRecovery<{
    title: string;
    summary: string;
    content: string;
  }>({
    storageKey: `design-doc-draft:${organizationId}:${projectId}:${designDocId}`,
    value: {
      title: draftTitle,
      summary: draftSummary,
      content: draftContent,
    },
    isDirty: hasUnsavedChanges,
    isSaving,
    onRestore: (draftValue) => {
      setDraftTitle(draftValue.title);
      setDraftSummary(draftValue.summary);
      replaceDraft({ content: draftValue.content });
      setSaveStatus("draft");
    },
    clearSignal: draftClearCount,
  });

  const performSave = useCallback(
    async (reason: string) => {
      setSaveStatus("saving");
      setSaveError(null);
      setPendingProposalMessage(null);
      try {
        const metadataChanged =
          draftTitle !== persistedTitle || draftSummary !== persistedSummary;
        const contentChanged = draftContent !== persistedContent;
        const contentSection = sections.find(
          (section) => section.key.toLowerCase() === "content"
        );

        if (!metadataChanged && !contentChanged) {
          setSaveStatus("saved");
          return;
        }

        const updates: {
          name?: string;
          summary?: string;
          sections?: DesignDocDraftSection[];
          reason?: string;
        } = { reason };

        if (metadataChanged) {
          updates.name = draftTitle;
          updates.summary = draftSummary;
        }

        if (contentChanged) {
          updates.sections = [
            {
              id: contentSection?.id,
              key: "content",
              order: contentSection?.order ?? 0,
              content: draftContent,
            },
          ];
        }

        const result = await updateDesignDoc({
          organizationId,
          designDocId,
          updates,
        });

        if (result.status === UpdateDesignDocResultStatus.Pending) {
          // Staged behind a proposal: roll the optimistic draft back to the
          // unchanged doc and tell the user the edit awaits review.
          setDraftTitle(persistedTitle);
          setDraftSummary(persistedSummary);
          discardDraft();
          setSaveStatus("saved");
          setDraftClearCount((current) => current + 1);
          setPendingProposalMessage(
            t(
              "Your edits were submitted as a proposal and are waiting for review."
            )
          );
          return;
        }

        setPersistedTitle(draftTitle);
        setPersistedSummary(draftSummary);
        commitDraftAsBase();
        setSaveStatus("saved");
        setDraftClearCount((current) => current + 1);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save design doc";
        setSaveError(message);
        setSaveStatus("draft");
      }
    },
    [
      draftContent,
      draftSummary,
      draftTitle,
      designDocId,
      organizationId,
      persistedContent,
      persistedSummary,
      persistedTitle,
      sections,
      commitDraftAsBase,
      discardDraft,
      t,
      updateDesignDoc,
    ]
  );

  const handleSave = useCallback(() => {
    if (!hasUnsavedChanges || isSaving) {
      return;
    }
    setReasonModalOpen(true);
  }, [hasUnsavedChanges, isSaving]);

  const handleReasonModalSubmit = useCallback(
    async (reason: string) => {
      setReasonModalOpen(false);
      await performSave(reason);
    },
    [performSave]
  );

  const handleReasonModalClose = useCallback(() => {
    if (isSaving) {
      return;
    }
    setReasonModalOpen(false);
  }, [isSaving]);

  const discardUnsavedChanges = useCallback(() => {
    setDraftTitle(persistedTitle);
    setDraftSummary(persistedSummary);
    discardDraft();
    setSaveStatus("saved");
    setSaveError(null);
    setDraftClearCount((current) => current + 1);
  }, [discardDraft, persistedSummary, persistedTitle]);

  const handleCancelEdit = useCallback(() => {
    if (disabled || isSaving) {
      return;
    }

    if (!hasUnsavedChanges) {
      return;
    }

    setIsDiscardDialogOpen(true);
  }, [disabled, hasUnsavedChanges, isSaving]);

  const handleDiscardDialogClose = useCallback(() => {
    if (isSaving) {
      return;
    }
    setIsDiscardDialogOpen(false);
  }, [isSaving]);

  const handleDiscardConfirm = useCallback(() => {
    discardUnsavedChanges();
    setIsDiscardDialogOpen(false);
  }, [discardUnsavedChanges]);

  const handleDoneEditing = useCallback(() => {
    onDone?.(designDocId);
  }, [designDocId, onDone]);

  const handleCancelOrDone = useCallback(() => {
    if (disabled || isSaving) {
      return;
    }

    if (hasUnsavedChanges) {
      handleCancelEdit();
      return;
    }

    handleDoneEditing();
  }, [
    disabled,
    handleCancelEdit,
    handleDoneEditing,
    hasUnsavedChanges,
    isSaving,
  ]);

  const renderExportContent = useCallback(
    () => (
      <DesignDocExportPanel
        title={draftTitle}
        summary={draftSummary}
        sections={sections}
        headerText={exportHeaderText}
        descriptionText={exportDescriptionText}
        buttonText={exportButtonText}
        fallbackFilename={exportFallbackFilename}
        showSectionHeadings={false}
      />
    ),
    [
      draftTitle,
      draftSummary,
      sections,
      exportHeaderText,
      exportDescriptionText,
      exportButtonText,
      exportFallbackFilename,
    ]
  );

  const collabBridgeValue = useDesignDocCollabBridgeValue(
    designDocId,
    organizationId
  );

  return (
    <DesignDocCollabProvider value={collabBridgeValue}>
      <Box
        data-testid="design-doc-single-section-editor"
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          gap: 2,
        }}
      >
        {pendingProposalMessage && (
          <Alert
            severity="info"
            onClose={() => setPendingProposalMessage(null)}
            data-testid="pending-proposal-indicator"
          >
            {pendingProposalMessage}
          </Alert>
        )}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 3,
            opacity: contentLoaded ? 1 : 0,
            transition: "opacity 0.3s ease-in",
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <SmartTextAreaCard
            value={draftTitle}
            onChange={handleTitleChange}
            headerText={t("Title")}
            placeholder={titlePlaceholder}
            saveStatus={saveStatus}
            saveMode={null}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isSaving}
            multiline={false}
            disabled={disabled}
          />
          <SmartTextAreaCard
            value={draftSummary}
            onChange={handleSummaryChange}
            headerText={t("Summary")}
            placeholder={summaryPlaceholder}
            saveStatus={saveStatus}
            saveMode={null}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isSaving}
            minRows={2}
            maxRows={4}
            disabled={disabled}
          />
          {saveError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {saveError}
            </Alert>
          )}
        </Paper>

        <EditorConversationPanel
          leftContent={
            <DesignDocSingleSectionEditorContent
              content={draftContent}
              onContentChange={handleContentChange}
              disabled={disabled}
              placeholder={contentPlaceholder}
              isLoading={!contentLoaded}
              mentionConfig={{
                organizationId,
                projectId,
              }}
              entitySlashConfig={entitySlashConfig}
            />
          }
          rightContent={
            <RefinerChat
              organizationId={organizationId}
              projectId={projectId}
              entityType={EntityType.DesignDoc}
              entityId={designDocId}
              entityName={draftTitle}
              entitySummary={draftSummary}
            />
          }
        />
      </Box>

      <CapsuleAction
        id="cancel-design-doc"
        label={hasUnsavedChanges ? t("Cancel") : t("Done")}
        icon={CancelIcon}
        actionGroup="page"
        behavior="click"
        onClick={handleCancelOrDone}
        disabled={isSaving || disabled}
      />
      <CapsuleAction
        id="save-design-doc"
        label={isSaving ? t("Saving...") : t("Save")}
        icon={SaveIcon}
        actionGroup="page"
        behavior="click"
        onClick={handleSave}
        inProgress={isSaving}
        disabled={!hasUnsavedChanges || isSaving || disabled}
      />
      <CapsuleAction
        id="export-design-doc"
        label={t("Export")}
        icon={DownloadIcon}
        behavior="expand"
        renderContent={renderExportContent}
        title={exportHeaderText}
      />
      <Dialog
        open={isDiscardDialogOpen}
        onClose={handleDiscardDialogClose}
        aria-labelledby="discard-design-doc-changes-title"
        aria-describedby="discard-design-doc-changes-description"
      >
        <DialogTitle id="discard-design-doc-changes-title">
          {t("Discard unsaved changes?")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="discard-design-doc-changes-description">
            {t("Your unsaved edits will be lost.")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDiscardDialogClose} disabled={isSaving}>
            {t("Keep editing")}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDiscardConfirm}
            disabled={isSaving}
          >
            {t("Discard changes")}
          </Button>
        </DialogActions>
      </Dialog>

      <SaveReasonModal
        open={reasonModalOpen}
        onClose={handleReasonModalClose}
        onSubmit={handleReasonModalSubmit}
        title={t("Save changes")}
        submitLabel={t("Submit")}
        cancelLabel={t("Cancel")}
        helperText={t(
          "Add an optional note explaining why you're making this change."
        )}
      />
    </DesignDocCollabProvider>
  );
};
