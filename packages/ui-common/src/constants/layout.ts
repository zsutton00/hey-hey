import type { SxProps, Theme } from "@mui/material";

/**
 * Centralized layout constants for consistent dimensions across the app
 */

export const LAYOUT_CONSTANTS = {
  /**
   * Header/AppBar height in pixels
   */
  HEADER_HEIGHT: 64,

  /**
   * Project sidebar drawer width in pixels (when visible on project pages)
   */
  DRAWER_WIDTH: 72,

  /**
   * Main content padding in pixels
   */
  MAIN_CONTENT_PADDING: {
    TOP: 48,
    RIGHT: 48,
    BOTTOM: 80,
    LEFT: 48,
    LEFT_XS: 16,
    LEFT_MD: 48,
    RIGHT_XS: 16,
    RIGHT_MD: 48,
  },

  /**
   * Responsive breakpoints for drawer behavior
   */
  BREAKPOINTS: {
    DRAWER_PERMANENT: "sm", // MUI breakpoint where drawer becomes permanent
  },
} as const;

/**
 * Calculated layout dimensions
 */
export const CALCULATED_DIMENSIONS = {
  /**
   * Total vertical space consumed by non-content elements
   */
  get TOTAL_VERTICAL_OFFSET(): number {
    return (
      LAYOUT_CONSTANTS.HEADER_HEIGHT +
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.TOP +
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.BOTTOM
    );
  },

  /**
   * Total horizontal space consumed by non-content elements on project pages
   */
  get TOTAL_HORIZONTAL_OFFSET_WITH_DRAWER(): number {
    return (
      LAYOUT_CONSTANTS.DRAWER_WIDTH +
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT +
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT
    );
  },

  /**
   * Total horizontal space consumed by non-content elements on non-project pages
   */
  get TOTAL_HORIZONTAL_OFFSET_WITHOUT_DRAWER(): number {
    return (
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT +
      LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT
    );
  },
} as const;

export const MAIN_CONTENT_PADDING_X_SX: SxProps<Theme> = {
  pl: { xs: 2, md: 6 },
  pr: { xs: 2, md: 6 },
};

/**
 * CSS string helpers for common layout values
 */
export const LAYOUT_CSS = {
  HEADER_HEIGHT: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
  DRAWER_WIDTH: `${LAYOUT_CONSTANTS.DRAWER_WIDTH}px`,
  MAIN_CONTENT_PADDING: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.TOP}px ${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT}px ${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.BOTTOM}px ${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT}px`,
  DRAWER_TOP_OFFSET: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
  DRAWER_HEIGHT: `calc(100% - ${LAYOUT_CONSTANTS.HEADER_HEIGHT}px)`,
  MAIN_MARGIN_TOP: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
} as const;
