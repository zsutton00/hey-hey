import { useState } from "react";
import type { WorkItemChangeSetPosition } from "../../api";

interface HeldOffset {
  canvasId: string;
  arrangement: object | undefined;
  offset: WorkItemChangeSetPosition;
  revision: number;
}

/**
 * Where the inline canvas places the drawing.
 *
 * A read-only view keeps the drawing's top-left in view. An editor holds the
 * offset taken when its canvas mounted, so drags, additions and connections do
 * not move the view; it takes a new one only when an automatic arrangement
 * replaces the shown positions. `resetKey` changes whenever a mounted canvas
 * should return to the top-left.
 */
export function useDiagramCanvasOffset({
  topLeft,
  isEditing,
  canvasId,
  arrangement,
}: {
  topLeft: WorkItemChangeSetPosition;
  isEditing: boolean;
  /** Identifies the mounted canvas; null while none is mounted. */
  canvasId: string | null;
  /** The automatic arrangement on screen, if the positions are not saved. */
  arrangement: object | undefined;
}): { offset: WorkItemChangeSetPosition; resetKey: string } {
  const [held, setHeld] = useState<HeldOffset>();

  let next = held;
  if (!isEditing || canvasId === null) {
    next = undefined;
  } else if (held?.canvasId !== canvasId) {
    next = { canvasId, arrangement, offset: topLeft, revision: 0 };
  } else if (held.arrangement !== arrangement) {
    next = arrangement
      ? {
          canvasId,
          arrangement,
          offset: topLeft,
          revision: held.revision + 1,
        }
      : { ...held, arrangement };
  }
  if (next !== held) {
    setHeld(next);
  }

  return next
    ? { offset: next.offset, resetKey: `held:${next.revision}` }
    : { offset: topLeft, resetKey: `at:${topLeft.x},${topLeft.y}` };
}
