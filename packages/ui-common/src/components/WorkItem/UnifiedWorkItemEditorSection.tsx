import { Box, Typography, useTheme } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type { EditorSection, EditorTemplate } from "../../types/editorTemplate";
import { MarkdownLexicalEditor } from "../LexicalEditor/MarkdownLexicalEditor";
import type {
  MarkdownLexicalEditorEntitySlashConfig,
  MarkdownLexicalEditorMentionConfig,
} from "../LexicalEditor/MarkdownLexicalEditor";
import type { FileReferenceConfig } from "../SmarterTextAreaCard/fileReferences/types";
import { RevealSectionButton } from "./RevealSectionButton";
import type { EditHistoryEntryDto } from "../../utils/textDiff";
import { HtmlCssSectionEditor } from "./HtmlCssSectionEditor";
import { StructuredMockupSectionEditor } from "./StructuredMockupSectionEditor";
import { ModeSettingsSectionRenderer } from "../shared/ModeSettingsSectionRenderer";
import { MODE_SETTINGS_SCHEMA_REF } from "../shared/modeFilesSection";
import { ImageSectionRenderer } from "../shared/ImageSectionRenderer";
import { isImageSectionDefinition } from "../shared/imageSection";
import { isCanonicalFeatureRequirementsDefinition } from "../../utils/featureRequirementsSection";
import {
  FeatureRequirementsSectionEditor,
  type FeatureRequirementsEditorContext,
} from "./FeatureRequirementsSectionEditor";

export interface Props {
  /** Content is loading */
  disabled?: boolean;
  placeholder?: string;
  isLoading: boolean;
  index: number;
  handleSectionChange: (sectionId: string, content: string) => void;
  getContentForSection: (sectionId: string) => string;
  /** Template for progressive skeleton display */
  template: EditorTemplate;
  section: EditorSection;
  /** Edit history for diff highlighting */
  editHistory?: EditHistoryEntryDto[];
  /** Loading state for edit history */
  isLoadingEditHistory?: boolean;
  mentionConfig?: MarkdownLexicalEditorMentionConfig;
  entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
  fileReferenceConfig?: FileReferenceConfig;
  /** Present for task work items; selects the structured requirements editor. */
  requirementsEditorConfig?: WorkItemRequirementsEditorConfig;
  /** Id of the existing work item being edited. */
  workItemId?: string;
}

export interface WorkItemRequirementsEditorConfig extends FeatureRequirementsEditorContext {
  /** Effective work-item type key of the item being edited. */
  typeKey: string | undefined;
}

const shouldShowSkeleton = (section: EditorSection): boolean => {
  return Boolean(section.content.showAsSkeleton);
};

const SkeletonSection: React.FC<{ section: EditorSection }> = ({ section }) => (
  <Box sx={{ margin: "0", padding: "0 14px 16px 14px", minHeight: "60px" }}>
    {Array.from({ length: section.content.skeletonConfig?.lines || 3 }).map(
      (_, index) => (
        <Box
          key={index}
          sx={{
            width:
              index === (section.content.skeletonConfig?.lines || 3) - 1 &&
              section.content.skeletonConfig?.width === "partial"
                ? "60%"
                : "100%",
            height: "16px",
            backgroundColor: "currentcolor",
            opacity: 0.1,
            borderRadius: "8px",
            marginBottom:
              index === (section.content.skeletonConfig?.lines || 3) - 1
                ? "0px"
                : "8px",
            marginTop: "0px",
          }}
        />
      ),
    )}
    {/* Reveal Button */}
    {section.content.skeletonConfig?.buttonText &&
      section.content.skeletonConfig?.onReveal && (
        <RevealSectionButton
          buttonText={section.content.skeletonConfig.buttonText}
          onReveal={section.content.skeletonConfig.onReveal}
          isLoading={section.content.skeletonConfig.isLoading}
          disabled={section.content.skeletonConfig.disabled}
        />
      )}
  </Box>
);

export const UnifiedWorkItemEditorSection: React.FC<Props> = ({
  section,
  getContentForSection,
  isLoading,
  handleSectionChange,
  disabled = false,
  placeholder = "",
  index,
  template,
  editHistory,
  isLoadingEditHistory = false,
  mentionConfig,
  entitySlashConfig,
  fileReferenceConfig,
  requirementsEditorConfig,
  workItemId,
}) => {
  const theme = useTheme();
  const sectionSurfaceBackground = disabled
    ? theme.palette.action.disabledBackground
    : theme.palette.background.paper;
  const headerSurfaceBackground = disabled
    ? theme.palette.action.disabledBackground
    : theme.palette.mode === "dark"
      ? "#282828"
      : theme.palette.background.paper;

  const onChange = useCallback(
    (text: string) => {
      handleSectionChange(section.id, text);
    },
    [handleSectionChange, section.id],
  );

  // Filter edit history for this specific section and determine if we should show diffs
  const { filteredEditHistory, shouldShowDiffs } = useMemo(() => {
    if (
      !editHistory ||
      !Array.isArray(editHistory) ||
      editHistory.length === 0
    ) {
      return { filteredEditHistory: [], shouldShowDiffs: false };
    }

    // Find the most recent edit (last edit chronologically)
    const sortedEdits = [...editHistory].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const lastEdit = sortedEdits[0];

    if (!lastEdit || lastEdit.editedBy !== "system") {
      // Last edit wasn't by system, no diffs to show
      return { filteredEditHistory: [], shouldShowDiffs: false };
    }

    // Check if the last system edit affected this section's field
    const sectionFieldName =
      section.id === "acceptanceCriteria" ? "acceptanceCriteria" : section.id;
    const hasSectionChanges = lastEdit.changes.some(
      (change) =>
        change.field === sectionFieldName && change.dataType === "string",
    );

    if (!hasSectionChanges) {
      // Last system edit didn't affect this section
      return { filteredEditHistory: [], shouldShowDiffs: false };
    }

    // Filter to only the last system edit that affected this section
    const filteredHistory = [lastEdit];

    return { filteredEditHistory: filteredHistory, shouldShowDiffs: true };
  }, [editHistory, section.id]);

  return (
    <React.Fragment>
      {/* Section Header */}
      <Box
        className="section-editor"
        data-section-id={section.id}
        sx={{ backgroundColor: sectionSurfaceBackground }}
      >
        <Typography
          variant="h6"
          component="h2"
          sx={{
            margin: 0,
            fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
            fontWeight: "500",
            lineHeight: "1.2",
            color: "inherit",
            fontSize: "1.5rem",
            padding: "16px 14px 16px 14px",
            backgroundColor: headerSurfaceBackground,
            borderBottom: "none",
          }}
        >
          {section.header.text}
        </Typography>

        {section.helperText && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              padding: "0 14px 12px 14px",
              backgroundColor: headerSurfaceBackground,
            }}
          >
            {section.helperText}
          </Typography>
        )}

        {/* Section Content - Editor or Skeleton */}
        {section.kind === "html/css" ? (
          <HtmlCssSectionEditor
            value={getContentForSection(section.id)}
            onChange={onChange}
            definition={section.definition!}
            disabled={disabled || isLoading}
            organizationId={mentionConfig?.organizationId}
            projectId={mentionConfig?.projectId}
            workItemId={workItemId}
            materializedProposalId={section.materializedProposalId ?? ""}
          />
        ) : section.kind === "structured-mockup" ? (
          <StructuredMockupSectionEditor
            value={getContentForSection(section.id)}
            onChange={onChange}
            definition={section.definition!}
            disabled={disabled || isLoading}
            materializedProposalId={section.materializedProposalId ?? ""}
            organizationId={mentionConfig?.organizationId}
            projectId={mentionConfig?.projectId}
          />
        ) : requirementsEditorConfig &&
          isCanonicalFeatureRequirementsDefinition(
            requirementsEditorConfig.typeKey,
            section.definition,
          ) ? (
          <FeatureRequirementsSectionEditor
            value={getContentForSection(section.id)}
            onChange={onChange}
            disabled={disabled || isLoading}
            context={requirementsEditorConfig}
          />
        ) : section.kind === "json" &&
          section.definition?.schemaRef === MODE_SETTINGS_SCHEMA_REF ? (
          <ModeSettingsSectionRenderer
            content={getContentForSection(section.id)}
            onChange={onChange}
            disabled={disabled || isLoading}
            organizationId={mentionConfig?.organizationId}
            projectId={mentionConfig?.projectId}
          />
        ) : isImageSectionDefinition(section.definition) ? (
          <ImageSectionRenderer
            content={getContentForSection(section.id)}
            label={section.header.text}
            onChange={onChange}
            disabled={disabled || isLoading}
          />
        ) : shouldShowSkeleton(section) ? (
          <SkeletonSection section={section} />
        ) : (
          <Box
            sx={{
              "& .MuiPaper-root": {
                border: "none !important",
                borderRadius: "0 !important",
                boxShadow: "none !important",
                backgroundColor: `${sectionSurfaceBackground} !important`,
                minHeight: "60px",
              },
              "& [data-lexical-editor]": {
                padding: "0 14px 16px 14px !important",
                minHeight: "60px",
                fontSize: "14px",
                lineHeight: "1.4375em",
                outline: "none !important",
              },
              "& .lexical-placeholder": {
                padding: "0 14px !important",
                color: theme.palette.text.secondary,
                fontSize: "14px",
              },
            }}
          >
            <MarkdownLexicalEditor
              value={getContentForSection(section.id)}
              onTextChange={onChange}
              disabled={disabled}
              placeholder={section.content.placeholder || placeholder}
              isLoading={isLoading}
              editHistory={filteredEditHistory}
              showEditHistoryDiffs={shouldShowDiffs}
              isLoadingEditHistory={isLoadingEditHistory}
              mentionConfig={mentionConfig}
              entitySlashConfig={entitySlashConfig}
              fileReferenceConfig={fileReferenceConfig}
            />
          </Box>
        )}
      </Box>

      {/* Section Divider */}
      {index < template.sections.length - 1 && (
        <Box
          sx={{
            height: "1px",
            backgroundColor: theme.palette.divider,
            opacity: 0.3,
            margin: "0 14px",
          }}
        />
      )}
    </React.Fragment>
  );
};
