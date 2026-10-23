import type {
  DiagramElementMetadata,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetPosition,
  WorkItemChangeSetRelationshipIdentity,
} from "../../api";

export function resolveDiagramExplorationTarget(
  metadata: DiagramElementMetadata | null,
  elementId: string,
  disableLinks: boolean,
): string | undefined {
  const reference = metadata?.canonicalReference;
  return !disableLinks &&
    !elementId.startsWith("temporary:") &&
    metadata?.role === "DIAGRAM_REFERENCE" &&
    reference?.entityType === "TASK" &&
    reference.entityId.length > 0 &&
    !reference.entityId.startsWith("temporary:")
    ? reference.entityId
    : undefined;
}
import type {
  WorkItemGraphConnectionGesture,
  WorkItemGraphEmptyCanvasDrop,
  WorkItemGraphReconnectGesture,
} from "./WorkflowMentionInlineRenderer";

interface ScreenPoint {
  x: number;
  y: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkItemGraphContextMenuPosition extends ScreenPoint {}

export interface WorkItemGraphNodeContextMenu {
  child: WorkItemChangeSetIdentity;
  position: WorkItemChangeSetPosition;
  menuPosition: WorkItemGraphContextMenuPosition;
}

export interface WorkItemGraphEmptyCanvasContextMenu {
  position: WorkItemChangeSetPosition;
  menuPosition: WorkItemGraphContextMenuPosition;
}

export type ConnectionCompletion =
  | { kind: "handled" }
  | { kind: "connect"; gesture: WorkItemGraphConnectionGesture }
  | { kind: "empty-canvas"; drop: WorkItemGraphEmptyCanvasDrop };

export type ReconnectCompletion =
  | { kind: "handled" }
  | { kind: "reconnect"; gesture: WorkItemGraphReconnectGesture };

export interface NodeDragCompletion {
  child: WorkItemChangeSetIdentity;
  position: WorkItemChangeSetPosition;
}

function isFinitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function resolveNodeContextMenu({
  child,
  position,
  menuPosition,
  allowContextMenu,
}: WorkItemGraphNodeContextMenu & {
  allowContextMenu: boolean;
}): WorkItemGraphNodeContextMenu | undefined {
  if (
    !allowContextMenu ||
    !isFinitePoint(position) ||
    !isFinitePoint(menuPosition)
  ) {
    return undefined;
  }
  return { child, position, menuPosition };
}

export function resolveEmptyCanvasContextMenu({
  position,
  menuPosition,
  allowContextMenu,
}: WorkItemGraphEmptyCanvasContextMenu & {
  allowContextMenu: boolean;
}): WorkItemGraphEmptyCanvasContextMenu | undefined {
  if (
    !allowContextMenu ||
    !isFinitePoint(position) ||
    !isFinitePoint(menuPosition)
  ) {
    return undefined;
  }
  return { position, menuPosition };
}

export function resolveNodeDragCompletion({
  child,
  position,
  allowNodeDragging,
  isConnecting,
  isReconnecting,
}: {
  child?: WorkItemChangeSetIdentity;
  position: WorkItemChangeSetPosition;
  allowNodeDragging: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
}): NodeDragCompletion | undefined {
  if (
    !child ||
    !allowNodeDragging ||
    isConnecting ||
    isReconnecting ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return undefined;
  }
  return { child, position };
}

export function getVisibleCanvasCenter(
  viewport: HTMLElement,
  screenToFlowPosition: (point: ScreenPoint) => WorkItemChangeSetPosition,
): WorkItemChangeSetPosition {
  const bounds = viewport.getBoundingClientRect();
  return screenToFlowPosition({
    x: bounds.left + viewport.clientWidth / 2,
    y: bounds.top + viewport.clientHeight / 2,
  });
}

export function resolveConnectionCompletion({
  source,
  target,
  isValid,
  isReconnecting,
  emptyCanvasPosition,
}: {
  source?: WorkItemChangeSetIdentity;
  target?: WorkItemChangeSetIdentity;
  isValid: boolean;
  isReconnecting: boolean;
  emptyCanvasPosition?: WorkItemChangeSetPosition;
}): ConnectionCompletion {
  if (isReconnecting || !source || isValid) {
    return { kind: "handled" };
  }
  if (target) {
    return { kind: "connect", gesture: { source, target } };
  }
  return emptyCanvasPosition
    ? {
        kind: "empty-canvas",
        drop: { source, position: emptyCanvasPosition },
      }
    : { kind: "handled" };
}

export function resolveReconnectCompletion({
  relationship,
  currentSource,
  currentTarget,
  stationaryEndpoint,
  dropTarget,
}: {
  relationship?: WorkItemChangeSetRelationshipIdentity;
  currentSource?: WorkItemChangeSetIdentity;
  currentTarget?: WorkItemChangeSetIdentity;
  stationaryEndpoint: "source" | "target";
  dropTarget?: WorkItemChangeSetIdentity;
}): ReconnectCompletion {
  if (!relationship || !currentSource || !currentTarget || !dropTarget) {
    return { kind: "handled" };
  }
  return {
    kind: "reconnect",
    gesture: {
      relationship,
      source: stationaryEndpoint === "target" ? dropTarget : currentSource,
      target: stationaryEndpoint === "source" ? dropTarget : currentTarget,
    },
  };
}
