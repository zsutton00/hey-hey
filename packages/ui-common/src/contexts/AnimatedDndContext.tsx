import React, { createContext, useContext, useState, useCallback } from "react";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import type {
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { compose } from "../i18n/compose";
import { KEYS } from "../i18n/keys";
import type {
  DraggableContent,
  DndContextValue,
  DragPreviewRenderer,
  AnimationConfig,
} from "../types/dragAndDrop";

const DndStateContext = createContext<DndContextValue | null>(null);

export interface AnimatedDndProviderProps {
  children: React.ReactNode;
  dragPreviewRenderer?: DragPreviewRenderer;
  animation?: AnimationConfig;
}

const defaultDragOverlayAnimation: AnimationConfig = {
  enabled: true,
  duration: 0.2,
  ease: [0.25, 0.46, 0.45, 0.94],
  scale: {
    drag: 1.1,
    drop: 1.2,
  },
  opacity: {
    drag: 0.9,
  },
  rotate: {
    drag: 5,
  },
};

export const AnimatedDndProvider: React.FC<AnimatedDndProviderProps> = ({
  children,
  dragPreviewRenderer,
  animation = defaultDragOverlayAnimation,
}) => {
  const { t } = useTranslation();
  const [activeContent, setActiveContent] = useState<DraggableContent | null>(
    null
  );
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const config = { ...defaultDragOverlayAnimation, ...animation };

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

    // Delay cleanup to allow drop animations
    setTimeout(() => {
      setActiveContent(null);
      setActiveSourceId(null);
      setIsDragging(false);
    }, 150);
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

  const dragOverlayVariants = {
    initial: {
      scale: 1,
      opacity: 1,
      rotate: 0,
    },
    dragging: {
      scale: config.scale?.drag || 1.1,
      opacity: config.opacity?.drag || 0.9,
      rotate: config.rotate?.drag || 5,
    },
    exit: {
      scale: config.scale?.drop || 1.2,
      opacity: 0,
    },
  };

  const renderDefaultPreview = (content: DraggableContent) => (
    <motion.div
      variants={dragOverlayVariants}
      initial="initial"
      animate="dragging"
      exit="exit"
      style={{
        padding: "8px 12px",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        border: "1px solid #ddd",
        borderRadius: "8px",
        fontSize: "14px",
        color: "#333",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        maxWidth: "300px",
      }}
    >
      {content.type === "entities" && <span>{content.data.length} items</span>}
      {content.type === "entity" && <span>{content.data.entityName}</span>}
      {content.type === "artifact" && (
        <>
          <span style={{ fontSize: "16px" }}>📄</span>
          <span>{content.data.title || t(KEYS.artifacts.defaultTitle)}</span>
        </>
      )}
      {content.type === "conversation" && (
        <>
          <span style={{ fontSize: "16px" }}>💬</span>
          <span>{content.data.title || t(KEYS.conversation.defaultTitle)}</span>
        </>
      )}
      {content.type === "initiative" && (
        <>
          <span style={{ fontSize: "16px" }}>🎯</span>
          <span>{content.data.name || compose("{{term.Initiative}}")}</span>
        </>
      )}
      {content.type === "file" && (
        <>
          <span style={{ fontSize: "16px" }}>
            {(content.data.metadata?.icon as string) || "📁"}
          </span>
          <span>{content.data.name}</span>
          <span style={{ fontSize: "12px", color: "#666" }}>
            {content.data.metadata?.formattedSize as string}
          </span>
        </>
      )}
    </motion.div>
  );

  return (
    <DndStateContext.Provider value={contextValue}>
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActiveContent(null); setActiveSourceId(null); setIsDragging(false); }}
        onDragOver={handleDragOver}
      >
        {children}
        <DragOverlay
          style={{
            cursor: "grabbing",
          }}
        >
          <AnimatePresence>
            {activeContent &&
              config.enabled &&
              (dragPreviewRenderer ? (
                <motion.div
                  variants={dragOverlayVariants}
                  initial="initial"
                  animate="dragging"
                  exit="exit"
                >
                  {dragPreviewRenderer({
                    content: activeContent,
                    isDragging: true,
                  })}
                </motion.div>
              ) : (
                renderDefaultPreview(activeContent)
              ))}
            {activeContent && !config.enabled && (
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "rgba(255, 255, 255, 0.9)",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                  color: "#333",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                }}
              >
                {activeContent.type === "entities" && <span>{activeContent.data.length} items</span>}
                {activeContent.type === "entity" && <span>{activeContent.data.entityName}</span>}
                {activeContent.type === "artifact" && (
                  <span>📄 {activeContent.data.title || "Artifact"}</span>
                )}
                {activeContent.type === "conversation" && (
                  <span>💬 {activeContent.data.title || "Conversation"}</span>
                )}
                {activeContent.type === "initiative" && (
                  <span>🎯 {activeContent.data.name || "Initiative"}</span>
                )}
                {activeContent.type === "file" && (
                  <span>
                    {(activeContent.data.metadata?.icon as string) || "📁"}{" "}
                    {activeContent.data.name}
                  </span>
                )}
              </div>
            )}
          </AnimatePresence>
        </DragOverlay>
      </DndContext>
    </DndStateContext.Provider>
  );
};

export const useAnimatedDndContext = (): DndContextValue => {
  const context = useContext(DndStateContext);
  if (!context) {
    throw new Error(
      "useAnimatedDndContext must be used within an AnimatedDndProvider"
    );
  }
  return context;
};
