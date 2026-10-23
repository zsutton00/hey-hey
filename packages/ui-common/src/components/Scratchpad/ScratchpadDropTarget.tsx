import { draggedEntities } from "../../types/dragAndDrop";
import React, { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import { useDndContext as useCoreDndContext } from "@dnd-kit/core";
import { DndContextDropSite } from "../DndContextDropSite";
import { useDndContextSafe } from "../../contexts/DndContext";
import { useScratchpad } from "./useScratchpad";
import type { DropEvent } from "../../types/dragAndDrop";

interface ScratchpadDropTargetProps {
  isExpanded?: boolean;
}

const DROPPABLE_ID = "scratchpad-drop-target";

export const ScratchpadDropTarget: React.FC<ScratchpadDropTargetProps> = ({
  isExpanded = false,
}) => {
  const dndState = useDndContextSafe();
  const { addFromDrag, items } = useScratchpad();
  const { measureDroppableContainers } = useCoreDndContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const activeContent = dndState?.activeContent ?? null;
  const entities = draggedEntities(activeContent);
  const alreadyInScratchpad = entities.length > 0 && entities.every((entity) =>
    items.some((item) => item.entityId === entity.entityId && item.entityType === entity.entityType));
  const isDragging = (dndState?.isDragging ?? false) && !alreadyInScratchpad;

  const handleDrop = (event: DropEvent) => {
    addFromDrag(event.content);
  };

  // The wrapper's max-height animates from 0 -> 160 when a drag starts. The
  // inner droppable's *size* doesn't change (its content is fixed), but its
  // viewport *position* shifts upward as the wrapper grows — and dnd-kit's
  // ResizeObserver only fires on size changes, so without an explicit nudge it
  // keeps using the pre-transition rect (which sits over the action-buttons
  // row). Force a re-measure when the transition ends so collision detection
  // tracks the affordance, not the buttons.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== wrapper) return;
      if (event.propertyName !== "max-height") return;
      measureDroppableContainers([DROPPABLE_ID]);
    };
    wrapper.addEventListener("transitionend", onTransitionEnd);
    return () => wrapper.removeEventListener("transitionend", onTransitionEnd);
  }, [measureDroppableContainers]);

  // Backstop in case the transitionend event is missed (e.g. cancelled mid-
  // flight or a UA that doesn't fire it for max-height): re-measure shortly
  // after the drag begins so the rect aligns with the expanded affordance.
  useEffect(() => {
    if (!isDragging) return;
    const timer = window.setTimeout(() => {
      measureDroppableContainers([DROPPABLE_ID]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isDragging, measureDroppableContainers]);

  // Always render the inner droppable so @dnd-kit measures its rect before any
  // drag starts. We only animate the wrapper's height / opacity to show or hide
  // the affordance — unmounting it during drag would leave the droppable
  // un-measured under the default BeforeDragging strategy and silently break
  // hover highlighting and drop acceptance.
  return (
    <Box
      ref={wrapperRef}
      data-testid="scratchpad-drop-target-wrapper"
      sx={{
        overflow: "hidden",
        width: "100%",
        // When not dragging, take the wrapper out of flex flow so its inner
        // content's intrinsic width doesn't widen the capsule's `width: auto`.
        // dnd-kit can still measure the droppable inside (MeasuringStrategy.Always),
        // and the setTimeout backstop above re-measures on drag start.
        position: isDragging ? "static" : "absolute",
        bottom: 0,
        left: 0,
        px: isExpanded ? 3 : 2,
        pt: isDragging ? (isExpanded ? 0 : "6px") : 0,
        pb: isDragging ? (isExpanded ? 0 : 0.5) : 0,
        maxHeight: isDragging ? 160 : 0,
        opacity: isDragging ? 1 : 0,
        pointerEvents: isDragging ? "auto" : "none",
        transition:
          "max-height 200ms ease, opacity 150ms ease, padding 200ms ease",
        flexShrink: 0,
      }}
    >
      <DndContextDropSite
        id={DROPPABLE_ID}
        acceptedTypes={["entity", "entities", "artifact", "conversation", "initiative"]}
        onDrop={handleDrop}
        disabled={!isDragging}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1,
            borderRadius: 2,
            border: "2px dashed",
            borderColor: "action.disabled",
            bgcolor: "action.hover",
            transition: "border-color 0.2s ease",
          }}
        >
          <ContentPasteIcon sx={{ fontSize: 20, color: "text.secondary" }} />
          <Box>
            <Typography variant="body2" fontWeight={500}>
              Drop to scratchpad
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Collect entities to review, compare, or discuss
              {items.length > 0 && ` (${items.length} saved)`}
            </Typography>
          </Box>
        </Box>
      </DndContextDropSite>
    </Box>
  );
};
