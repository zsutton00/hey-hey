import type { CreateArtifactDto } from "../api";
import type { ConversationResponseDto } from "../api";
import type { InitiativeResponseDto } from "../api";

export interface EntityContent {
  entityId: string;
  entityType: string;
  entityName: string;
  /** Optional subtype (e.g. task type: "FEATURE" | "BUG" | "STANDARD") */
  entitySubtype?: string;
}

export type DraggableContentType =
  "artifact" | "conversation" | "initiative" | "file" | "entity" | "entities";

export interface FileContent {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  preview?: string;
  metadata?: Record<string, unknown>;
}

export type DraggableContent =
  | { type: "artifact"; data: CreateArtifactDto }
  | { type: "conversation"; data: ConversationResponseDto }
  | { type: "initiative"; data: InitiativeResponseDto }
  | { type: "file"; data: FileContent }
  | { type: "entity"; data: EntityContent }
  | { type: "entities"; data: readonly [EntityContent, ...EntityContent[]] };

export type EntityDragContent = Extract<
  DraggableContent,
  { type: "entity" | "entities" }
>;

/** Consumers validate the whole batch before applying mutations. */
export function draggedEntities(
  content: DraggableContent | null | undefined,
): readonly EntityContent[] {
  if (content?.type === "entity") return [content.data];
  if (content?.type === "entities") return content.data;
  return [];
}

export interface DragStartEvent {
  content: DraggableContent;
  sourceId: string;
}

export interface DragEndEvent {
  content: DraggableContent;
  sourceId: string;
  targetId?: string;
  success: boolean;
}

export interface DropEvent {
  content: DraggableContent;
  sourceId: string;
  targetId: string;
}

export interface AnimationConfig {
  enabled?: boolean;
  duration?: number;
  ease?: string | number[];
  scale?: {
    hover?: number;
    drag?: number;
    drop?: number;
  };
  opacity?: {
    drag?: number;
    drop?: number;
  };
  rotate?: {
    hover?: number;
    drag?: number;
  };
}

export interface DndContextItemProps {
  content: DraggableContent;
  children: React.ReactNode;
  id?: string;
  disabled?: boolean;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  className?: string;
  animation?: AnimationConfig;
}

export interface FileDropEvent {
  files: File[];
  targetId: string;
}

export interface DndContextDropSiteProps {
  children: React.ReactNode;
  id?: string;
  acceptedTypes?: DraggableContentType[];
  disabled?: boolean;
  onDrop?: (event: DropEvent) => void;
  onFileDrop?: (event: FileDropEvent) => void;
  onDragOver?: (content: DraggableContent) => void;
  onDragLeave?: () => void;
  className?: string;
  acceptFiles?: boolean;
  maxFileSize?: number;
  acceptedFileTypes?: string[];
  animation?: AnimationConfig;
}

interface DragPreviewProps {
  content: DraggableContent;
  isDragging: boolean;
}

export interface DragPreviewRenderer {
  (props: DragPreviewProps): React.ReactNode;
}

interface DndContextState {
  activeContent: DraggableContent | null;
  activeSourceId: string | null;
  isDragging: boolean;
}

export interface DndContextValue extends DndContextState {
  setActiveContent: (content: DraggableContent | null) => void;
  setActiveSourceId: (sourceId: string | null) => void;
  setIsDragging: (isDragging: boolean) => void;
}
