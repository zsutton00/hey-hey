/**
 * ADR Editor Component
 *
 * Main editor for Architecture Decision Records using the generic TemplateMarkdownEditor
 */

import { DesignDocCollabProvider } from "../../contexts";
import CancelIcon from "@mui/icons-material/Cancel";
import DescriptionIcon from "@mui/icons-material/Description";
import SaveIcon from "@mui/icons-material/Save";
import DownloadIcon from "@mui/icons-material/Download";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ReadyIcon from "@mui/icons-material/TaskAlt";
import TasksIcon from "@mui/icons-material/Assignment";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  DesignDocDraftSection,
  MaterializedDesignDocSection,
} from "../../api";
import {
  AdrStatus,
  DesignDocTemplate,
  EntityType,
  type UpdateDesignDocDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  useOptionalWalkthroughContext,
  WalkthroughProvider,
  WalkthroughType,
} from "../../contexts/WalkthroughContext";
import {
  useUpdateDesignDoc,
  UpdateDesignDocResultStatus,
} from "../../data/hooks/useUpdateDesignDoc";
import type { AdrContent, AdrLevelType } from "../../types/adr";
import { ADR_STATUS_INFO } from "../../types/adr";
import { useLocalDraftRecovery } from "../../hooks/useLocalDraftRecovery";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard";
import {
  CapsuleAction,
  useTaskGenerationCapsuleAction,
} from "../ActionsCapsule";
import { RefinerChat } from "../AgentSession/RefinerChat";
import { EditorConversationPanel } from "../Conversation";
import { DesignDocHelpDialog } from "../DesignDoc/DesignDocHelpDialog";
import { AdrHelpContent } from "../DesignDoc/help";
import { SaveReasonModal } from "../ProposalDispatchers/SaveReasonModal";
import { SmartTextAreaCard } from "../SmartTextAreaCard";
import { DesignDocEditorWalkthrough } from "../Walkthrough/DesignDocEditorWalkthrough";
import { AdrEditorContentEditor } from "./AdrEditorContentEditor";
import { AdrExportPanel } from "./AdrExportPanel";
import { AdrLinkedDocumentForm } from "./AdrLinkedDocumentForm";
import { useCollabBridgeValue } from "./useCollabBridgeValue";

export interface AdrEditorProps {
  /** ADR ID for context */
  adrId: string;
  /** Organization ID for API calls */
  organizationId: string;
  /** Project ID for API calls */
  projectId: string;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** ADR title (from DesignDocResponseDto.name) */
  title?: string;
  /** ADR summary (from DesignDocResponseDto.summary) */
  summary?: string;
  /** ADR status */
  status: AdrStatus;
  /** ADR number */
  number?: number;
  /** Materialized design doc sections */
  sections: MaterializedDesignDocSection[];
  /** Called when clean completion should return the current entity to read mode. */
  onDone?: (designDocId: string) => void;
}

export const AdrEditor: React.FC<AdrEditorProps> = ({
  adrId,
  organizationId,
  projectId,
  disabled = false,
  title = "Untitled ADR",
  summary,
  status,
  number,
  sections,
  onDone,
}) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isSettingReady, setIsSettingReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessCount, setSaveSuccessCount] = useState(0);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [pendingProposalMessage, setPendingProposalMessage] = useState<
    string | null
  >(null);
  const [saveStatus, setSaveStatus] = useState<"draft" | "saving" | "saved">(
    "saved"
  );
  const initializedAdrIdRef = useRef<string | null>(null);
  const [persistedTitle, setPersistedTitle] = useState(title);
  const [persistedSummary, setPersistedSummary] = useState(summary ?? "");
  const walkthroughContext = useOptionalWalkthroughContext();

  // Multi-level content state
  const [contentLoaded, setContentLoaded] = useState(false);
  const initialAdrContent = useMemo<AdrContent>(() => {
    const nextContent: AdrContent = {
      context: "",
      decision: "",
      consequences: "",
    };

    sections.forEach((section) => {
      const key = section.key.toLowerCase();
      if (key === "context") {
        nextContent.context = section.materializedMarkdown ?? "";
      } else if (key === "decision") {
        nextContent.decision = section.materializedMarkdown ?? "";
      } else if (key === "consequences") {
        nextContent.consequences = section.materializedMarkdown ?? "";
      }
    });

    return nextContent;
  }, [sections]);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftSummary, setDraftSummary] = useState(summary ?? "");
  const [draftContent, setDraftContent] =
    useState<AdrContent>(initialAdrContent);
  const [persistedContent, setPersistedContent] =
    useState<AdrContent>(initialAdrContent);
  const { mutate: updateDesignDoc } = useUpdateDesignDoc();

  // Track conversationId from refinement (used by AdrEditorContentEditor for reveal flow)
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Task generation hook for CapsuleAction integration
  const taskGenerationAction = useTaskGenerationCapsuleAction({
    aboutId: adrId,
    aboutType: "design-doc",
    aboutTitle: title,
    projectId,
    organizationId,
    status: status === AdrStatus.Ready ? "ready" : undefined,
    actionId: "tasks-from-adr",
    label: "Tasks",
    title: "adr.taskGeneration.title",
  });

  // Initialize contentLoaded on mount
  useEffect(() => {
    setContentLoaded(true);
  }, []);

  useEffect(() => {
    if (initializedAdrIdRef.current === adrId) {
      return;
    }

    setDraftTitle(title);
    setPersistedTitle(title);
    setDraftSummary(summary ?? "");
    setPersistedSummary(summary ?? "");
    setDraftContent(initialAdrContent);
    setPersistedContent(initialAdrContent);
    initializedAdrIdRef.current = adrId;
  }, [adrId, initialAdrContent, summary, title]);

  // Helper to get placeholder for current section
  const getPlaceholderForSection = useCallback(
    (level: AdrLevelType | "summary" | "title"): string => {
      switch (level) {
        case "title":
          return t("Enter ADR title...");
        case "summary":
          return t("Enter a brief summary of this ADR...");
        case "context":
          return t("Enter the context and background for this decision...");
        case "decision":
          return t("Describe the decision that was made...");
        case "consequences":
          return t(
            "Document the consequences and implications of this decision..."
          );
        default:
          return t("Enter ADR content...");
      }
    },
    [t]
  );

  // Handle title changes
  const handleTitleChange = useCallback((newTitle: string) => {
    setDraftTitle(newTitle);
    setSaveStatus("draft");
  }, []);

  // Handle summary changes
  const handleSummaryChange = useCallback((newSummary: string) => {
    setDraftSummary(newSummary);
    setSaveStatus("draft");
  }, []);

  const handleContentChange = useCallback((nextContent: AdrContent) => {
    setDraftContent(nextContent);
    setSaveStatus("draft");
  }, []);

  const hasUnsavedChanges =
    draftTitle !== persistedTitle ||
    draftSummary !== persistedSummary ||
    draftContent.context !== persistedContent.context ||
    draftContent.decision !== persistedContent.decision ||
    draftContent.consequences !== persistedContent.consequences;

  useUnsavedChangesGuard({
    when: hasUnsavedChanges && !isSaving,
  });

  useLocalDraftRecovery<{
    title: string;
    summary: string;
    content: AdrContent;
  }>({
    storageKey: `adr-draft:${organizationId}:${projectId}:${adrId}`,
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
      setDraftContent(draftValue.content);
      setSaveStatus("draft");
    },
    clearSignal: saveSuccessCount,
  });

  const performSave = useCallback(
    async (reason: string) => {
      setIsSaving(true);
      setSaveStatus("saving");
      setPendingProposalMessage(null);
      try {
        const metadataChanged =
          draftTitle !== persistedTitle || draftSummary !== persistedSummary;
        const contextChanged =
          draftContent.context !== persistedContent.context;
        const decisionChanged =
          draftContent.decision !== persistedContent.decision;
        const consequencesChanged =
          draftContent.consequences !== persistedContent.consequences;
        const contentChanged =
          contextChanged || decisionChanged || consequencesChanged;

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
          const contextSection = sections.find(
            (section) => section.key.toLowerCase() === "context"
          );
          const decisionSection = sections.find(
            (section) => section.key.toLowerCase() === "decision"
          );
          const consequencesSection = sections.find(
            (section) => section.key.toLowerCase() === "consequences"
          );

          updates.sections = [
            {
              id: contextSection?.id,
              key: "context",
              order: contextSection?.order ?? 0,
              content: draftContent.context,
            },
            {
              id: decisionSection?.id,
              key: "decision",
              order: decisionSection?.order ?? 1,
              content: draftContent.decision,
            },
            {
              id: consequencesSection?.id,
              key: "consequences",
              order: consequencesSection?.order ?? 2,
              content: draftContent.consequences,
            },
          ];
        }

        const result = await updateDesignDoc({
          organizationId,
          designDocId: adrId,
          updates,
        });

        if (result.status === UpdateDesignDocResultStatus.Pending) {
          // Staged behind a proposal: roll the optimistic drafts back to the
          // unchanged ADR and tell the user the edit awaits review.
          setDraftTitle(persistedTitle);
          setDraftSummary(persistedSummary);
          setDraftContent(persistedContent);
          setSaveStatus("saved");
          setSaveSuccessCount((current) => current + 1);
          setPendingProposalMessage(
            t(
              "Your edits were submitted as a proposal and are waiting for review."
            )
          );
          return;
        }

        setPersistedTitle(draftTitle);
        setPersistedSummary(draftSummary);
        setPersistedContent(draftContent);
        setSaveStatus("saved");
        setSaveSuccessCount((current) => current + 1);
      } catch (saveError) {
        const errorMessage =
          saveError instanceof Error ? saveError.message : "Failed to save ADR";
        setError(errorMessage);
        setSaveStatus("draft");
      } finally {
        setIsSaving(false);
      }
    },
    [
      draftContent,
      draftSummary,
      draftTitle,
      adrId,
      organizationId,
      persistedContent,
      persistedSummary,
      persistedTitle,
      sections,
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

  const handleDoneEditing = useCallback(() => {
    onDone?.(adrId);
  }, [adrId, onDone]);

  const discardUnsavedChanges = useCallback(() => {
    setDraftTitle(persistedTitle);
    setDraftSummary(persistedSummary);
    setDraftContent(persistedContent);
    setSaveStatus("saved");
    setError(null);
    setSaveSuccessCount((current) => current + 1);
  }, [persistedContent, persistedSummary, persistedTitle]);

  const handleCancelEdit = useCallback(() => {
    if (disabled || isSaving) {
      return;
    }

    if (hasUnsavedChanges) {
      setIsDiscardDialogOpen(true);
      return;
    }

    handleDoneEditing();
  }, [disabled, handleDoneEditing, hasUnsavedChanges, isSaving]);

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

  // Get status info for display
  const statusInfo = status
    ? ADR_STATUS_INFO[status]
    : { label: "Draft", color: "default" as const, description: "" };

  const displayError = error;

  // Help dialog handlers
  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const handleCloseHelp = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const handleRestartWalkthrough = useCallback(() => {
    if (walkthroughContext) {
      walkthroughContext.triggerWalkthrough(WalkthroughType.DESIGN_DOC_EDITOR);
    }
  }, [walkthroughContext]);

  // ADR action handlers
  const handleSetReady = useCallback(async () => {
    setIsSettingReady(true);
    try {
      const updateDto: UpdateDesignDocDto = {
        status: AdrStatus.Ready,
      };

      await unifiedApiClient.updateDesignDoc({
        organizationId,
        designDocId: adrId,
        updateDesignDocDto: updateDto,
      });

      // Clear any errors
      setError(null);

      // The parent component should handle refetching the ADR data
      // The status change will be reflected when the data is refetched
    } catch (err) {
      console.error("Error setting ADR ready:", err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to set ADR ready";
      setError(errorMessage);
    } finally {
      setIsSettingReady(false);
    }
  }, [adrId, organizationId]);

  // Render function for "Create Linked Document" capsule action
  const renderLinkedDocContent = useCallback(
    () => (
      <AdrLinkedDocumentForm
        adrId={adrId}
        projectId={projectId}
        organizationId={organizationId}
      />
    ),
    [adrId, projectId, organizationId]
  );

  // Render function for "Export" capsule action
  const renderExportContent = useCallback(
    () => (
      <AdrExportPanel title={title} summary={summary} sections={sections} />
    ),
    [title, summary, sections]
  );

  const collabBridgeValue = useCollabBridgeValue(adrId, organizationId);

  return (
    <DesignDocCollabProvider value={collabBridgeValue}>
      <WalkthroughProvider>
        <Box
          data-testid="adr-editor-root"
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            gap: 2,
          }}
        >
          {/* ADR Header */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
              <Typography variant="h4">
                {number !== undefined
                  ? `ADR-${number.toString().padStart(3, "0")}`
                  : "ADR"}
              </Typography>
              <Chip
                label={statusInfo.label}
                color={statusInfo.color}
                size="small"
                sx={{ fontWeight: 500 }}
                data-testid="status-chip"
              />
              <Tooltip title={t("Help")}>
                <IconButton
                  onClick={handleOpenHelp}
                  size="small"
                  aria-label={t("Help")}
                >
                  <HelpOutlineIcon />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {statusInfo.description}
            </Typography>
          </Box>

          {/* Error Display */}
          {displayError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => {
                setError(null);
              }}
            >
              {displayError}
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

          {/* Title and Summary */}
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
              placeholder={getPlaceholderForSection("title")}
              saveStatus={saveStatus}
              saveMode={null}
              hasUnsavedChanges={hasUnsavedChanges}
              isSaving={isSaving}
              minRows={1}
              maxRows={2}
              disabled={disabled}
            />
            <SmartTextAreaCard
              value={draftSummary}
              onChange={handleSummaryChange}
              headerText={t("Summary")}
              placeholder={getPlaceholderForSection("summary")}
              saveStatus={saveStatus}
              saveMode={null}
              hasUnsavedChanges={hasUnsavedChanges}
              isSaving={isSaving}
              minRows={2}
              maxRows={4}
              disabled={disabled}
            />
          </Paper>

          {/* Main Editor Layout - Side by Side */}
          <EditorConversationPanel
            leftContent={
              <AdrEditorContentEditor
                conversationId={conversationId ?? undefined}
                adrId={adrId}
                organizationId={organizationId}
                projectId={projectId}
                status={status}
                content={draftContent}
                onContentChange={handleContentChange}
              />
            }
            rightContent={
              <RefinerChat
                organizationId={organizationId}
                projectId={projectId}
                entityType={EntityType.DesignDoc}
                entityId={adrId}
                entityName={draftTitle}
                entitySummary={draftSummary}
                onConversationReady={setConversationId}
              />
            }
          />

          {/* Help Dialog */}
          {helpOpen && (
            <DesignDocHelpDialog
              open
              onClose={handleCloseHelp}
              template={DesignDocTemplate.Adr}
              onRestartWalkthrough={handleRestartWalkthrough}
              templateHelpContent={<AdrHelpContent />}
            />
          )}

          {/* Walkthrough */}
          <DesignDocEditorWalkthrough
            autoStart={true}
            walkthroughType={WalkthroughType.DESIGN_DOC_EDITOR}
          />
        </Box>
        <CapsuleAction
          id="cancel-adr"
          label={hasUnsavedChanges ? t("Cancel") : t("Done")}
          icon={CancelIcon}
          actionGroup="page"
          behavior="click"
          onClick={handleCancelEdit}
          disabled={isSaving || disabled}
        />
        <CapsuleAction
          id="save-adr"
          label={isSaving ? t("Saving...") : t("Save")}
          icon={SaveIcon}
          actionGroup="page"
          behavior="click"
          onClick={handleSave}
          inProgress={isSaving}
          disabled={!hasUnsavedChanges || isSaving || disabled}
        />
        {/* ActionsCapsule Actions */}
        {status !== AdrStatus.Ready && (
          <CapsuleAction
            id="set-adr-ready"
            label="Set Ready"
            disabled={status !== AdrStatus.AdrConsequences || isSettingReady}
            icon={ReadyIcon}
            behavior="click"
            onClick={handleSetReady}
            inProgress={isSettingReady}
          />
        )}
        {status === AdrStatus.Ready && (
          <>
            <CapsuleAction
              id={taskGenerationAction.actionId}
              label={t(taskGenerationAction.label)}
              icon={TasksIcon}
              inProgress={taskGenerationAction.inProgress}
              behavior="expand"
              renderContent={taskGenerationAction.renderContent}
              title={t(taskGenerationAction.title)}
              menuItems={taskGenerationAction.menuItems}
              resumable={taskGenerationAction.resumable}
              expandable={taskGenerationAction.expandable}
            />
            <CapsuleAction
              id="create-linked-doc"
              label={t("Link Document")}
              icon={DescriptionIcon}
              behavior="expand"
              renderContent={renderLinkedDocContent}
              title={t("Create Linked Document")}
              expandable
            />
            <CapsuleAction
              id="export-adr"
              label={t("Export")}
              icon={DownloadIcon}
              behavior="expand"
              renderContent={renderExportContent}
              title={t("Export ADR")}
            />
          </>
        )}
        <Dialog
          open={isDiscardDialogOpen}
          onClose={handleDiscardDialogClose}
          aria-labelledby="discard-adr-changes-title"
          aria-describedby="discard-adr-changes-description"
        >
          <DialogTitle id="discard-adr-changes-title">
            {t("Discard unsaved changes?")}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="discard-adr-changes-description">
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
      </WalkthroughProvider>
    </DesignDocCollabProvider>
  );
};
