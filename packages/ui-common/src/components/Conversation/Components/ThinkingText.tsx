import { Box, CircularProgress, type SxProps, type Theme } from "@mui/material";
import React, { useEffect, useId, useRef, useState } from "react";
import thinkingGif from "../../../assets/thinking_1.gif";
import writingGif from "../../../assets/writing_1.gif";
import { AgentSessionCurrentState } from "../../../api";

interface ThinkingTextProps {
  text: string;
  currentState?: AgentSessionCurrentState;
  sx?: SxProps<Theme>;
}

const STARTING_TEXT = "Starting conversation...";
const GATHERING_CONTEXT_TEXT = "Gathering context...";
const WRITING_TEXT = "Writing Response...";
const GIF_SIZE = 96;
const WRITING_LATCH_MS = 5000;

const SANS_SERIF_FONT =
  'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

const THINKING_CAPTION = "hmmm...";
const WRITING_WORDS = [
  "{ outputting: true }",
  '["writing", "content"]',
  "response.write()",
  "{ streaming: true }",
  "chunks.push(...)",
];
const REVEAL_DURATION_MS = 3600;
const CAPTION_SX = {
  fontFamily: SANS_SERIF_FONT,
  fontSize: "0.875rem",
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: "nowrap",
} as const;

const uniqueKey = (prefix: string, id: string): string =>
  `${prefix}_${id.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Caption that cycles a set of phrases, each revealing left-to-right per loop. */
const CyclingCaption: React.FC<{ words: string[]; testId: string }> = ({
  words,
  testId,
}) => {
  const revealKey = uniqueKey("captionReveal", useId());
  const wordRef = useRef<HTMLSpanElement>(null);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const el = wordRef.current;
    if (!el) return;
    const handler = () => {
      setWordIndex((i) => (i + 1) % words.length);
    };
    el.addEventListener("animationiteration", handler);
    return () => el.removeEventListener("animationiteration", handler);
  }, [words.length]);

  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        fontFamily: SANS_SERIF_FONT,
        fontSize: "0.875rem",
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <Box
        component="span"
        ref={wordRef}
        sx={{
          display: "inline-block",
          animation: `${revealKey} ${REVEAL_DURATION_MS}ms ease-in-out infinite`,
          [`@keyframes ${revealKey}`]: {
            "0%": { clipPath: "inset(0 100% 0 0)" },
            "40%": { clipPath: "inset(0 0 0 0)" },
            "82%": { clipPath: "inset(0 0 0 0)" },
            "100%": { clipPath: "inset(0 100% 0 0)" },
          },
        }}
      >
        {words[wordIndex]}
      </Box>
    </Box>
  );
};

export const ThinkingText: React.FC<ThinkingTextProps> = ({
  text,
  currentState,
  sx,
}) => {
  const normalizedText = text.trim().toLowerCase();
  const parentIsGatheringContext =
    currentState === AgentSessionCurrentState.GatheringContext ||
    normalizedText === GATHERING_CONTEXT_TEXT.toLowerCase();
  const parentIsStarting =
    parentIsGatheringContext ||
    currentState === AgentSessionCurrentState.Starting ||
    normalizedText === STARTING_TEXT.toLowerCase();
  const parentIsWriting =
    currentState === AgentSessionCurrentState.Writing ||
    normalizedText === WRITING_TEXT.toLowerCase();
  const [displayedIsWriting, setDisplayedIsWriting] = useState(parentIsWriting);
  const latchUntilRef = useRef<number>(0);

  useEffect(() => {
    if (parentIsWriting) {
      setDisplayedIsWriting(true);
      latchUntilRef.current = Date.now() + WRITING_LATCH_MS;
      return;
    }
    const remaining = latchUntilRef.current - Date.now();
    if (remaining <= 0) {
      setDisplayedIsWriting(false);
      return;
    }
    const id = setTimeout(() => {
      setDisplayedIsWriting(false);
    }, remaining);
    return () => clearTimeout(id);
  }, [parentIsWriting]);

  return (
    <Box
      sx={[
        {
          marginTop: "150px",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          color: "text.primary",
          animation: "systemMessagePulse 2.6s ease-in-out infinite",
          "@keyframes systemMessagePulse": {
            "0%, 100%": { opacity: 0.85 },
            "50%": { opacity: 1 },
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        sx={{
          position: "relative",
          width: GIF_SIZE,
          height: GIF_SIZE,
          flexShrink: 0,
        }}
      >
        {parentIsStarting ? (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress
              data-testid="thinking-indicator-gif"
              size={GIF_SIZE / 2}
              color="inherit"
            />
          </Box>
        ) : (
          <>
            <img
              src={thinkingGif}
              alt="Thinking"
              data-testid={
                displayedIsWriting ? undefined : "thinking-indicator-gif"
              }
              width={GIF_SIZE}
              height={GIF_SIZE}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                opacity: displayedIsWriting ? 0 : 1,
                transition: "opacity 100ms ease-in-out",
              }}
            />
            <img
              src={writingGif}
              alt="Writing response"
              data-testid={
                displayedIsWriting ? "thinking-indicator-gif" : undefined
              }
              width={GIF_SIZE}
              height={GIF_SIZE}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                opacity: displayedIsWriting ? 1 : 0,
                transition: "opacity 100ms ease-in-out",
              }}
            />
          </>
        )}
      </Box>
      {parentIsStarting ? (
        <Box component="span" data-testid="thinking-caption" sx={CAPTION_SX}>
          {parentIsGatheringContext ? GATHERING_CONTEXT_TEXT : STARTING_TEXT}
        </Box>
      ) : displayedIsWriting ? (
        <CyclingCaption
          key="writing"
          words={WRITING_WORDS}
          testId="writing-caption"
        />
      ) : (
        <Box component="span" data-testid="thinking-caption" sx={CAPTION_SX}>
          {THINKING_CAPTION}
        </Box>
      )}
    </Box>
  );
};
