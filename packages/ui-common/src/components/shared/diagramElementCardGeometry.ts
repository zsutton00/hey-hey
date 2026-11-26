import type { DiagramElementRoleDefinition } from "../../api";

/**
 * Room on a plain Diagram Element card: text sizes, how far content sits from
 * the card's outer edge, and the bottom row kept for linked-item and
 * open-reference icons. All values are pixels, measured on the card.
 */

export type DiagramCardSizeMode = "small" | "medium" | "large";

export const DIAGRAM_CARD_ICON_BUTTON_SIZE = 22;
/** Space between the text and the bottom row, and between the row's items. */
export const DIAGRAM_CARD_GAP = 2;

export interface DiagramCardText {
  titleFontSize: number;
  titleLineHeight: number;
  summaryFontSize: number;
  summaryLineHeight: number;
}

export const DIAGRAM_CARD_TEXT: Record<DiagramCardSizeMode, DiagramCardText> = {
  small: {
    titleFontSize: 12,
    titleLineHeight: 15,
    summaryFontSize: 11,
    summaryLineHeight: 15,
  },
  medium: {
    titleFontSize: 13,
    titleLineHeight: 16,
    summaryFontSize: 12,
    summaryLineHeight: 16,
  },
  large: {
    titleFontSize: 13,
    titleLineHeight: 16,
    summaryFontSize: 12,
    summaryLineHeight: 16,
  },
};

/** Border plus padding, so text does not move when the border thickens. */
const CONTENT_INSET: Record<DiagramCardSizeMode, number> = {
  small: 7,
  medium: 9,
  large: 13,
};

/** The `45% / 12%` cylinder curve scales with the card, so its insets do too. */
const CYLINDER_TOP_RATIO = 0.12;
const CYLINDER_ROW_SIDE_RATIO = 0.13;
const CYLINDER_ROW_BOTTOM_RATIO = 0.085;
const CYLINDER_EXTRA_SIDE_INSET = 2;

/** Keeps the row's square icons inside the card's rounded corners. */
const ROW_INSET = 5;
/** Clears the double outline, including its thicker highlighted form. */
const FRAME_ROW_INSET = 7;

export interface DiagramCardGeometry {
  /** Content distance from the card's outer edge. */
  content: { top: number; side: number; bottom: number };
  /** Bottom icon row distance from the card's outer edge. */
  row: { side: number; bottom: number };
}

export const getDiagramCardGeometry = (
  sizeMode: DiagramCardSizeMode,
  nodeSize: number,
  notation: DiagramElementRoleDefinition["notation"] | undefined,
): DiagramCardGeometry => {
  const inset = CONTENT_INSET[sizeMode];

  if (notation === "cylinder") {
    return {
      content: {
        top: Math.round(nodeSize * CYLINDER_TOP_RATIO),
        side: inset + CYLINDER_EXTRA_SIDE_INSET,
        bottom: inset,
      },
      row: {
        side: Math.round(nodeSize * CYLINDER_ROW_SIDE_RATIO),
        bottom: Math.round(nodeSize * CYLINDER_ROW_BOTTOM_RATIO),
      },
    };
  }

  const rowInset = notation === "frame" ? FRAME_ROW_INSET : ROW_INSET;
  return {
    content: { top: inset, side: inset, bottom: inset },
    row: { side: rowInset, bottom: rowInset },
  };
};

/** Height the content gives up so it never runs under the bottom icon row. */
export const getDiagramCardRowReserve = ({
  content,
  row,
}: DiagramCardGeometry): number =>
  Math.max(
    0,
    row.bottom +
      DIAGRAM_CARD_ICON_BUTTON_SIZE +
      DIAGRAM_CARD_GAP -
      content.bottom,
  );

/** Width of the linked-item strip, stopping short of the open-reference icon. */
export const getDiagramCardLinkStripWidth = (
  { row }: DiagramCardGeometry,
  nodeSize: number,
  hasOpenReference: boolean,
): number => {
  const openReferenceWidth = hasOpenReference
    ? DIAGRAM_CARD_ICON_BUTTON_SIZE + DIAGRAM_CARD_GAP
    : 0;
  return nodeSize - row.side * 2 - openReferenceWidth;
};
