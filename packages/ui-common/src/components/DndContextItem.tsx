import React, { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { DndContextItemProps } from "../types/dragAndDrop";

export const DndContextItem: React.FC<DndContextItemProps> = ({
  content,
  children,
  id,
  disabled = false,
  onDragStart,
  onDragEnd,
  className,
}) => {
  const uniqueId = useMemo(
    () => id || `dnd-item-${Date.now()}-${Math.random()}`,
    [id]
  );

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: uniqueId,
      disabled,
      data: {
        content,
        sourceId: uniqueId,
        onDragStart,
        onDragEnd,
      },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? "default" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={className}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};
