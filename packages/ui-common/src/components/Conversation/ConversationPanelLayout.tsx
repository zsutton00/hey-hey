import React from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";

export interface ConversationPanelLayoutProps {
  /** Whether the conversation panel is expanded */
  isExpanded: boolean;
  /** Content to render in the left panel (editor) */
  leftContent: React.ReactNode;
  /** Content to render in the right panel (conversation) */
  rightContent: React.ReactNode;
  /** Whether to enable sticky positioning for conversation panel (defaults to true) */
  enableSticky?: boolean;
  /** Custom dimension overrides */
  dimensions?: {
    /** Width when conversation panel is collapsed (defaults to "40%") */
    collapsedWidth?: string;
    /** Width when conversation panel is expanded (defaults to "70%") */
    expandedWidth?: string;
    /**
     * Distance from the top of the viewport to the panel when sticky, in
     * pixels (defaults to 16). Consumers with a fixed app header should pass
     * headerHeight + desired clearance so the panel sticks below the header.
     */
    stickyTop?: number;
    /** Space to leave below the panel in pixels (defaults to 16) */
    bottomPadding?: number;
  };
}

/**
 * Layout component for editor/conversation two-panel layout with expand/collapse and sticky positioning.
 *
 * At or below the `md` breakpoint the panels stack vertically — left content
 * first, right content below — each at full width. The right panel drops its
 * sticky positioning and viewport-based max-height so it never traps scrolling
 * on a phone.
 *
 * The right panel's max-height is a fixed `calc(100vh - stickyTop - bottomPadding)`
 * — the slice of viewport available once the panel is sticky at `stickyTop`.
 * Before scrolling the panel may extend below the fold (the user can scroll
 * to reach it); once sticky it fills the remaining viewport.
 */
export const ConversationPanelLayout: React.FC<
  ConversationPanelLayoutProps
> = ({
  isExpanded,
  leftContent,
  rightContent,
  enableSticky = true,
  dimensions = {},
}) => {
  const {
    collapsedWidth = "40%",
    expandedWidth = "70%",
    stickyTop = 16,
    bottomPadding = 16,
  } = dimensions;

  const theme = useTheme();
  const isStacked = useMediaQuery(theme.breakpoints.down("md"));

  const conversationWidth = isExpanded ? expandedWidth : collapsedWidth;
  const stickyMaxHeight = `calc(100vh - ${stickyTop + bottomPadding}px)`;

  return (
    <Box
      data-testid="conversation-layout-panel"
      sx={{
        display: "flex",
        flexDirection: isStacked ? "column" : "row",
        flexGrow: 1,
        gap: 2,
        height: isStacked ? "auto" : "100%",
        minHeight: 0,
        maxWidth: "1600px",
        width: "100%",
      }}
    >
      {/* Left Panel - Editor */}
      <Box
        data-testid="conversation-layout-left-panel"
        sx={{
          flex: isStacked ? "0 0 auto" : isExpanded ? "0 0 30%" : "0 0 60%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          gap: 2,
          transition: "flex 0.3s ease-in-out",
        }}
      >
        {leftContent}
      </Box>

      {/* Right Panel - Conversation */}
      <Box
        data-testid="conversation-layout-right-panel"
        data-conversation-scroll-container="true"
        sx={{
          flex: isStacked ? "0 0 auto" : `0 0 ${conversationWidth}`,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          width: "100%",
          maxWidth: isStacked ? "100%" : conversationWidth,
          transition: "flex 0.3s ease-in-out, max-width 0.3s ease-in-out",
          ...(enableSticky &&
            !isStacked && {
              position: "sticky",
              top: stickyTop,
              alignSelf: "flex-start",
              maxHeight: stickyMaxHeight,
              overflowY: "auto",
            }),
        }}
      >
        {rightContent}
      </Box>
    </Box>
  );
};
