import React, { createContext, useContext, useState, useCallback } from "react";
import { useTheme } from "@mui/material";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDndContext as useCoreDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragStartEvent,
  DragEndEvent,
  DragCancelEvent,
  DragOverEvent,
  Modifier,
} from "@dnd-kit/core";
import { compose } from "../i18n/compose";
import type {
  DraggableContent,
  DndContextValue,
  DragPreviewRenderer,
} from "../types/dragAndDrop";

const DndStateContext = createContext<DndContextValue | null>(null);

/**
 * Renders a chip for drags whose payload is not a typed DraggableContent —
 * specifically the feature-tree reparent drag, whose data shape is
 * { type: 'feature-reparent', featureId, previewLabel }. Returns null for any
 * other drag so the typed branches above stay authoritative.
 */
const FallbackDragPreview: React.FC = () => {
  const theme = useTheme();
  const { active } = useCoreDndContext();
  const data = active?.data.current as
    | { type?: string; previewLabel?: string }
    | undefined;
  if (data?.type !== "feature-reparent") return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.primary.main}`,
        borderRadius: "6px",
        fontSize: "13px",
        fontWeight: 500,
        color: theme.palette.text.primary,
        boxShadow: theme.shadows[6],
        maxWidth: "280px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
      }}
    >
      {data.previewLabel || "Feature"}
    </div>
  );
};

/** Position the drag overlay chip centered on the cursor. */
const snapToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!activatorEvent || !draggingNodeRect) return transform;
  const { clientX, clientY } = activatorEvent as PointerEvent;
  return {
    ...transform,
    x:
      transform.x +
      (clientX - draggingNodeRect.left) -
      draggingNodeRect.width / 2,
    y:
      transform.y +
      (clientY - draggingNodeRect.top) -
      draggingNodeRect.height / 2,
  };
};

export interface DndProviderProps {
  children: React.ReactNode;
  dragPreviewRenderer?: DragPreviewRenderer;
}

export const DndProvider: React.FC<DndProviderProps> = ({
  children,
  dragPreviewRenderer,
}) => {
  const theme = useTheme();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const [activeContent, setActiveContent] = useState<DraggableContent | null>(
    null
  );
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const content = active.data.current?.content as DraggableContent;
    const sourceId = active.data.current?.sourceId as string;

    setActiveContent(content);
    setActiveSourceId(sourceId);
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const content = active.data.current?.content as DraggableContent;
    const sourceId = active.data.current?.sourceId as string;
    const targetId = over?.id as string | undefined;

    if (over && active.data.current?.onDragEnd) {
      active.data.current.onDragEnd({
        content,
        sourceId,
        targetId,
        success: true,
      });
    }

    if (over && over.data.current?.onDrop) {
      over.data.current.onDrop({
        content,
        sourceId,
        targetId: over.id as string,
      });
    }

    setActiveContent(null);
    setActiveSourceId(null);
    setIsDragging(false);
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveContent(null);
    setActiveSourceId(null);
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const content = active.data.current?.content as DraggableContent;

    if (over && over.data.current?.onDragOver) {
      over.data.current.onDragOver(content);
    }
  }, []);

  const contextValue: DndContextValue = {
    activeContent,
    activeSourceId,
    isDragging,
    setActiveContent,
    setActiveSourceId,
    setIsDragging,
  };

  return (
    <DndStateContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        measuring={{
          droppable: { strategy: MeasuringStrategy.Always },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        onDragOver={handleDragOver}
      >
        {children}
        <DragOverlay
          dropAnimation={null}
          style={{ zIndex: 9999 }}
          modifiers={[snapToCursor]}
        >
          {activeContent && dragPreviewRenderer ? (
            dragPreviewRenderer({
              content: activeContent,
              isDragging: true,
            })
          ) : activeContent ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: "20px",
                fontSize: "13px",
                fontWeight: 500,
                color: theme.palette.text.primary,
                boxShadow: theme.shadows[4],
                maxWidth: "280px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                pointerEvents: "none",
              }}
            >
              {activeContent.type === "artifact" && (
                <>📄 {activeContent.data.title || "Artifact"}</>
              )}
              {activeContent.type === "conversation" && (
                <>💬 {activeContent.data.title || "Conversation"}</>
              )}
              {activeContent.type === "initiative" && (
                <>
                  🎯 {activeContent.data.name || compose("{{term.Initiative}}")}
                </>
              )}
              {activeContent.type === "entities" && <span>{activeContent.data.length} items</span>}
              {activeContent.type === "entity" && (
                <>
                  @{" "}
                  {activeContent.data.entityName ||
                    activeContent.data.entityType}
                </>
              )}
              {activeContent.type === "file" && (
                <>
                  {(activeContent.data.metadata?.icon as string) || "📁"}{" "}
                  {activeContent.data.name}
                </>
              )}
            </div>
          ) : (
            <FallbackDragPreview />
          )}
        </DragOverlay>
      </DndContext>
    </DndStateContext.Provider>
  );
};

export const useDndContext = (): DndContextValue => {
  const context = useContext(DndStateContext);
  if (!context) {
    throw new Error("useDndContext must be used within a DndProvider");
  }
  return context;
};

export const useDndContextSafe = (): DndContextValue | null => {
  return useContext(DndStateContext);
};
