import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { EntityDragContent } from "../../types/dragAndDrop";

export interface EntityDragRef {
  entityId: string;
  entityType: string;
  entityTitle?: string;
  entitySubtype?: string;
}

export interface UseEntityDragSourceInput {
  entityRef: EntityDragRef;
  content?: EntityDragContent;
  idScope?: string;
  disabled?: boolean;
}

export interface UseEntityDragSourceResult {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setNodeRef: (node: HTMLElement | null) => void;
  dragId: string;
}

export function useEntityDragSource({
  entityRef,
  idScope,
  disabled,
  content,
}: UseEntityDragSourceInput): UseEntityDragSourceResult {
  const { entityId, entityType, entityTitle, entitySubtype } = entityRef;

  const dragContent = useMemo<EntityDragContent>(
    () => ({
      type: "entity",
      data: {
        entityId,
        entityType,
        entityName: entityTitle ?? entityType,
        entitySubtype,
      },
    }),
    [entityId, entityType, entityTitle, entitySubtype]
  );

  const dragId = idScope
    ? `interaction-${entityId}-${idScope}`
    : `interaction-${entityId}`;

  const { attributes, listeners, setNodeRef } = useDraggable({
    id: dragId,
    disabled,
    data: { content: content ?? dragContent, sourceId: dragId },
  });

  return { attributes, listeners, setNodeRef, dragId };
}
