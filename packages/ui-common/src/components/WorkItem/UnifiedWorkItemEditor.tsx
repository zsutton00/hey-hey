import Psychology from "@mui/icons-material/Psychology";
import Save from "@mui/icons-material/Save";
import { Box, Button, CircularProgress, Paper, useTheme } from "@mui/material";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { EditorTemplate } from "../../types/editorTemplate";
import type { TemplateEditorChangeSource } from "../../types/templateEditor";
import type { LevelType } from "../../types/workItem";
import { log } from "../../utils/logger";
import type { EditHistoryEntryDto } from "../../utils/textDiff";
import type { MultiLevelContent } from "../../utils/workItemContent";
import { isProcessingStatus } from "../../utils/workItemUtils";
import type {
  MarkdownLexicalEditorEntitySlashConfig,
  MarkdownLexicalEditorMentionConfig,
} from "../LexicalEditor/MarkdownLexicalEditor";
import type { FileReferenceConfig } from "../SmarterTextAreaCard/fileReferences/types";
import {
  UnifiedWorkItemEditorSection,
  type WorkItemRequirementsEditorConfig,
} from "./UnifiedWorkItemEditorSection";
type SaveMode = "silent" | "feedback" | null;

export interface UnifiedWorkItemEditorProps {
  content: MultiLevelContent;
  isLoading: boolean;
  onContentChange: (content: MultiLevelContent) => void;
  currentLevel: LevelType;
  saveMode: SaveMode;
  hasUnsavedChanges: boolean;
  onSaveWithoutFeedback?: () => void;
  onSaveWithFeedback?: () => void;
  disabled?: boolean;
  placeholder?: string;
  isSaving?: boolean;
  saveWithoutFeedbackText?: string;
  saveWithFeedbackText?: string;
  showSaveButtons?: boolean;
  template?: EditorTemplate;
  workItemStatus?: string;
  editHistory?: EditHistoryEntryDto[];
  isLoadingEditHistory?: boolean;
  mentionConfig?: MarkdownLexicalEditorMentionConfig;
  entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
  fileReferenceConfig?: FileReferenceConfig;
  requirementsEditorConfig?: WorkItemRequirementsEditorConfig;
  /** Id of the existing work item being edited; its mockups open as last approved. */
  workItemId?: string;
}

export const UnifiedWorkItemEditor: React.FC<UnifiedWorkItemEditorProps> = ({
  content,
  onContentChange,
  currentLevel,
  isLoading,
  saveMode,
  hasUnsavedChanges,
  onSaveWithoutFeedback,
  onSaveWithFeedback,
  disabled = false,
  isSaving = false,
  saveWithoutFeedbackText,
  saveWithFeedbackText,
  showSaveButtons = true,
  template,
  workItemStatus,
  editHistory,
  isLoadingEditHistory = false,
  mentionConfig,
  entitySlashConfig,
  fileReferenceConfig,
  requirementsEditorConfig,
  workItemId,
}) => {
  log.uiRender("UnifiedWorkItemEditor rendered", {
    content,
    currentLevel,
    templateId: template?.id,
    hasUnsavedChanges,
  });

  const { t } = useTranslation();
  const theme = useTheme();

  const defaultSaveWithoutFeedbackText =
    saveWithoutFeedbackText || t(KEYS.common.save);
  const defaultSaveWithFeedbackText =
    saveWithFeedbackText || t(KEYS.workItems.editor.saveAndGetFeedback);

  const isEditorProcessing = isProcessingStatus(workItemStatus ?? "");
  const canSave =
    hasUnsavedChanges && !disabled && !isSaving && !isEditorProcessing;
  const showSaveWithoutFeedback = !!onSaveWithoutFeedback;
  const showSaveWithFeedback = !!onSaveWithFeedback;

  const handleSectionChange = useCallback(
    (
      sectionId: string,
      newText: string,
      options?: { source?: TemplateEditorChangeSource },
    ) => {
      log.editorChange("UnifiedWorkItemEditor.handleSectionChange called", {
        sectionId,
        contentLength: newText.length,
        source: options?.source ?? "local",
      });

      const newContent = { ...content };
      newContent[sectionId] = newText;
      onContentChange(newContent);
    },
    [content, onContentChange],
  );

  const getContentForSection = useCallback(
    (sectionId: string): string => content[sectionId] ?? "",
    [content],
  );

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      data-testid="unified-work-item-editor"
    >
      <Box sx={{ position: "relative" }}>
        <Paper
          elevation={0}
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            backgroundColor: theme.palette.background.paper,
            overflow: "hidden",
            opacity: isEditorProcessing ? 0.5 : 1,
            pointerEvents: isEditorProcessing ? "none" : "auto",
            transition: "opacity 0.3s ease-in-out",
            "& .section-editor:first-of-type h2": {
              paddingTop: "20px",
            },
            "& .section-editor:last-of-type": {
              paddingBottom: "4px",
            },
          }}
        >
          {template?.sections.map((section, index) => (
            <UnifiedWorkItemEditorSection
              key={section.id}
              isLoading={isLoading}
              getContentForSection={getContentForSection}
              handleSectionChange={handleSectionChange}
              section={section}
              disabled={disabled || isEditorProcessing}
              editHistory={editHistory}
              isLoadingEditHistory={isLoadingEditHistory}
              mentionConfig={mentionConfig}
              entitySlashConfig={entitySlashConfig}
              fileReferenceConfig={fileReferenceConfig}
              requirementsEditorConfig={requirementsEditorConfig}
              workItemId={workItemId}
              template={template}
              index={index}
            />
          ))}
        </Paper>

        {isEditorProcessing && (
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 2,
            }}
          >
            <CircularProgress size={32} />
          </Box>
        )}
      </Box>

      {showSaveButtons && (showSaveWithoutFeedback || showSaveWithFeedback) && (
        <Paper
          elevation={0}
          data-testid="save-buttons"
          sx={{
            borderRadius: 1,
            border: `1px solid ${theme.palette.divider}`,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              display: "flex",
              bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
              opacity: hasUnsavedChanges ? 1 : 0.4,
              transition: "opacity 0.3s ease-in-out",
            }}
          >
            {showSaveWithoutFeedback && (
              <Button
                variant="text"
                size="small"
                onClick={onSaveWithoutFeedback}
                disabled={!canSave}
                startIcon={
                  isSaving && saveMode === "silent" ? (
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        border: `2px solid ${theme.palette.primary.main}`,
                        borderTop: "2px solid transparent",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        "@keyframes spin": {
                          "0%": { transform: "rotate(0deg)" },
                          "100%": { transform: "rotate(360deg)" },
                        },
                      }}
                    />
                  ) : (
                    <Save />
                  )
                }
                sx={{
                  flex: 1,
                  py: 1.5,
                  borderRadius: 0,
                  textTransform: "none",
                  borderRight: showSaveWithFeedback
                    ? `1px solid ${theme.palette.divider}`
                    : "none",
                }}
              >
                {isSaving && saveMode === "silent"
                  ? t(KEYS.common.processing)
                  : defaultSaveWithoutFeedbackText}
              </Button>
            )}

            {showSaveWithFeedback && (
              <Button
                variant="text"
                size="small"
                onClick={onSaveWithFeedback}
                disabled={!canSave}
                startIcon={
                  isSaving && saveMode === "feedback" ? (
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        border: `2px solid ${theme.palette.primary.contrastText}`,
                        borderTop: "2px solid transparent",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        "@keyframes spin": {
                          "0%": { transform: "rotate(0deg)" },
                          "100%": { transform: "rotate(360deg)" },
                        },
                      }}
                    />
                  ) : (
                    <Psychology />
                  )
                }
                sx={{
                  flex: 1,
                  py: 1.5,
                  borderRadius: 0,
                  textTransform: "none",
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: theme.palette.primary.dark,
                  },
                  "&:disabled": {
                    backgroundColor: theme.palette.action.disabledBackground,
                    color: theme.palette.action.disabled,
                  },
                }}
              >
                {isSaving && saveMode === "feedback"
                  ? t(KEYS.common.processing)
                  : defaultSaveWithFeedbackText}
              </Button>
            )}
          </Box>
        </Paper>
      )}
    </Box>
  );
};
