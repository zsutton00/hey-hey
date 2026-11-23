import { Box, Skeleton, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { transitions } from "../../animations/variants";

export const VISUAL_ARTIFACT_THUMBNAIL_HEIGHT = 180;
const CAPTION_LINES = 3;
const CAPTION_LINE_HEIGHT = 18;
const CAPTION_GAP = 8;

export const VISUAL_ARTIFACT_PREVIEW_HEIGHT =
  VISUAL_ARTIFACT_THUMBNAIL_HEIGHT +
  CAPTION_LINES * CAPTION_LINE_HEIGHT +
  CAPTION_GAP;

export const VisualArtifactPreviewLoading = ({
  testId,
}: {
  testId: string;
}) => (
  <Skeleton
    variant="rounded"
    height="100%"
    data-testid={testId}
    aria-busy
    sx={{ "@media (prefers-reduced-motion: reduce)": { animation: "none" } }}
  />
);

export const VisualArtifactPreviewContent = ({
  children,
  caption,
  captionTestId,
}: {
  children: ReactNode;
  caption?: string;
  captionTestId?: string;
}) => (
  <Box
    data-testid="visual-artifact-preview-content"
    sx={(theme) => ({
      height: "100%",
      display: "grid",
      gridTemplateRows: "minmax(0, 1fr) auto",
      "@keyframes visualArtifactPreviewReveal": {
        from: { opacity: 0 },
        to: { opacity: 1 },
      },
      animationName: "visualArtifactPreviewReveal",
      animationDuration: `${transitions.fast.duration}s`,
      animationTimingFunction: theme.transitions.easing.easeInOut,
      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    })}
  >
    {children}
    {caption && (
      <Typography
        variant="caption"
        color="text.primary"
        data-testid={captionTestId}
        sx={{
          mt: `${CAPTION_GAP}px`,
          lineHeight: `${CAPTION_LINE_HEIGHT}px`,
          textAlign: "left",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: CAPTION_LINES,
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {caption}
      </Typography>
    )}
  </Box>
);
