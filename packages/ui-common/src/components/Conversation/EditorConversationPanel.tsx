import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, IconButton, Tooltip } from "@mui/material";
import React, { useEffect, useState } from "react";

export interface EditorConversationPanelProps {
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  enableSticky?: boolean;
  /** Whether the chat column starts open until the user toggles it. */
  initiallyOpen?: boolean;
  onConversationOpenChange?: (open: boolean) => void;
  dimensions?: {
    expandedWidth?: string;
    stickyTop?: number;
    bottomPadding?: number;
  };
}

/**
 * Edit-session layout that starts with chat closed unless `initiallyOpen` is
 * set, while keeping the editor mounted. Once the user toggles the column,
 * their choice holds for the rest of the edit session.
 */
export const EditorConversationPanel: React.FC<
  EditorConversationPanelProps
> = ({
  leftContent,
  rightContent,
  enableSticky = true,
  initiallyOpen = false,
  dimensions = {},
  onConversationOpenChange,
}) => {
  // Null until the user toggles. Until then the column follows initiallyOpen,
  // which can arrive after mount when the edited item's type loads late.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isConversationOpen = userOpen ?? initiallyOpen;
  useEffect(() => {
    onConversationOpenChange?.(isConversationOpen);
  }, [isConversationOpen, onConversationOpenChange]);
  const {
    expandedWidth = "40%",
    stickyTop = 16,
    bottomPadding = 16,
  } = dimensions;
  const stickyMaxHeight = `calc(100vh - ${stickyTop + bottomPadding}px)`;
  const toggleLabel = isConversationOpen
    ? "Collapse conversation"
    : "Expand conversation";

  return (
    <Box
      data-testid="editor-conversation-panel"
      sx={{
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        gap: 2,
        height: "100%",
        minHeight: 0,
        maxWidth: "1600px",
        width: "100%",
      }}
    >
      <Box
        data-testid="editor-conversation-content"
        sx={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          gap: 2,
        }}
      >
        {leftContent}
      </Box>

      <Box
        data-testid="editor-conversation-rail"
        sx={{
          flex: isConversationOpen ? `0 0 ${expandedWidth}` : "0 0 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: isConversationOpen ? "stretch" : "center",
          minWidth: 0,
          maxWidth: isConversationOpen ? expandedWidth : "40px",
          transition: "flex 0.3s ease-in-out, max-width 0.3s ease-in-out",
          ...(enableSticky && {
            position: "sticky",
            top: stickyTop,
            alignSelf: "flex-start",
            maxHeight: stickyMaxHeight,
          }),
        }}
      >
        <Tooltip title={toggleLabel}>
          <IconButton
            type="button"
            aria-label={toggleLabel}
            aria-expanded={isConversationOpen}
            onClick={() => setUserOpen(!isConversationOpen)}
            sx={{ alignSelf: isConversationOpen ? "flex-end" : "center" }}
          >
            {isConversationOpen ? (
              <ChevronRightIcon />
            ) : (
              <ChatBubbleOutlineIcon />
            )}
          </IconButton>
        </Tooltip>

        <Box
          data-testid="editor-conversation-chat"
          data-conversation-scroll-container="true"
          aria-hidden={!isConversationOpen}
          sx={{
            display: isConversationOpen ? "flex" : "none",
            flexDirection: "column",
            minHeight: 0,
            overflowY: enableSticky ? "auto" : "visible",
          }}
        >
          {rightContent}
        </Box>
      </Box>
    </Box>
  );
};
