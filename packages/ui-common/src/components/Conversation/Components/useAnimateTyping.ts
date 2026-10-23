import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAnimationConfig } from "../../../animations";
import { KEYS } from "../../../i18n/keys";
import type { SystemMessageData } from "../../../api";
import { readSystemMessageDisplayText } from "../../../utils/conversationMessageText";

// System messages to filter out from display
const FILTERED_SYSTEM_MESSAGES = [
  "opener processing completed",
  "processing completed",
] as const;

export const useAnimateTyping = ({
  isThinking,
  messageData,
  typingDuration,
  enableTypingAnimation = true,
  thinkingMessage,
  text = "",
}: {
  text?: string;
  isThinking?: boolean;
  thinkingMessage?: string;
  typingDuration?: number;
  enableTypingAnimation?: boolean;
  messageData?: SystemMessageData;
  type: string;
}) => {
  const { t } = useTranslation();
  const animationConfig = getAnimationConfig();
  const [displayedText, setDisplayedText] = useState("");
  const animationFrameRef = useRef<number | null>(null);
  const wasThinkingRef = useRef(isThinking);
  const previousDisplayTextRef = useRef<string>("");

  // Use translated default thinking message if none provided
  const defaultThinkingMessage = thinkingMessage || t(KEYS.common.thinking);

  // Check if a message should be filtered out
  const shouldFilterMessage = (messageText: string): boolean => {
    const normalizedMessage = messageText.toLowerCase().trim();
    return FILTERED_SYSTEM_MESSAGES.some(
      (filtered) => normalizedMessage === filtered.toLowerCase()
    );
  };

  // Extract text content from messageData or fallback to text prop
  const getDisplayText = (): string => {
    let extractedText = messageData
      ? readSystemMessageDisplayText(messageData) ?? ""
      : "";

    if (!extractedText) {
      extractedText = text;
    }

    // Filter out unwanted system messages
    if (shouldFilterMessage(extractedText)) {
      return "";
    }

    return extractedText;
  };

  const displayText = getDisplayText();

  const getChunkDuration = useCallback(
    (chunkLength: number) => {
      if (chunkLength <= 0) {
        return 0;
      }

      const baseDuration =
        typingDuration ?? Math.min(500, (chunkLength / 6) * 25);
      const slowedDuration = baseDuration * 1.1; // Slightly slower for streaming updates

      return slowedDuration / animationConfig.speedMultiplier;
    },
    [animationConfig.speedMultiplier, typingDuration]
  );

  const renderedTextRef = useRef<string>("");
  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const animateChunk = useCallback(
    (fromText: string, toText: string) => {
      cancelAnimation();

      if (!toText) {
        setDisplayedText("");
        renderedTextRef.current = "";
        return;
      }

      if (toText === fromText) {
        setDisplayedText(toText);
        renderedTextRef.current = toText;
        return;
      }

      const safeFromText = toText.startsWith(fromText) ? fromText : "";
      const chunk = toText.slice(safeFromText.length);

      if (!chunk) {
        setDisplayedText(toText);
        renderedTextRef.current = toText;
        return;
      }

      const duration = getChunkDuration(chunk.length);

      if (duration <= 0) {
        setDisplayedText(toText);
        renderedTextRef.current = toText;
        return;
      }

      const getNow = () =>
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      const start = getNow();

      const step = (timestamp: number) => {
        const currentTime =
          typeof timestamp === "number" && !Number.isNaN(timestamp)
            ? timestamp
            : getNow();
        const elapsed = currentTime - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 2.2);
        const charactersToShow = Math.floor(eased * chunk.length);
        const nextText = safeFromText + chunk.slice(0, charactersToShow);

        setDisplayedText(nextText);
        renderedTextRef.current = nextText;

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(step);
        } else {
          setDisplayedText(toText);
          renderedTextRef.current = toText;
        }
      };

      animationFrameRef.current = requestAnimationFrame(step);
    },
    [cancelAnimation, getChunkDuration]
  );

  useEffect(() => {
    return () => {
      cancelAnimation();
    };
  }, [cancelAnimation]);

  useEffect(() => {
    const wasThinking = wasThinkingRef.current;
    const previousDisplayText = previousDisplayTextRef.current;
    wasThinkingRef.current = isThinking;

    if (isThinking) {
      cancelAnimation();
      setDisplayedText("");
      renderedTextRef.current = "";
      previousDisplayTextRef.current = "";
      return;
    }

    if (!displayText) {
      cancelAnimation();
      setDisplayedText("");
      renderedTextRef.current = "";
      previousDisplayTextRef.current = "";
      return;
    }

    if (!enableTypingAnimation) {
      cancelAnimation();
      setDisplayedText(displayText);
      renderedTextRef.current = displayText;
      previousDisplayTextRef.current = displayText;
      return;
    }

    const currentRendered = renderedTextRef.current;

    if (
      displayText === previousDisplayText &&
      currentRendered === displayText
    ) {
      return;
    }

    if (wasThinking) {
      animateChunk("", displayText);
    } else if (displayText.startsWith(currentRendered) && currentRendered) {
      animateChunk(currentRendered, displayText);
    } else if (displayText.startsWith(previousDisplayText)) {
      animateChunk(previousDisplayText, displayText);
    } else {
      cancelAnimation();
      setDisplayedText(displayText);
      renderedTextRef.current = displayText;
    }

    previousDisplayTextRef.current = displayText;
  }, [
    animateChunk,
    cancelAnimation,
    displayText,
    enableTypingAnimation,
    isThinking,
  ]);

  useEffect(() => {
    renderedTextRef.current = displayedText;
  }, [displayedText]);

  return {
    animationConfig,
    displayText,
    displayedText,
    defaultThinkingMessage,
  };
};
