import { useAtom } from "jotai";
import { useCallback } from "react";
import type { DraggableContent } from "../../types/dragAndDrop";
import { scratchpadAtom } from "./scratchpadAtom";
import type { ScratchpadItem } from "./types";

const toScratchpadItem = (content: DraggableContent): ScratchpadItem | null => {
  switch (content.type) {
    case "entity":
      return {
        entityId: content.data.entityId,
        entityType: content.data.entityType,
        entityName: content.data.entityName,
        entitySubtype: content.data.entitySubtype,
        sourceContentType: content.type,
        addedAt: Date.now(),
      };
    case "artifact":
      return {
        entityId: content.data.projectId ?? "",
        entityType: "artifact",
        entityName: content.data.title ?? "Artifact",
        sourceContentType: content.type,
        addedAt: Date.now(),
      };
    case "conversation":
      return {
        entityId: content.data.id,
        entityType: "conversation",
        entityName: content.data.title ?? "Conversation",
        sourceContentType: content.type,
        addedAt: Date.now(),
      };
    case "initiative":
      return {
        entityId: content.data.id,
        entityType: "initiative",
        entityName: content.data.name ?? "Initiative",
        sourceContentType: content.type,
        addedAt: Date.now(),
      };
    default:
      return null;
  }
};

export const useScratchpad = () => {
  const [items, setItems] = useAtom(scratchpadAtom);

  const addFromDrag = useCallback(
    (content: DraggableContent) => {
      const additions = content.type === "entities"
        ? content.data.map((data) => toScratchpadItem({ type: "entity", data }))
        : [toScratchpadItem(content)];

      setItems((prev) => {
        const next = [...prev];
        for (const item of additions) {
          if (item && !next.some((existing) =>
            existing.entityId === item.entityId && existing.entityType === item.entityType)) {
            next.push(item);
          }
        }
        return next.length === prev.length ? prev : next;
      });
    },
    [setItems]
  );

  const removeItem = useCallback(
    (entityId: string) => {
      setItems((prev) => prev.filter((i) => i.entityId !== entityId));
    },
    [setItems]
  );

  const reorderItems = useCallback(
    (fromIndex: number, toIndex: number) => {
      setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [setItems]
  );

  const clearAll = useCallback(() => {
    setItems([]);
  }, [setItems]);

  return { items, addFromDrag, removeItem, reorderItems, clearAll };
};
