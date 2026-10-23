import { Box, Skeleton, Typography } from "@mui/material";
import React, { useMemo } from "react";
import { WorkItemTypeSectionDefinitionKindEnum } from "../../api";
import { getTaskSectionContent } from "../../utils/workItemSections";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { WorkflowGraphThumbnail } from "./WorkflowMentionInlineRenderer";

export const DIAGRAM_THUMBNAIL_HEIGHT = 180;

const DESCRIPTION_LINE_CLAMP = 3;

/** Flattens markdown into one readable line for a clamped caption. */
const toPlainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/@\[[^|\]]*\|([^\]]*)\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, "")
    .replace(/[#>*_`~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface DiagramThumbnailProps {
  organizationId: string;
  projectId: string;
  diagramId: string;
  /** Defers loading until the host decides the thumbnail is near view. */
  enabled?: boolean;
  height?: number;
}

/**
 * Read-only miniature of a whole Diagram, fit into a fixed-height box. Loads
 * the same graph aggregate as the inline Diagram renderer.
 */
export const DiagramThumbnail: React.FC<DiagramThumbnailProps> = ({
  organizationId,
  projectId,
  diagramId,
  enabled = true,
  height = DIAGRAM_THUMBNAIL_HEIGHT,
}) => {
  const graphQuery = useWorkItemGraph(organizationId, projectId, diagramId, {
    enabled,
  });
  const diagramType = useWorkItemTypeByKey(
    enabled ? organizationId : undefined,
    enabled ? projectId : undefined,
    enabled ? "DIAGRAM" : undefined
  );
  const elementType = useWorkItemTypeByKey(
    enabled ? organizationId : undefined,
    enabled ? projectId : undefined,
    enabled ? "DIAGRAM_ELEMENT" : undefined
  );
  const graph = graphQuery.data;
  const description = useMemo(() => {
    const sections = graph?.root?.sections;
    // The first populated markdown section, found by kind rather than key.
    for (const definition of diagramType.workItemTypeDefinition?.sections ??
      []) {
      const kind =
        definition.kind ?? WorkItemTypeSectionDefinitionKindEnum.Markdown;
      if (kind !== WorkItemTypeSectionDefinitionKindEnum.Markdown) continue;
      const text = toPlainText(getTaskSectionContent(sections, definition.key));
      if (text) return text;
    }
    return "";
  }, [diagramType.workItemTypeDefinition, graph]);

  if (
    !enabled ||
    !graphQuery.isFetched ||
    !diagramType.isFetched ||
    !elementType.isFetched
  ) {
    return (
      <Skeleton
        variant="rounded"
        height={height}
        data-testid="diagram-thumbnail-loading"
      />
    );
  }

  if (graphQuery.error || !graph?.root) {
    return (
      <Box
        data-testid="diagram-thumbnail-unavailable"
        sx={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 1,
          bgcolor: "action.hover",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Diagram preview unavailable
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <WorkflowGraphThumbnail
        height={height}
        graphData={{
          workflow: graph.root,
          steps: graph.children.filter(
            (step) => step.type.toUpperCase() === "DIAGRAM_ELEMENT"
          ),
          edges: graph.relationships,
          participation: graph.participation,
          workflowTypeDefinition: diagramType.workItemTypeDefinition,
          nodeTypeDefinition: elementType.workItemTypeDefinition,
          layout: graph.layout,
        }}
      />
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="diagram-thumbnail-description"
          sx={{
            mt: 1,
            textAlign: "left",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: DESCRIPTION_LINE_CLAMP,
            WebkitBoxOrient: "vertical",
          }}
        >
          {description}
        </Typography>
      ) : null}
    </Box>
  );
};
