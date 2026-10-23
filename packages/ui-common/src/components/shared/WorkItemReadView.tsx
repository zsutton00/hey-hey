import type { Components } from "react-markdown";
import EditIcon from "@mui/icons-material/Edit";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import type {
  MaterializedWorkItemSection,
  WorkItemTypeSectionDefinition,
} from "../../api";
import { usePathService } from "../../contexts";
import { buildEntityHref } from "../../utils/buildEntityHref";
import {
  MarkdownRenderer,
  type MarkdownRendererMentionConfig,
} from "./MarkdownRenderer";
import { useReadViewMarkdownComponents } from "./readViewMarkdownComponents";
import {
  getTaskSectionContent,
  type WorkItemSectionSelection,
} from "../../utils/workItemSections";
import {
  adaptFeatureRequirementsSection,
  isCanonicalFeatureRequirementsDefinition,
} from "../../utils/featureRequirementsSection";

import {
  REQUIREMENTS_EMPTY_STATE_TEXT,
  REQUIREMENTS_HELPER_TEXT,
} from "../../constants/workItemCopy";
import { StructuredRequirementsView } from "./StructuredRequirementsView";
import { ImageSectionRenderer } from "./ImageSectionRenderer";
import { isImageSectionDefinition } from "./imageSection";
import { HtmlCssSectionRenderer } from "./HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "./StructuredMockupSectionRenderer";
import { JsonSectionRenderer } from "./JsonSectionRenderer";
import { ModeFilesSectionRenderer } from "./ModeFilesSectionRenderer";
import { isModeFilesSection, isModeSettingsSection } from "./modeFilesSection";
import { ModeSettingsSectionRenderer } from "./ModeSettingsSectionRenderer";

export interface WorkItemReadViewProps {
  sections: readonly MaterializedWorkItemSection[] | undefined;
  sectionSelection?: WorkItemSectionSelection;
  mentionConfig?: MarkdownRendererMentionConfig;
  onEdit?: () => void;
  requirementsPreview?: WorkItemRequirementsPreview;
  htmlCssRenderingContext?: "inline" | "page";
  visualSectionTitle?: string;
  visualSectionEntity?: WorkItemVisualSectionEntity;
  visualSectionActions?: React.ReactNode;
}

export interface WorkItemRequirementsPreview {
  limit: number;
  resetKey: string;
}

export interface WorkItemVisualSectionEntity {
  entityType: "task";
  entityId: string;
  projectId: string;
  organizationId?: string;
}

const renderTextSection = (
  key: string,
  label: string,
  value?: string | null,
  emptyLabel = "Not provided",
  markdownComponents?: Components,
  mentionConfig?: MarkdownRendererMentionConfig,
) => {
  return (
    <Box data-testid="work-item-section" data-section-key={key}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        {label}
      </Typography>
      {value ? (
        <Typography
          variant="body1"
          component="div"
          sx={{
            color: "text.primary",
            wordBreak: "break-word",
            whiteSpace: "normal",
          }}
        >
          <MarkdownRenderer
            components={markdownComponents}
            mentionConfig={mentionConfig}
          >
            {value}
          </MarkdownRenderer>
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          {emptyLabel}
        </Typography>
      )}
    </Box>
  );
};

export const WorkItemReadView: React.FC<WorkItemReadViewProps> = ({
  sections,
  sectionSelection,
  mentionConfig,
  onEdit,
  requirementsPreview,
  htmlCssRenderingContext = "inline",
  visualSectionTitle,
  visualSectionEntity,
  visualSectionActions,
}) => {
  const markdownComponents = useReadViewMarkdownComponents();
  const pathService = usePathService();

  const declaredSections =
    sectionSelection?.status === "resolved" ? sectionSelection.sections : [];
  const visualSectionCount = declaredSections.filter(
    (section) =>
      section.kind === "html/css" || section.kind === "structured-mockup",
  ).length;
  const getVisualSectionLabel = (sectionLabel: string): string => {
    if (!visualSectionTitle) return sectionLabel;
    return visualSectionCount === 1
      ? visualSectionTitle
      : `${visualSectionTitle} — ${sectionLabel}`;
  };
  const visualSectionHref =
    visualSectionEntity?.entityId.trim() && visualSectionEntity.projectId.trim()
      ? buildEntityHref(pathService, visualSectionEntity.projectId, {
          entityType: visualSectionEntity.entityType,
          entityId: visualSectionEntity.entityId,
        })
      : undefined;
  const renderVisualSectionHeader = (sectionLabel: string): React.ReactNode => {
    const title = visualSectionTitle ?? sectionLabel;
    const titleLink = visualSectionTitle ? (
      <Typography
        variant="subtitle1"
        fontWeight={600}
        component={visualSectionHref ? RouterLink : "span"}
        to={visualSectionHref}
        data-testid={
          visualSectionHref ? "work-item-visual-section-title-link" : undefined
        }
        sx={
          visualSectionHref
            ? {
                color: "primary.main",
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
                "&:focus-visible": {
                  outline: (theme) => `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
              }
            : undefined
        }
      >
        {title}
      </Typography>
    ) : (
      <Typography variant="subtitle1" fontWeight={600} component="span">
        {title}
      </Typography>
    );
    const sectionSuffix =
      visualSectionTitle && visualSectionCount > 1 ? ` — ${sectionLabel}` : "";
    return visualSectionActions ? (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        sx={{ mb: 0.35 }}
      >
        {titleLink}
        {sectionSuffix ? (
          <Typography component="span" variant="subtitle1" fontWeight={600}>
            {sectionSuffix}
          </Typography>
        ) : null}
        {visualSectionActions}
      </Stack>
    ) : sectionSuffix ? (
      <Stack direction="row" sx={{ mb: 0.35 }}>
        {titleLink}
        <Typography component="span" variant="subtitle1" fontWeight={600}>
          {sectionSuffix}
        </Typography>
      </Stack>
    ) : (
      titleLink
    );
  };

  return (
    <Box sx={{ position: "relative" }}>
      {onEdit && (
        <Button
          startIcon={<EditIcon />}
          onClick={onEdit}
          variant="outlined"
          size="small"
          sx={{
            position: "absolute",
            top: -20,
            right: 0,
          }}
        >
          Edit
        </Button>
      )}
      <Stack spacing={3}>
        {declaredSections.map((section) => {
          const value = getTaskSectionContent(sections, section.key);
          const materializedSection = sections?.find(
            (candidate) => candidate.key === section.key,
          );
          const sectionProposalId =
            materializedSection &&
            "materializedProposalId" in materializedSection
              ? String(materializedSection.materializedProposalId)
              : undefined;
          const visualSectionLabel = getVisualSectionLabel(section.label);
          return (
            <React.Fragment key={section.key}>
              {section.kind === "json" &&
              isModeFilesSection({
                typeKey:
                  sectionSelection?.status === "resolved"
                    ? sectionSelection.typeKey
                    : undefined,
                key: section.key,
                kind: section.kind,
              }) ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {section.label}
                  </Typography>
                  <ModeFilesSectionRenderer
                    content={value}
                    mentionConfig={mentionConfig}
                  />
                </Box>
              ) : section.kind === "json" &&
                isModeSettingsSection({
                  typeKey:
                    sectionSelection?.status === "resolved"
                      ? sectionSelection.typeKey
                      : undefined,
                  key: section.key,
                  kind: section.kind,
                }) ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {section.label}
                  </Typography>
                  <ModeSettingsSectionRenderer content={value} />
                </Box>
              ) : isImageSectionDefinition(section) ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {section.label}
                  </Typography>
                  <ImageSectionRenderer content={value} label={section.label} />
                </Box>
              ) : section.kind === "json" &&
                !isCanonicalFeatureRequirementsDefinition(
                  sectionSelection?.status === "resolved"
                    ? sectionSelection.typeKey
                    : undefined,
                  section,
                ) ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {section.label}
                  </Typography>
                  <JsonSectionRenderer content={value} />
                </Box>
              ) : section.kind === "html/css" ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  {renderVisualSectionHeader(section.label)}
                  <HtmlCssSectionRenderer
                    content={value}
                    definition={section}
                    context={htmlCssRenderingContext}
                    title={`${visualSectionLabel} mockup`}
                    organizationId={
                      visualSectionEntity?.organizationId ??
                      mentionConfig?.organizationId
                    }
                    mockupSource={
                      visualSectionEntity?.entityId
                        ? {
                            kind: "workItem",
                            workItemId: visualSectionEntity.entityId,
                          }
                        : undefined
                    }
                    projectId={visualSectionEntity?.projectId}
                    materializedProposalId={sectionProposalId}
                  />
                </Box>
              ) : section.kind === "structured-mockup" ? (
                <Box
                  data-testid="work-item-section"
                  data-section-key={section.key}
                >
                  {renderVisualSectionHeader(section.label)}
                  <StructuredMockupSectionRenderer
                    content={value}
                    definition={section}
                    context={htmlCssRenderingContext}
                    materializedProposalId={sectionProposalId}
                    organizationId={mentionConfig?.organizationId}
                    projectId={mentionConfig?.projectId}
                  />
                </Box>
              ) : section.key === "requirements" ? (
                renderRequirementsSection(
                  section.label,
                  value,
                  markdownComponents,
                  mentionConfig,
                  sectionSelection?.status === "resolved"
                    ? sectionSelection.typeKey
                    : undefined,
                  section,
                  materializedSection,
                  requirementsPreview,
                )
              ) : (
                renderTextSection(
                  section.key,
                  section.label,
                  value,
                  "Not provided",
                  markdownComponents,
                  mentionConfig,
                )
              )}
            </React.Fragment>
          );
        })}
      </Stack>
    </Box>
  );
};

const renderRequirementsSection = (
  label: string,
  value: string | null | undefined,
  markdownComponents: Components,
  mentionConfig?: MarkdownRendererMentionConfig,
  typeKey?: string,
  definition?: WorkItemTypeSectionDefinition,
  section?: MaterializedWorkItemSection,
  requirementsPreview?: WorkItemRequirementsPreview,
): React.ReactNode => {
  const isCanonical = isCanonicalFeatureRequirementsDefinition(
    typeKey,
    definition,
  );
  const canonicalState = isCanonical
    ? adaptFeatureRequirementsSection({ typeKey, definition, section })
    : undefined;

  return (
    <RequirementsSectionFrame label={label}>
      {canonicalState?.status === "invalid" ? (
        <Alert severity="error" data-testid="feature-requirements-invalid">
          {canonicalState.reason}
        </Alert>
      ) : canonicalState?.status === "valid" ? (
        <StructuredRequirementsView
          key={requirementsPreview?.resetKey}
          requirements={canonicalState.records}
          previewLimit={requirementsPreview?.limit}
          badgeMentions={requirementsPreview !== undefined}
        />
      ) : canonicalState?.status === "valid-empty" ||
        canonicalState?.status === "absent" ? (
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          {REQUIREMENTS_EMPTY_STATE_TEXT}
        </Typography>
      ) : value ? (
        <Typography
          variant="body1"
          component="div"
          sx={{
            color: "text.primary",
            wordBreak: "break-word",
            whiteSpace: "normal",
          }}
        >
          <MarkdownRenderer
            components={markdownComponents}
            mentionConfig={mentionConfig}
          >
            {value}
          </MarkdownRenderer>
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          {REQUIREMENTS_EMPTY_STATE_TEXT}
        </Typography>
      )}
    </RequirementsSectionFrame>
  );
};

const RequirementsSectionFrame: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <Box
    data-testid="feature-requirements-section"
    data-section-key="requirements"
  >
    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
      {label}
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      {REQUIREMENTS_HELPER_TEXT}
    </Typography>
    {children}
  </Box>
);
