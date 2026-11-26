import React, { useLayoutEffect, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type { DiagramCardText } from "./diagramElementCardGeometry";
import { DiagramElementScreenUnavailable } from "./DiagramElementScreen";

const TITLE_LINE_CLAMP = 3;
/** The smallest card gives up title lines to fit the Mockup failure. */
const SMALL_UNAVAILABLE_TITLE_LINE_CLAMP = 1;

/** Whole text lines that fit in the element behind the returned ref. */
const useWholeLineCount = (lineHeight: number) => {
  const [area, setArea] = useState<HTMLElement | null>(null);
  const [lineCount, setLineCount] = useState(0);

  useLayoutEffect(() => {
    if (!area) {
      return;
    }

    // clientHeight ignores the canvas zoom, which is a CSS transform.
    const measure = () => {
      setLineCount(Math.floor(area.clientHeight / lineHeight));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [area, lineHeight]);

  return [setArea, lineCount] as const;
};

const clampedTextSx = (lineClamp: number) => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lineClamp,
  overflow: "hidden",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
});

interface DiagramElementCardFaceProps {
  roleIcon: React.ReactNode;
  title: string;
  summary: React.ReactNode;
  textColor: string | undefined;
  text: DiagramCardText;
  isSmall: boolean;
  isScreenUnavailable: boolean;
  /** Height at the bottom kept clear for the card's icon row. */
  bottomReserve: number;
}

/**
 * The plain Diagram Element card: role icon and name on one row, then the
 * description in whatever height is left.
 */
export function DiagramElementCardFace({
  roleIcon,
  title,
  summary,
  textColor,
  text,
  isSmall,
  isScreenUnavailable,
  bottomReserve,
}: DiagramElementCardFaceProps) {
  const [summaryAreaRef, summaryLineCount] = useWholeLineCount(
    text.summaryLineHeight,
  );
  const titleLineClamp =
    isSmall && isScreenUnavailable
      ? SMALL_UNAVAILABLE_TITLE_LINE_CLAMP
      : TITLE_LINE_CLAMP;

  return (
    <Stack
      spacing={0.5}
      data-testid="diagram-element-card-face"
      sx={{
        height: `calc(100% - ${bottomReserve}px)`,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="flex-start"
        data-testid="diagram-element-title-row"
        sx={{ flexShrink: 0 }}
      >
        {roleIcon}
        <Typography
          data-testid="workflow-inline-step-title"
          variant="body2"
          fontWeight={700}
          sx={{
            ...clampedTextSx(titleLineClamp),
            flex: 1,
            minWidth: 0,
            // Centres a single line on the role icon.
            mt: "2px",
            color: textColor ?? "text.primary",
            fontSize: `${text.titleFontSize}px`,
            lineHeight: `${text.titleLineHeight}px`,
          }}
        >
          {title}
        </Typography>
      </Stack>
      {isScreenUnavailable ? <DiagramElementScreenUnavailable /> : null}
      {summary ? (
        <Box
          ref={summaryAreaRef}
          sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        >
          <Typography
            data-testid="workflow-inline-step-summary"
            variant="body2"
            sx={{
              ...clampedTextSx(summaryLineCount),
              visibility: summaryLineCount > 0 ? "visible" : "hidden",
              color: textColor ?? "text.secondary",
              fontSize: `${text.summaryFontSize}px`,
              lineHeight: `${text.summaryLineHeight}px`,
              // Mentions flow with the sentence, and their own font must not
              // stretch a line.
              "& [data-testid='interaction-component']": { display: "inline" },
              "& [data-testid='mention-badge']": { lineHeight: 1 },
            }}
          >
            {summary}
          </Typography>
        </Box>
      ) : null}
    </Stack>
  );
}
