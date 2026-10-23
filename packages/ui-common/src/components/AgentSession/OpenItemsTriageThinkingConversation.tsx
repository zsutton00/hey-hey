import { Box } from "@mui/material";
import type { AgentSessionCurrentState, MessageResponseDto } from "../../api";
import { getInterstitialSegments } from "../Conversation/Components/interstitialTiming";
import { ThinkingText } from "../Conversation/Components/ThinkingText";
import {
  InterstitialThought,
  isInterstitialMessageData,
} from "../LlmForms/Registry/InterstitialField";

export interface OpenItemsTriageThinkingConversationProps {
  messages: readonly MessageResponseDto[];
  /** When the current review started; narration written earlier is ignored. */
  startedAt: string | null;
  currentState?: AgentSessionCurrentState;
}

/**
 * The agent's narration for the running review as connected interstitial
 * thoughts, followed by the Agent Session thinking animation.
 */
export function OpenItemsTriageThinkingConversation({
  messages,
  startedAt,
  currentState,
}: OpenItemsTriageThinkingConversationProps) {
  const start = startedAt === null ? null : Date.parse(startedAt);
  const thoughts =
    start === null
      ? []
      : messages
          .filter(
            (message) =>
              message.type === "SYSTEM" &&
              Date.parse(message.createdAt) > start &&
              isInterstitialMessageData(message.data),
          )
          .flatMap((message) =>
            getInterstitialSegments(
              typeof message.data.response === "string"
                ? message.data.response
                : "",
            )
              .filter(({ text }) => text.length > 0)
              .map(({ text, timestamp }) => ({
                key: message.id,
                text,
                timestamp,
                messageType: message.data.type ?? "AGENT",
              })),
          );

  return (
    <Box role="status" data-testid="triage-generating">
      {thoughts.length > 0 && (
        <Box data-testid="triage-narration">
          {thoughts.map((thought, index) => (
            <InterstitialThought
              key={`${thought.key}-${index}`}
              isActive
              messageType={thought.messageType}
              position={
                thoughts.length === 1
                  ? "only"
                  : index === 0
                    ? "first"
                    : index === thoughts.length - 1
                      ? "last"
                      : "middle"
              }
              thought={thought.text}
              timestamp={thought.timestamp}
            />
          ))}
        </Box>
      )}
      <ThinkingText
        text=""
        currentState={currentState}
        sx={{ marginTop: thoughts.length > 0 ? 2 : 0 }}
      />
    </Box>
  );
}
