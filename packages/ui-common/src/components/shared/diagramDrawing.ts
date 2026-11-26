import type { Theme } from "@mui/material";

/**
 * A Diagram keeps its own typography wherever it is shown. Its root carries the
 * attribute and sets the font; a surrounding surface that restyles its text
 * leaves everything inside out with the selector suffix.
 */

export const DIAGRAM_DRAWING_ATTRIBUTES = {
  "data-diagram-drawing": true,
} as const;

/** Appended to a descendant selector. Adds no specificity. */
export const OUTSIDE_DIAGRAM_DRAWING = ":not(:where([data-diagram-drawing] *))";

export const diagramDrawingFontSx = {
  fontFamily: (theme: Theme) => theme.typography.fontFamily,
} as const;
