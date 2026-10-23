import { draggedEntities } from "../../types/dragAndDrop";
import React, { useCallback, useEffect, useId } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useDroppable } from "@dnd-kit/core";
import { useTheme } from "@mui/material/styles";
import {
  $createTextNode,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
} from "lexical";
import { $createMentionNode } from "./MentionNode";
import { useDndContextSafe } from "../../contexts/DndContext";
import type { DraggableContent, EntityContent } from "../../types/dragAndDrop";

interface EntityDropPluginProps {
  droppableId?: string;
}

/**
 * Lexical plugin that accepts @dnd-kit entity drops and inserts a MentionNode.
 *
 * Renders an overlay div that acts as the drop target.
 * When an entity is dragged over, a visual indicator appears.
 * On drop, a MentionNode is inserted at the current selection or appended.
 *
 * Renders nothing when no DndProvider is in the tree.
 */
export const EntityDropPlugin: React.FC<EntityDropPluginProps> = (props) => {
  const dndContext = useDndContextSafe();
  if (!dndContext) return null;
  return <EntityDropPluginInner {...props} dndContext={dndContext} />;
};

interface InnerProps extends EntityDropPluginProps {
  dndContext: {
    activeContent: DraggableContent | null;
    isDragging: boolean;
  };
}

const EntityDropPluginInner: React.FC<InnerProps> = ({
  droppableId,
  dndContext,
}) => {
  const autoId = useId();
  const resolvedId = droppableId ?? `lexical-entity-drop-${autoId}`;
  const [editor] = useLexicalComposerContext();
  const theme = useTheme();
  const { activeContent, isDragging } = dndContext;

  const isEntityDrag = isDragging && draggedEntities(activeContent).length > 0;

  const insertMention = useCallback(
    (entities: readonly EntityContent[]) => {
      editor.update(() => {
        const selection = $getSelection();

        const nodes = entities.flatMap((entity) => [
          $createMentionNode({
            entityType:
              entity.entityType.toLowerCase() === "agent_session"
                ? "agent_session"
                : entity.entityType,
            entityId: entity.entityId,
            entityName: entity.entityName,
          }),
          $createTextNode(" "),
        ]);

        if ($isRangeSelection(selection)) {
          selection.insertNodes(nodes);
        } else {
          const root = $getRoot();
          const lastChild = root.getLastChild();
          if (lastChild && $isElementNode(lastChild)) {
            lastChild.append(...nodes);
          } else {
            root.append($createParagraphNode().append(...nodes));
          }
        }
      });
    },
    [editor]
  );

  const { setNodeRef, isOver } = useDroppable({
    id: resolvedId,
    data: {
      onDrop: (event: { content: DraggableContent }) => {
        if (draggedEntities(event.content).length) {
          insertMention(draggedEntities(event.content));
        }
      },
    },
  });

  const isEntityDragOver = isOver && isEntityDrag;

  useEffect(() => {
    if (isOver && isEntityDrag) {
      editor.focus();
    }
  }, [isOver, isEntityDrag, editor]);

  const accentColor = theme.palette.primary.main;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: isEntityDragOver ? 1 : -1,
        pointerEvents: isEntityDrag ? "auto" : "none",
        border: isEntityDragOver
          ? `2px dashed ${accentColor}`
          : "2px dashed transparent",
        borderRadius: "4px",
        backgroundColor: isEntityDragOver ? `${accentColor}0F` : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "border-color 0.15s, background-color 0.15s",
      }}
    >
      {isEntityDragOver && (
        <span
          style={{
            fontSize: "0.8rem",
            color: accentColor,
            fontWeight: 500,
            opacity: 0.8,
          }}
        >
          Drop to mention
        </span>
      )}
    </div>
  );
};
