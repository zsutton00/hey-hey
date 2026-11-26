import { Box, ButtonBase, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { usePreviewHost } from "../../../contexts/PreviewHostContext";
import { createOpenItemEntity } from "../../../types/openItems";
import {
  DIAGRAM_ELEMENT_LINK_SELECTOR,
  isFlowEdge,
} from "../../shared/diagramElementDirectLinks";
import { DiagramCloseup } from "../../shared/WorkflowMentionInlineRenderer";
import type { WalkthroughPreview } from "./useWalkthroughPreviews";

/** Names of the highlighted elements and of those directly connected to them. */
const getPreviewNames = ({ graphData, elementIds }: WalkthroughPreview) => {
  const highlighted = new Set(elementIds);
  const neighbours = new Set(
    graphData.edges
      .filter(isFlowEdge)
      .flatMap(({ sourceNodeId, targetNodeId }) => {
        if (highlighted.has(sourceNodeId)) {
          return [targetNodeId];
        }
        return highlighted.has(targetNodeId) ? [sourceNodeId] : [];
      }),
  );
  const namesOf = (ids: ReadonlySet<string>) =>
    graphData.steps
      .filter(({ id }) => ids.has(id))
      .map(({ name }) => name)
      .join(", ");

  return {
    highlighted: namesOf(highlighted),
    neighbours: namesOf(
      new Set([...neighbours].filter((id) => !highlighted.has(id))),
    ),
  };
};

/**
 * A Diagram close-up under a walkthrough part. Selecting it anywhere but a
 * linked-item icon opens the full Diagram with the same elements highlighted.
 */
export const WalkthroughDiagramPreview: React.FC<{
  preview: WalkthroughPreview;
}> = ({ preview }) => {
  const { t } = useTranslation();
  const previewHost = usePreviewHost();
  const { graphData, elementIds } = preview;
  const diagram = graphData.workflow;
  const names = getPreviewNames(preview);
  const label = t(
    names.neighbours
      ? "changeWalkthrough.openConnectedPreview"
      : "changeWalkthrough.openPreview",
    { diagram: diagram.name, ...names },
  );

  // Captured, so elements cannot swallow the selection on its way up.
  const handleSelect = (event: React.MouseEvent<HTMLElement>) => {
    const { target, currentTarget } = event;
    // Hover previews are portals: their clicks arrive here from outside.
    if (!(target instanceof Element) || !currentTarget.contains(target)) {
      return;
    }
    if (target.closest(DIAGRAM_ELEMENT_LINK_SELECTOR)) {
      return;
    }
    previewHost.openPreview({
      ...createOpenItemEntity("task", diagram.id),
      diagramElementIds: elementIds,
    });
  };

  return (
    <Box
      component="figure"
      data-testid="walkthrough-diagram-preview"
      data-diagram-id={diagram.id}
      data-diagram-element-ids={elementIds.join(" ")}
      sx={{ m: 0, minWidth: 0 }}
    >
      <Box
        onClickCapture={handleSelect}
        sx={{ position: "relative", cursor: "pointer" }}
      >
        {/* The keyboard target. Pointers pass through to the drawing. */}
        <ButtonBase
          aria-label={label}
          data-testid="walkthrough-diagram-preview-open"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
            borderRadius: 1,
            "&.Mui-focusVisible": {
              outline: "2px solid",
              outlineColor: "primary.main",
            },
          }}
        />
        <DiagramCloseup graphData={graphData} highlightedStepIds={elementIds} />
      </Box>
      <Typography
        component="figcaption"
        variant="caption"
        color="primary"
        sx={{ display: "block", mt: 0.75, overflowWrap: "anywhere" }}
      >
        {diagram.name}
      </Typography>
    </Box>
  );
};
