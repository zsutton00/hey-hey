import type { WorkItemChangeSetPosition } from "../../api";

export type SavedPositionSizeMode = "small" | "medium" | "large";

/**
 * Node edge length per display size. Saved positions are stored in
 * medium-size pixels, so a size's scale is its node size over medium's.
 */
const NODE_SIZE_BY_MODE: Record<SavedPositionSizeMode, number> = {
  small: 104,
  medium: 140,
  large: 280,
};

export const SAVED_POSITION_SCALE: Record<SavedPositionSizeMode, number> = {
  small: NODE_SIZE_BY_MODE.small / NODE_SIZE_BY_MODE.medium,
  medium: 1,
  large: NODE_SIZE_BY_MODE.large / NODE_SIZE_BY_MODE.medium,
};

export const savedToDisplayPosition = (
  position: WorkItemChangeSetPosition,
  sizeMode: SavedPositionSizeMode,
): WorkItemChangeSetPosition => {
  const scale = SAVED_POSITION_SCALE[sizeMode];
  return { x: position.x * scale, y: position.y * scale };
};

export const displayToSavedPosition = (
  position: WorkItemChangeSetPosition,
  sizeMode: SavedPositionSizeMode,
): WorkItemChangeSetPosition => {
  const scale = SAVED_POSITION_SCALE[sizeMode];
  return { x: position.x / scale, y: position.y / scale };
};
