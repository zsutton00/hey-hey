import { Box, ButtonBase, ThemeProvider, Typography } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import {
  type WorkItemTypeSectionDefinition,
  WorkItemTypeSectionDefinitionKindEnum,
} from "../../api";
import { usePreviewHost } from "../../contexts/PreviewHostContext";
import { createHeyTheme } from "../../contexts/ThemeContext";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { createOpenItemEntity } from "../../types/openItems";
import {
  getEntityColors,
  getEntityIcon,
  resolveWorkItemIconPresentation,
} from "../../utils/entityIcons";
import { getTaskSectionContent } from "../../utils/workItemSections";
import { Card } from "../Card";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { useRefElementWidth } from "./useRefElementWidth";
import { HtmlCssSectionThumbnail } from "./HtmlCssSectionThumbnail";
import { StructuredMockupSectionThumbnail } from "./StructuredMockupSectionThumbnail";
import { MOCKUP_TYPE_KEY, type VisualArtifact } from "./visualArtifacts";
import {
  VISUAL_ARTIFACT_PREVIEW_HEIGHT,
  VISUAL_ARTIFACT_THUMBNAIL_HEIGHT,
  VisualArtifactPreviewContent,
  VisualArtifactPreviewLoading,
} from "./VisualArtifactPreview";

/** Begin loading a card shortly before it scrolls into view. */
const PRELOAD_ROOT_MARGIN = "240px 0px";

/**
 * Mockup miniatures are always light, so the card around them stays white with
 * dark text whatever the app theme is.
 */
const PREVIEW_CARD_THEME = createHeyTheme("light");

/**
 * The theme compiles palette tokens to `var(--mui-palette-*)`, and those are
 * defined once at the root from the app theme. A nested ThemeProvider does not
 * redefine them, so inside the card `text.primary` would still be the app's
 * dark-mode white. Redefining the variables on the card's own wrapper makes
 * every token below it resolve to the light palette.
 */
const { palette: LIGHT } = PREVIEW_CARD_THEME;
const PREVIEW_CARD_PALETTE_VARIABLES = {
  "--mui-palette-text-primary": LIGHT.text.primary,
  "--mui-palette-text-secondary": LIGHT.text.secondary,
  "--mui-palette-text-disabled": LIGHT.text.disabled,
  "--mui-palette-background-paper": LIGHT.background.paper,
  "--mui-palette-background-default": LIGHT.background.default,
  "--mui-palette-divider": LIGHT.divider,
  "--mui-palette-action-active": LIGHT.action.active,
  "--mui-palette-action-hover": LIGHT.action.hover,
  "--mui-palette-action-selected": LIGHT.action.selected,
  "--mui-palette-action-disabled": LIGHT.action.disabled,
  "--mui-palette-action-disabledBackground": LIGHT.action.disabledBackground,
  "--mui-palette-action-focus": LIGHT.action.focus,
  "--mui-palette-primary-main": LIGHT.primary.main,
  "--mui-palette-primary-light": LIGHT.primary.light,
  "--mui-palette-primary-dark": LIGHT.primary.dark,
  "--mui-palette-heyhey-main": LIGHT.heyhey.main,
} as const;

const MOCKUP_SECTION_KINDS = new Set<string>([
  WorkItemTypeSectionDefinitionKindEnum.HtmlCss,
  WorkItemTypeSectionDefinitionKindEnum.StructuredMockup,
]);

const useNearViewport = (ref: React.RefObject<HTMLElement | null>): boolean => {
  const [isNear, setIsNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (isNear) return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: PRELOAD_ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNear, ref]);
  return isNear;
};

const MockupPreview: React.FC<{
  organizationId: string;
  projectId: string;
  mockupId: string;
  width: number;
}> = ({ organizationId, projectId, mockupId, width }) => {
  const { workItem, isFetched } = useWorkItem(
    organizationId,
    "task",
    mockupId,
    { projectId },
  );
  const typeQuery = useWorkItemTypeByKey(
    organizationId,
    projectId,
    MOCKUP_TYPE_KEY,
  );

  if (!isFetched || !typeQuery.isFetched || width <= 0) {
    return (
      <VisualArtifactPreviewLoading testId="visual-artifact-card-loading" />
    );
  }

  // The mockup section is found by its declared kind, never by section key.
  const sections: readonly WorkItemTypeSectionDefinition[] =
    typeQuery.workItemTypeDefinition?.sections ?? [];
  const mockup = sections
    .filter((definition) => MOCKUP_SECTION_KINDS.has(definition.kind ?? ""))
    .map((definition) => ({
      definition,
      content: getTaskSectionContent(workItem?.sections, definition.key),
    }))
    .find(({ content }) => content.trim().length > 0);

  if (!mockup) {
    return (
      <VisualArtifactPreviewContent>
        <Box sx={{ alignSelf: "center" }}>
          <Typography variant="caption" color="text.primary">
            No mockup preview.
          </Typography>
        </Box>
      </VisualArtifactPreviewContent>
    );
  }

  const purpose = getTaskSectionContent(workItem?.sections, "purpose")
    .replace(/@\[[^\]|]+\|([^\]]+)\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const maxHeight = purpose
    ? VISUAL_ARTIFACT_THUMBNAIL_HEIGHT
    : VISUAL_ARTIFACT_PREVIEW_HEIGHT;

  const thumbnail =
    mockup.definition.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss ? (
      <HtmlCssSectionThumbnail
        content={mockup.content}
        definition={mockup.definition}
        width={width}
        maxHeight={maxHeight}
        title={`${workItem?.name ?? "Mockup"} thumbnail`}
      />
    ) : (
      <StructuredMockupSectionThumbnail
        content={mockup.content}
        definition={mockup.definition}
        width={width}
        maxHeight={maxHeight}
        organizationId={organizationId}
        projectId={projectId}
      />
    );

  return (
    <VisualArtifactPreviewContent
      caption={purpose}
      captionTestId="mockup-purpose"
    >
      <Box
        sx={{
          display: "grid",
          alignItems: "center",
          borderRadius: 1,
          bgcolor: "grey.100",
        }}
      >
        {thumbnail}
      </Box>
    </VisualArtifactPreviewContent>
  );
};

export interface VisualArtifactCardProps {
  artifact: VisualArtifact;
  organizationId: string;
  projectId: string;
}

/**
 * A whole-artifact miniature of a related Mockup or Diagram. It loads only as
 * it nears the viewport, never scrolls internally, and opens the artifact in
 * Preview without changing the page, URL, or history.
 */
export const VisualArtifactCard: React.FC<VisualArtifactCardProps> = ({
  artifact,
  organizationId,
  projectId,
}) => {
  const previewHost = usePreviewHost();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const isNear = useNearViewport(previewRef);
  const width = useRefElementWidth(previewRef);
  const isDiagram = artifact.typeKey !== MOCKUP_TYPE_KEY;
  const testId = `visual-artifact-card-${artifact.entityId}`;
  const typeQuery = useWorkItemTypeByKey(
    organizationId,
    projectId,
    artifact.typeKey,
  );
  const presentation =
    typeQuery.isFetched && !typeQuery.error
      ? resolveWorkItemIconPresentation(
          artifact.typeKey,
          typeQuery.workItemTypeDefinition,
          typeQuery.workItemTypeSummary?.effectiveSource,
        )
      : undefined;
  const Icon = presentation?.Icon ?? getEntityIcon(artifact.typeKey);
  const colors = presentation?.colors ?? getEntityColors(artifact.typeKey);

  const handleOpen = (): void => {
    previewHost.openPreview(createOpenItemEntity("task", artifact.entityId));
  };

  return (
    <ThemeProvider theme={PREVIEW_CARD_THEME}>
      <Box
        sx={(theme) => ({
          ...PREVIEW_CARD_PALETTE_VARIABLES,
          minWidth: 0,
          bgcolor: "common.white",
          color: "text.primary",
          borderRadius: 1,
          "& h2, & h3, & h4, & h5, & h6": {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
          // Match the title size used by other proposal cards.
          "&& h2": {
            fontSize: theme.typography.subtitle2.fontSize,
            fontWeight: theme.typography.subtitle2.fontWeight,
            lineHeight: theme.typography.subtitle2.lineHeight,
          },
        })}
      >
        <Card
          title={artifact.displayName}
          dataTestId={testId}
          onTitleClick={handleOpen}
          icon={
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 1,
                bgcolor: colors.background,
                color: colors.color,
              }}
            >
              <Icon sx={{ fontSize: "0.9rem", color: "inherit" }} />
            </Box>
          }
        >
          <ButtonBase
            onClick={handleOpen}
            aria-label={`Open ${artifact.displayName}`}
            data-testid={`${testId}-open`}
            sx={{ display: "block", width: "100%", borderRadius: 1 }}
          >
            <Box
              ref={previewRef}
              data-testid={`${testId}-preview`}
              data-load-state={isNear ? "eligible" : "deferred"}
              sx={{
                width: "100%",
                height: VISUAL_ARTIFACT_PREVIEW_HEIGHT,
                overflow: "hidden",
                overflowAnchor: "none",
              }}
            >
              {!isNear ? (
                <VisualArtifactPreviewLoading testId="visual-artifact-card-loading" />
              ) : isDiagram ? (
                <DiagramThumbnail
                  organizationId={organizationId}
                  projectId={projectId}
                  diagramId={artifact.entityId}
                />
              ) : (
                <MockupPreview
                  organizationId={organizationId}
                  projectId={projectId}
                  mockupId={artifact.entityId}
                  width={width}
                />
              )}
            </Box>
          </ButtonBase>
        </Card>
      </Box>
    </ThemeProvider>
  );
};

VisualArtifactCard.displayName = "VisualArtifactCard";
