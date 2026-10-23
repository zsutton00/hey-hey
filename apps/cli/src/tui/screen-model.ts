import type { Row } from './text';

/** What every screen component draws: a header line, body rows and a key hint footer. */
export interface ScreenModel {
  /** A screen without a title draws no header row or divider; its body is measured with `headerless`. */
  readonly title?: string;
  readonly aside?: string;
  /** Already fitted to the viewport; at most `bodyHeight(viewport)` rows. */
  readonly body: readonly Row[];
  readonly footer: string;
}

/**
 * Header, its divider, the footer divider and the footer take four rows; one
 * more stays free because Ink clears and redraws the whole terminal when
 * output fills every row.
 */
const FRAME_ROWS = 5;

/** The header and its divider. */
const HEADER_ROWS = 2;

export const bodyHeight = (rows: number, headerless = false): number =>
  Math.max(1, rows - FRAME_ROWS + (headerless ? HEADER_ROWS : 0));

/** Content keeps a compact width on wide terminals. */
const MAX_CONTENT_WIDTH = 100;

export const contentWidth = (columns: number): number =>
  Math.max(1, Math.min(columns, MAX_CONTENT_WIDTH));

/** Below this the menu shows a notice instead of a broken layout. */
export const MINIMUM_VIEWPORT = Object.freeze({ columns: 60, rows: 16 });
