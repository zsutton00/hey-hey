/**
 * Agent messages are plain text on the page, so links default to the theme's
 * primary color. A container that supplies its own foreground (for example a
 * solid alert) sets this variable to `currentcolor` so links follow it instead.
 */
export const SYSTEM_MESSAGE_LINK_COLOR_VAR = "--system-message-link-color";

/**
 * Code fills default to the theme's conversation surface tokens. A container
 * whose foreground is fixed (a solid alert) sets these so code keeps a
 * readable fill.
 */
export const SYSTEM_MESSAGE_CODE_BLOCK_BG_VAR =
  "--system-message-code-block-bg";
export const SYSTEM_MESSAGE_INLINE_CODE_BG_VAR =
  "--system-message-inline-code-bg";
