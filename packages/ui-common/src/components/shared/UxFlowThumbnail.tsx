import { Box, Typography } from "@mui/material";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  toOpenApiOrganizationId,
  toOpenApiProjectId,
} from "../../clients/contractIdentifierAdapters";
import { JourneyCanvas } from "../ProposalGroupReview/JourneyCanvas";
import { JourneyScreenPlaceholder } from "../ProposalGroupReview/JourneyScreen";
import { SavedJourneyScreen } from "../ProposalGroupReview/SavedJourneyScreen";
import {
  getDiagramElementMetadata,
  type WorkflowGraphSurfaceData,
} from "./WorkflowMentionInlineRenderer";

interface Size {
  width: number;
  height: number;
}

/** A preview shows only this many screens; the rest are counted, not loaded. */
export const UX_FLOW_THUMBNAIL_MAX_SCREENS = 5;

/**
 * Read-only miniature of a UX flow: the same bare-screen grid shown under a
 * Mockup, scaled to fit a fixed-height box. Not interactive; the host card
 * owns clicks.
 */
export const UxFlowThumbnail: React.FC<{
  graphData: WorkflowGraphSurfaceData;
  height: number;
}> = ({ graphData, height }) => {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [contentSize, setContentSize] = useState<Size>({
    width: 0,
    height: 0,
  });

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setFrameWidth(frame.current?.offsetWidth ?? 0);
      setContentSize({
        width: content.current?.offsetWidth ?? 0,
        height: content.current?.offsetHeight ?? 0,
      });
    });
    if (frame.current) {
      observer.observe(frame.current);
    }
    if (content.current) {
      observer.observe(content.current);
    }
    return () => observer.disconnect();
  }, []);

  const savedPositions = useMemo(
    () =>
      new Map(
        (graphData.layout?.nodes ?? []).flatMap(({ node, position }) =>
          node.kind === "persistedWorkItem"
            ? [[node.workItemId, position] as const]
            : [],
        ),
      ),
    [graphData.layout],
  );
  const group = {
    organizationId: toOpenApiOrganizationId(graphData.workflow.organizationId),
    projectId: toOpenApiProjectId(graphData.workflow.projectId),
  };
  const steps = graphData.steps.slice(0, UX_FLOW_THUMBNAIL_MAX_SCREENS);
  const hiddenCount = graphData.steps.length - steps.length;
  const shownIds = new Set(steps.map(({ id }) => id));
  const edges = graphData.edges.filter(
    ({ sourceNodeId, targetNodeId }) =>
      shownIds.has(sourceNodeId) && shownIds.has(targetNodeId),
  );
  const measured = contentSize.width > 0 && contentSize.height > 0;
  const scale = measured
    ? Math.min(1, frameWidth / contentSize.width, height / contentSize.height)
    : 1;

  return (
    <Box
      ref={frame}
      data-testid="ux-flow-thumbnail"
      sx={{
        height,
        overflow: "hidden",
        pointerEvents: "none",
        borderRadius: 1,
        position: "relative",
      }}
    >
      <Box
        ref={content}
        sx={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: "top center",
          visibility:
            measured || typeof ResizeObserver === "undefined"
              ? "visible"
              : "hidden",
        }}
      >
        <JourneyCanvas
          readOnly
          steps={steps}
          edges={edges}
          savedPositions={savedPositions}
          renderScreen={(step) => {
            const reference =
              getDiagramElementMetadata(step)?.canonicalReference;
            return reference?.entityType === "TASK" ? (
              <SavedJourneyScreen
                readOnly
                id={reference.entityId}
                name={step.name}
                group={group}
              />
            ) : (
              <JourneyScreenPlaceholder name={step.name} />
            );
          }}
        />
      </Box>
      {hiddenCount > 0 ? (
        <Typography
          variant="caption"
          data-testid="ux-flow-thumbnail-more"
          sx={{
            position: "absolute",
            right: 8,
            bottom: 8,
            px: 0.75,
            borderRadius: 1,
            bgcolor: "background.paper",
            color: "text.secondary",
            boxShadow: 1,
          }}
        >
          +{hiddenCount}
        </Typography>
      ) : null}
    </Box>
  );
};
