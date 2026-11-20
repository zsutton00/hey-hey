import { Box } from "@mui/material";
import React, { useMemo } from "react";
import { rewriteProjectReportMentions } from "../Reports/viewer/projectReportMentions";
import { buildHtmlCssDocument } from "./htmlCssSketchTheme";

/** Width the report body is laid out at before being scaled to the card. */
export const REPORT_PREVIEW_LAYOUT_WIDTH = 960;

export interface HtmlCssReportBodyThumbnailProps {
  html: string;
  css: string;
  /** Rendered width of the preview in pixels. */
  width: number;
  /** Height the preview is cropped to, in pixels. */
  height: number;
  title: string;
}

/**
 * Inert miniature of a project report's authored body: laid out at a fixed
 * width, scaled to `width` and cropped to `height`. The frame has an empty
 * sandbox, no script runtime and no pointer events.
 */
export const HtmlCssReportBodyThumbnail: React.FC<
  HtmlCssReportBodyThumbnailProps
> = ({ html, css, width, height, title }) => {
  const srcDoc = useMemo(
    () =>
      buildHtmlCssDocument(rewriteProjectReportMentions(html), css, "report"),
    [html, css],
  );
  const scale = width / REPORT_PREVIEW_LAYOUT_WIDTH;

  if (width <= 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: "relative",
        width,
        maxWidth: "100%",
        height,
        overflow: "hidden",
        bgcolor: "#fff",
      }}
    >
      <Box
        component="iframe"
        data-testid="project-report-preview-frame"
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
          width: REPORT_PREVIEW_LAYOUT_WIDTH,
          height: height / scale,
          border: 0,
          pointerEvents: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </Box>
  );
};
