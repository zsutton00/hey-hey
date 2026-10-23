import React, { memo, useRef } from "react";
import { Alert, Box, Button } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTranslation } from "react-i18next";
import { FadeIn } from "../../../animations";
import { ConversationMessage } from "./ConversationMessage";
import { useConversationContext } from "./ConversationContext";
import {
  inputScope,
  wasShownAsPreview,
} from "../../../data/collections/optimisticConversationInputs";

export type ConversationTimelineAnimationMode = "all" | "new-only" | "none";

interface ConversationTimelineProps {
  /** Preserve data attributes from original implementation */
  "data-testid"?: string;
  messageAnimationMode?: ConversationTimelineAnimationMode;
  renderTimestamp?: boolean;
  /** Ref to the last message element for scrolling */
  lastMessageRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders the conversation message timeline with forms and system messages.
 * Now uses ConversationContext to eliminate prop drilling.
 * CRITICAL: Maintains exact status calculation and form rendering logic.
 *
 * @param props - Component props (significantly reduced due to context)
 * @returns JSX element displaying conversation timeline
 */
export const ConversationTimeline: React.FC<ConversationTimelineProps> = memo(
  ({
    "data-testid": dataTestId,
    messageAnimationMode = "all",
    renderTimestamp = false,
    lastMessageRef,
  }) => {
    const { t } = useTranslation();
    // Get all data from context instead of props
    const {
      project,
      activeConversation,
      conversationTimeline,
      initialScrollReady,
      hasOlderMessages,
      isLoadingOlderMessages,
      olderMessagesError,
      loadOlderMessages,
    } = useConversationContext();
    const internalLastMessageRef = useRef<HTMLDivElement>(null);
    const previousConversationIdRef = useRef<string | null>(null);
    const seenMessageIdsRef = useRef<Set<string>>(new Set());
    const hasCapturedInitialBatchRef = useRef(false);
    const animationDecisionsRef = useRef<Map<string, boolean>>(new Map());

    // Use provided ref or internal ref
    const lastMsgRef = lastMessageRef || internalLastMessageRef;

    if (previousConversationIdRef.current !== activeConversation.id) {
      previousConversationIdRef.current = activeConversation.id;
      seenMessageIdsRef.current = new Set();
      animationDecisionsRef.current = new Map();
      hasCapturedInitialBatchRef.current = false;
    }

    if (
      messageAnimationMode === "new-only" &&
      !hasCapturedInitialBatchRef.current &&
      conversationTimeline.length > 0
    ) {
      seenMessageIdsRef.current = new Set(
        conversationTimeline.map(
          (conversationMessage) => conversationMessage.message.id
        )
      );
      hasCapturedInitialBatchRef.current = true;
    }

    const previewScope = inputScope(
      project.organizationId,
      project.id,
      activeConversation.id
    );

    return (
      <Box
        data-testid={dataTestId}
        sx={{
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          visibility: initialScrollReady ? "visible" : "hidden",
          opacity: initialScrollReady ? 1 : 0,
          transition: initialScrollReady ? "opacity 100ms ease-out" : "none",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        {hasOlderMessages && (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 1,
              mb: 1,
            }}
          >
            <Button
              variant="text"
              size="small"
              startIcon={<ExpandMoreIcon />}
              onClick={() => {
                void loadOlderMessages().catch(() => {});
              }}
              disabled={isLoadingOlderMessages}
              data-testid="show-older-messages-button"
            >
              {olderMessagesError
                ? t("conversation.retryOlderMessages", {
                    defaultValue: "Retry loading older messages",
                  })
                : t("conversation.showOlderMessages", {
                    defaultValue: "Show older messages",
                  })}
            </Button>
          </Box>
        )}
        {olderMessagesError && (
          <Alert
            severity="error"
            data-testid="older-messages-error"
            sx={{ mb: 1 }}
          >
            {t("conversation.loadOlderMessagesError", {
              defaultValue: "Older messages could not be loaded.",
            })}
          </Alert>
        )}
        {conversationTimeline.map((conversationMessage, index) => {
          const isLastMessage = index === conversationTimeline.length - 1;
          const messageId = conversationMessage.message.id;
          // The wrapper chosen on first sight is pinned for the message's
          // lifetime: switching FadeIn <-> Fragment under the same key would
          // remount the whole message subtree and flash it blank.
          let shouldAnimate: boolean;
          if (messageAnimationMode === "all") {
            shouldAnimate = true;
          } else if (messageAnimationMode === "none") {
            shouldAnimate = false;
          } else {
            const pinned = animationDecisionsRef.current.get(messageId);
            if (pinned === undefined) {
              // A message already shown as a submission preview replaces
              // it in place rather than arriving a second time.
              shouldAnimate =
                !seenMessageIdsRef.current.has(messageId) &&
                !wasShownAsPreview(previewScope, conversationMessage.message);
              animationDecisionsRef.current.set(messageId, shouldAnimate);
              seenMessageIdsRef.current.add(messageId);
            } else {
              shouldAnimate = pinned;
            }
          }

          const messageContent = (
            <Box ref={isLastMessage ? lastMsgRef : undefined}>
              <ConversationMessage
                conversationMessage={conversationMessage}
                messageIndex={index}
                totalMessages={conversationTimeline.length}
                enableTypingAnimation={messageAnimationMode !== "none"}
                renderTimestamp={renderTimestamp}
              />
            </Box>
          );

          if (!shouldAnimate) {
            return (
              <React.Fragment key={messageId}>{messageContent}</React.Fragment>
            );
          }

          return (
            <FadeIn
              key={messageId}
              delay={messageAnimationMode === "all" ? index * 0.1 : 0}
            >
              {messageContent}
            </FadeIn>
          );
        })}
      </Box>
    );
  }
);
