import React from "react";
import { Alert, Box, Button, Divider, Typography } from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  InteractionComponent,
  MarkdownRenderer,
  StructuredRequirementsView,
} from "@hey-hey/ui-common/components";
import {
  TargetEntityType,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  adaptFeatureRequirementsSection,
  getEntityIcon,
  getTaskSectionContent,
  isCanonicalFeatureRequirementsDefinition,
} from "@hey-hey/ui-common/utils";
import { WebPathService } from "@hey-hey/ui-common/services";
import type {
  FeatureHierarchyNode,
  WorkItemResponseDto,
} from "@hey-hey/ui-common/data";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { FeatureSectionVisuals } from "./FeatureSectionVisuals";

// Depth 1 renders as h2 and everything deeper as h3; further nesting is
// conveyed through indentation and a lighter heading rather than ever-smaller
// header variants.
const headingForDepth = (depth: number): "h2" | "h3" =>
  depth <= 1 ? "h2" : "h3";

// The document uses exactly two feature-title sizes. Nesting below the root is
// conveyed through indentation and weight rather than progressively shrinking
// headings.
const fontSizeForDepth = (depth: number): string =>
  depth <= 1 ? "2.5rem" : "1.5rem";

const TaskEntityIcon = getEntityIcon("task");
const BugEntityIcon = getEntityIcon("bug");

export interface FeatureDocumentRendererProps {
  node: FeatureHierarchyNode & {
    feature: FeatureHierarchyNode["feature"] &
      Pick<WorkItemResponseDto, "sections">;
  };
  contentState?: {
    status: "loading" | "ready" | "error";
    data?: WorkItemResponseDto;
  };
  onRetryContent?: () => void;
  organizationId: string;
  projectId: string;
  workItemTypeDefinition?: WorkItemTypeDefinitionDto;
  depth?: number;
  activeSectionId?: string | null;
  suspendVisuals?: boolean;
  // Number of direct sub-features; with `onShowSubFeatures` the section offers
  // to open them. Omitted for the open section, whose children render below it.
  subFeatureCount?: number;
  subFeaturesHref?: string;
  onShowSubFeatures?: () => void;
  expandedRequirementIds?: Set<string>;
  onToggleRequirements?: (featureId: string) => void;
  // When provided, only matched features render their description; structural
  // ancestors kept for navigation context show a heading only.
  matchedFeatureIds?: Set<string>;
  // Document actions are a desktop-only surface while mobile V1 remains
  // read-only.
  showSectionActions?: boolean;
  onCreateWorkItem: (input: FeatureDocumentWorkItemInput) => void;
}

type FeatureDocumentWorkItemType =
  typeof WORK_ITEM_TYPE_KEYS.Standard | typeof WORK_ITEM_TYPE_KEYS.Bug;

export interface FeatureDocumentWorkItemInput {
  parentFeatureId: string;
  type: FeatureDocumentWorkItemType;
}

export const FeatureDocumentRenderer: React.FC<
  FeatureDocumentRendererProps
> = ({
  node,
  contentState,
  onRetryContent,
  organizationId,
  projectId,
  workItemTypeDefinition,
  depth = 1,
  activeSectionId,
  suspendVisuals = false,
  subFeatureCount = 0,
  subFeaturesHref,
  onShowSubFeatures,
  expandedRequirementIds,
  onToggleRequirements,
  matchedFeatureIds,
  showSectionActions = true,
  onCreateWorkItem,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const heading = headingForDepth(depth);
  const content = contentState?.data ?? node.feature;
  const sections = content.sections;
  const description = getTaskSectionContent(sections, "description");
  const requirementsSectionDefinition = workItemTypeDefinition?.sections.find(
    (section) => section.key === "requirements",
  );
  const requirementsState = isCanonicalFeatureRequirementsDefinition(
    "FEATURE",
    requirementsSectionDefinition,
  )
    ? adaptFeatureRequirementsSection({
        typeKey: "FEATURE",
        definition: requirementsSectionDefinition,
        section: sections?.find((section) => section.key === "requirements"),
      })
    : undefined;
  const isMatched =
    !matchedFeatureIds || matchedFeatureIds.has(node.feature.id);
  const hasDescription = isMatched && description.trim().length > 0;
  const hasRequirements =
    isMatched &&
    (requirementsState?.status === "invalid" ||
      (requirementsState?.status === "valid" &&
        requirementsState.records.length > 0));
  const [localRequirementsExpanded, setLocalRequirementsExpanded] =
    React.useState(false);
  const requirementsExpanded = expandedRequirementIds
    ? expandedRequirementIds.has(node.feature.id)
    : localRequirementsExpanded;
  const toggleRequirements = (): void => {
    if (onToggleRequirements) {
      onToggleRequirements(node.feature.id);
      return;
    }
    setLocalRequirementsExpanded((expanded) => !expanded);
  };
  const isActive = activeSectionId === node.feature.id;

  const featurePath = WebPathService.feature({
    projectId,
    featureId: node.feature.id,
  });

  const handleOpenFeature = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ): void => {
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      navigate(featurePath);
    }
  };

  const featureContent = (
    <>
      <Box
        sx={{
          mt: depth === 1 ? 0 : 1,
          mb: 1.5,
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <Typography
          variant={heading}
          component="a"
          href={featurePath}
          onClick={handleOpenFeature}
          aria-current={isActive ? "location" : undefined}
          data-testid={`feature-document-heading-${node.feature.id}`}
          sx={{
            display: "block",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            fontSize: fontSizeForDepth(depth),
            fontFamily:
              '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
            fontWeight: depth === 1 ? 900 : 600,
            color: "primary.main",
            textDecoration: "none",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {node.feature.name}
        </Typography>
      </Box>
      {contentState && contentState.status !== "ready" && (
        <Box
          data-testid="feature-document-content-state"
          sx={{ minHeight: contentState.data ? 0 : 360 }}
        >
          <Typography
            role={contentState.status === "error" ? "alert" : "status"}
          >
            {contentState.status === "error"
              ? "Unable to load this section."
              : "Loading section…"}
          </Typography>
          {contentState.status === "error" && (
            <Button onClick={onRetryContent}>Retry</Button>
          )}
        </Box>
      )}
      {hasDescription && (
        <Box
          data-testid={`feature-document-description-${node.feature.id}`}
          sx={{
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {/* Descriptions are badge-only: a mention never reads its work item
              or expands into an inline visual in the Document. */}
          <MarkdownRenderer
            badgeMentions
            sx={{
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              "& pre": {
                maxWidth: "100%",
                overflowX: "auto",
              },
              "& table": {
                display: "block",
                maxWidth: "100%",
                overflowX: "auto",
              },
              "& img, & video": {
                maxWidth: "100%",
                height: "auto",
              },
            }}
          >
            {description}
          </MarkdownRenderer>
        </Box>
      )}
    </>
  );

  return (
    <Box
      component="section"
      data-testid={`feature-document-section-${node.feature.id}`}
      data-feature-id={node.feature.id}
      data-depth={depth}
      data-active={isActive}
      sx={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        // Keep a scrolled-to heading clear of the panel's top edge.
        scrollMarginTop: 16,
      }}
    >
      {depth > 1 && (
        <Divider
          data-testid={`feature-document-divider-${node.feature.id}`}
          sx={{ my: 3 }}
        />
      )}
      <Box
        data-testid={`feature-document-surface-${node.feature.id}`}
        sx={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          border: "2px solid transparent",
          borderColor: (theme) =>
            isActive ? alpha(theme.palette.primary.main, 0.45) : "transparent",
          p: 2,
          borderRadius: 0.5,
          backgroundColor: (theme) =>
            isActive
              ? alpha(
                  theme.palette.mode === "dark"
                    ? theme.palette.primary.dark
                    : theme.palette.primary.light,
                  0.3,
                )
              : "transparent",
          transition: (theme) =>
            theme.transitions.create("background-color", {
              duration: theme.transitions.duration.shortest,
            }),
        }}
      >
        <Box
          data-testid={`feature-document-interaction-wrapper-${node.feature.id}`}
          sx={{
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            boxSizing: "border-box",
          }}
        >
          <InteractionComponent
            draggable={false}
            disablePreview={true}
            entityId={node.feature.id}
            entityType={TargetEntityType.Task}
            hasProposalSupport
            organizationId={organizationId}
            projectId={projectId}
            entityTitle={node.feature.name}
            size="medium"
            indicatorPlacement="bottom-left"
            // Medium indicators default to an 8px inset. A -12px edge offset
            // moves this one 20px left and down from that default position.
            indicatorOffsetX={-12}
            indicatorOffsetY={-12}
            inlineActions={
              showSectionActions
                ? [
                    {
                      action: "discuss",
                      label: "Discuss",
                      icon: ChatBubbleOutlineIcon,
                      testId: `feature-document-discuss-${node.feature.id}`,
                    },
                    {
                      action: "create_task",
                      label: "Add Task",
                      icon: TaskEntityIcon,
                      onSelect: () =>
                        onCreateWorkItem({
                          parentFeatureId: node.feature.id,
                          type: WORK_ITEM_TYPE_KEYS.Standard,
                        }),
                      testId: `feature-document-add-task-${node.feature.id}`,
                    },
                    {
                      action: "create_bug",
                      label: "Add Bug",
                      icon: BugEntityIcon,
                      onSelect: () =>
                        onCreateWorkItem({
                          parentFeatureId: node.feature.id,
                          type: WORK_ITEM_TYPE_KEYS.Bug,
                        }),
                      testId: `feature-document-add-bug-${node.feature.id}`,
                    },
                  ]
                : undefined
            }
          >
            {featureContent}
            {hasRequirements && (
              <Box
                data-testid={`feature-document-requirements-${node.feature.id}`}
                sx={{
                  mt: 1.5,
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="subtitle2"
                  component="h4"
                  fontWeight={600}
                  sx={{ mb: 0.5 }}
                >
                  Requirements
                </Typography>
                <Box
                  id={`feature-document-requirements-content-${node.feature.id}`}
                  data-testid={`feature-document-requirements-content-${node.feature.id}`}
                  sx={{
                    width: "100%",
                    maxWidth: "100%",
                    minWidth: 0,
                    pl: 2,
                    boxSizing: "border-box",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {requirementsState?.status === "invalid" ? (
                    <Alert
                      severity="error"
                      data-testid="feature-requirements-invalid"
                    >
                      {requirementsState.reason}
                    </Alert>
                  ) : requirementsState?.status === "valid" ? (
                    <StructuredRequirementsView
                      requirements={requirementsState.records}
                      previewLimit={2}
                      previewExpanded={requirementsExpanded}
                      onTogglePreview={toggleRequirements}
                      badgeMentions
                    />
                  ) : null}
                </Box>
              </Box>
            )}
            <FeatureSectionVisuals
              key={node.feature.id}
              featureId={node.feature.id}
              suspended={suspendVisuals}
              organizationId={organizationId}
              projectId={projectId}
            />
          </InteractionComponent>
          {subFeatureCount > 0 && onShowSubFeatures && (
            <Box
              component="a"
              href={subFeaturesHref}
              onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                onShowSubFeatures();
              }}
              data-testid={`feature-document-show-sub-features-${node.feature.id}`}
              sx={{
                mt: 2,
                px: 1.5,
                py: 1,
                display: "flex",
                alignItems: "center",
                gap: 1,
                border: 1,
                borderStyle: "dashed",
                borderColor: "divider",
                borderRadius: 1,
                color: "text.secondary",
                textDecoration: "none",
                typography: "body2",
                transition: (theme) =>
                  theme.transitions.create(
                    ["background-color", "border-color", "color"],
                    {
                      duration: theme.transitions.duration.shortest,
                    },
                  ),
                "& .show-sub-features-arrow": {
                  ml: "auto",
                  transition: (theme) => theme.transitions.create("transform"),
                },
                "&:hover, &:focus-visible": {
                  color: "text.primary",
                  borderColor: "text.secondary",
                  bgcolor: "action.hover",
                  "& .show-sub-features-arrow": {
                    transform: "translateX(4px)",
                  },
                },
              }}
            >
              <AccountTreeOutlinedIcon fontSize="small" />
              {t(
                "features.view.showSubFeatures",
                "Show {{count}} sub-features",
                { count: subFeatureCount },
              )}
              <ArrowForwardIcon
                fontSize="small"
                className="show-sub-features-arrow"
              />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};
