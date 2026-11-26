import { Box, Typography } from "@mui/material";
import React from "react";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { UxFlowThumbnail } from "./UxFlowThumbnail";
import {
  VISUAL_ARTIFACT_PREVIEW_HEIGHT,
  VisualArtifactPreviewContent,
  VisualArtifactPreviewLoading,
} from "./VisualArtifactPreview";
import {
  getDiagramMetadata,
  hydrateWorkflowGraphEdges,
  WorkflowGraphThumbnail,
} from "./WorkflowMentionInlineRenderer";

export interface DiagramThumbnailProps {
  organizationId: string;
  projectId: string;
  diagramId: string;
}

/**
 * Read-only miniature of a whole Diagram, fit into a fixed-height box. Loads
 * the same graph aggregate as the inline Diagram renderer.
 */
export const DiagramThumbnail: React.FC<DiagramThumbnailProps> = ({
  organizationId,
  projectId,
  diagramId,
}) => {
  const graphQuery = useWorkItemGraph(organizationId, projectId, diagramId);
  const diagramType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    "DIAGRAM",
  );
  const elementType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    "DIAGRAM_ELEMENT",
  );
  const graph = graphQuery.data;
  if (
    !graphQuery.isFetched ||
    !diagramType.isFetched ||
    !elementType.isFetched
  ) {
    return <VisualArtifactPreviewLoading testId="diagram-thumbnail-loading" />;
  }

  if (graphQuery.error || !graph?.root) {
    return (
      <VisualArtifactPreviewContent>
        <Box
          data-testid="diagram-thumbnail-unavailable"
          sx={{
            display: "grid",
            placeItems: "center",
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Diagram preview unavailable
          </Typography>
        </Box>
      </VisualArtifactPreviewContent>
    );
  }

  const graphData = {
    workflow: graph.root,
    steps: graph.children.filter(
      (step) => step.type.toUpperCase() === "DIAGRAM_ELEMENT",
    ),
    edges: graph.relationships,
    participation: graph.participation,
    workflowTypeDefinition: diagramType.workItemTypeDefinition,
    nodeTypeDefinition: elementType.workItemTypeDefinition,
    layout: graph.layout,
  };

  // The mention only says "diagram", so the kind is known once the load resolves.
  if (getDiagramMetadata(graph.root)?.kind === "UX_FLOW") {
    return (
      <VisualArtifactPreviewContent>
        <UxFlowThumbnail
          height={VISUAL_ARTIFACT_PREVIEW_HEIGHT}
          graphData={hydrateWorkflowGraphEdges(graphData)}
        />
      </VisualArtifactPreviewContent>
    );
  }

  return <WorkflowGraphThumbnail graphData={graphData} />;
};
