/**
 * Visible-window layout for a live feed. Items are wrapped from the newest
 * backwards and only until the window is filled, so drawing cost follows the
 * screen size and scroll depth rather than how much history is retained.
 */

import type { Row } from './text';

export interface FeedWindow {
  /** Exactly the rows to draw, oldest first, at most `height` long. */
  readonly rows: readonly Row[];
  /** The offset actually applied, after clamping to the available content. */
  readonly offset: number;
  readonly moreAbove: boolean;
  readonly moreBelow: boolean;
}

/**
 * @param items ordered oldest first
 * @param toRows wrapped rows for one item at the given width
 * @param offset rows hidden below the window (0 shows the newest rows)
 */
export const layoutFeed = <T>(
  items: readonly T[],
  toRows: (item: T) => readonly Row[],
  height: number,
  offset: number,
): FeedWindow => {
  const visible = Math.max(0, height);
  const needed = offset + visible;
  const collected: Row[][] = [];
  let collectedRows = 0;
  let index = items.length - 1;
  for (; index >= 0 && collectedRows < needed; index -= 1) {
    const rows = toRows(items[index] as T);
    collected.push([...rows]);
    collectedRows += rows.length;
  }
  const exhausted = index < 0;
  const appliedOffset = exhausted ? Math.min(offset, Math.max(0, collectedRows - visible)) : offset;
  const flat = collected.reverse().flat();
  const end = flat.length - appliedOffset;
  const start = Math.max(0, end - visible);
  return {
    rows: flat.slice(start, end),
    offset: appliedOffset,
    moreAbove: start > 0 || !exhausted,
    moreBelow: appliedOffset > 0,
  };
};

/** The largest offset that still shows content; walks the whole feed, so use it per keypress, not per frame. */
export const maxFeedOffset = <T>(
  items: readonly T[],
  toRows: (item: T) => readonly Row[],
  height: number,
): number => layoutFeed(items, toRows, height, Number.MAX_SAFE_INTEGER).offset;
