import type { DraggableContentType } from "../../types/dragAndDrop";

export interface ScratchpadItem {
  entityId: string;
  entityType: string;
  entityName: string;
  entitySubtype?: string;
  sourceContentType: DraggableContentType;
  addedAt: number;
}
