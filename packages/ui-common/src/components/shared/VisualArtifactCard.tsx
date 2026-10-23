import { Box, ButtonBase, Skeleton, Typography } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import {
  type WorkItemTypeSectionDefinition,
  WorkItemTypeSectionDefinitionKindEnum,
} from "../../api";
import { usePreviewHost } from "../../contexts/PreviewHostContext";
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
import { HtmlCssSectionThumbnail } from "./HtmlCssSectionThumbnail";
import { StructuredMockupSectionThumbnail } from "./StructuredMockupSectionThumbnail";
import { MOCKUP_TYPE_KEY, type VisualArtifact } from "./visualArtifacts";

/** Begin loading a card shortly before it scrolls into view. */
const PRELOAD_ROOT_MARGIN = "240px 0px";
const LOADING_HEIGHT = 180;

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

const useElementWidth = (ref: React.RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};

const LoadingPreview: React.FC = () => (
  <Skeleton
    variant="rounded"
    height={LOADING_HEIGHT}
    data-testid="visual-artifact-card-loading"
  />
);

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
    return <LoadingPreview />;
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
      <Typography variant="caption" color="text.primary">
        No mockup preview.
      </Typography>
    );
  }

  const purpose = getTaskSectionContent(workItem?.sections, "purpose")
    .replace(/@\[[^\]|]+\|([^\]]+)\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const thumbnail =
    mockup.definition.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss ? (
      <HtmlCssSectionThumbnail
        content={mockup.content}
        definition={mockup.definition}
        width={width}
        maxHeight={LOADING_HEIGHT}
        title={`${workItem?.name ?? "Mockup"} thumbnail`}
      />
    ) : (
      <StructuredMockupSectionThumbnail
        content={mockup.content}
        definition={mockup.definition}
        width={width}
        maxHeight={LOADING_HEIGHT}
        organizationId={organizationId}
        projectId={projectId}
      />
    );

  return (
    <>
      {thumbnail}
      {purpose && (
        <Typography
          variant="caption"
          color="text.primary"
          data-testid="mockup-purpose"
          sx={{
            mt: 1,
            textAlign: "left",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {purpose}
        </Typography>
      )}
    </>
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
  const width = useElementWidth(previewRef);
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
    <Box
      sx={(theme) => ({
        minWidth: 0,
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
              minHeight: LOADING_HEIGHT,
              overflow: "hidden",
            }}
          >
            {!isNear ? (
              <LoadingPreview />
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
  );
};

VisualArtifactCard.displayName = "VisualArtifactCard";
