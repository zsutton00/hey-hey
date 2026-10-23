import type { SxProps, Theme } from "@mui/material";

/**
 * Centralized layout constants for consistent dimensions across the app
 */

export const LAYOUT_CONSTANTS = {
  /**
   * Header/AppBar height in pixels
   */
  HEADER_HEIGHT: 0,

  /**
   * Project sidebar drawer width in pixels (when visible on project pages)
   * VSCode-style explorer width
   */
  DRAWER_WIDTH: 320,

  /**
   * Minimum drawer width (icon-only mode)
   */
  DRAWER_MIN_WIDTH: 72,

  /**
   * Maximum drawer width
   */
  DRAWER_MAX_WIDTH: 600,

  /**
   * Threshold below which drawer switches to minimal icon-only mode
   */
  DRAWER_MINIMAL_THRESHOLD: 120,

  /**
   * Explorer search header height in pixels
   */
  EXPLORER_HEADER_HEIGHT: 120,

  /**
   * Mobile pinned header height in pixels.
   */
  MOBILE_HEADER_HEIGHT: 48,

  /**
   * Main content padding in pixels.
   * LEFT/RIGHT are responsive: compact value used on xs/sm, comfortable value on md+.
   */
  MAIN_CONTENT_PADDING: {
    TOP: 16,
    RIGHT_XS: 16,
    RIGHT_MD: 48,
    BOTTOM: 80,
    LEFT_XS: 16,
    LEFT_MD: 48,
  },
} as const;

/**
 * Responsive horizontal padding for the main content area, as an MUI sx value.
 * 16px on xs/sm, 48px from md upward.
 */
export const MAIN_CONTENT_PADDING_X_SX: SxProps<Theme> = {
  pl: {
    xs: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT_XS}px`,
    md: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT_MD}px`,
  },
  pr: {
    xs: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT_XS}px`,
    md: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT_MD}px`,
  },
};

/**
 * CSS string helpers for common layout values
 */
export const LAYOUT_CSS = {
  HEADER_HEIGHT: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
  DRAWER_WIDTH: `${LAYOUT_CONSTANTS.DRAWER_WIDTH}px`,
  EXPLORER_HEADER_HEIGHT: `${LAYOUT_CONSTANTS.EXPLORER_HEADER_HEIGHT}px`,
  DRAWER_TOP_OFFSET: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
  DRAWER_HEIGHT: `calc(100% - ${LAYOUT_CONSTANTS.HEADER_HEIGHT}px)`,
  MAIN_MARGIN_TOP: `${LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
} as const;
