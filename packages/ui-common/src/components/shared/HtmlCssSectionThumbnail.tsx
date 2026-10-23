import { Box } from "@mui/material";
import React, { useMemo } from "react";
import type { WorkItemTypeSectionDefinition } from "../../api";
import { resolveHtmlCssSize } from "../../utils/htmlCssSizeProfiles";
import { decodeHtmlCssSectionContent } from "../../utils/workItemSections";
import {
  buildHtmlCssDocument,
  DEFAULT_HTML_CSS_PRESENTATION_STYLE,
} from "./htmlCssSketchTheme";

export interface HtmlCssSectionThumbnailProps {
  content: unknown;
  definition: WorkItemTypeSectionDefinition;
  width: number;
  /** When set, the whole mockup fits inside `width` x `maxHeight`, never upscaled. */
  maxHeight?: number;
  title?: string;
}

/**
 * Read-only, non-interactive miniature of an HTML/CSS section. The mockup is
 * laid out at its declared presentation size and scaled down to `width`, so it
 * minifies rather than reflowing like the full renderer.
 */
export const HtmlCssSectionThumbnail: React.FC<
  HtmlCssSectionThumbnailProps
> = ({
  content,
  definition,
  width,
  maxHeight,
  title = "HTML/CSS mockup thumbnail",
}) => {
  const decoded = useMemo(
    () => decodeHtmlCssSectionContent(content),
    [content],
  );
  const declaredSize = useMemo(
    () =>
      decoded
        ? resolveHtmlCssSize({
            definition,
            content: decoded,
            context: "inline",
            containerWidth: Number.MAX_SAFE_INTEGER,
          })
        : null,
    [decoded, definition],
  );
  const srcDoc = useMemo(
    () =>
      decoded
        ? buildHtmlCssDocument(
            decoded.html,
            decoded.css,
            DEFAULT_HTML_CSS_PRESENTATION_STYLE,
          )
        : "",
    [decoded],
  );

  if (!decoded || !declaredSize || declaredSize.width <= 0) return null;

  const scale =
    maxHeight === undefined
      ? width / declaredSize.width
      : Math.min(
          width / declaredSize.width,
          maxHeight / declaredSize.height,
          1,
        );

  return (
    <Box
      data-testid="html-css-section-thumbnail"
      sx={{
        position: "relative",
        width: Math.round(declaredSize.width * scale),
        maxWidth: "100%",
        mx: "auto",
        height: Math.round(declaredSize.height * scale),
        overflow: "hidden",
        borderRadius: 1,
        bgcolor: "#f4f6fb",
      }}
    >
      <Box
        component="iframe"
        title={title}
        sandbox=""
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        tabIndex={-1}
        aria-hidden
        scrolling="no"
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: declaredSize.width,
          height: declaredSize.height,
          border: 0,
          pointerEvents: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </Box>
  );
};
