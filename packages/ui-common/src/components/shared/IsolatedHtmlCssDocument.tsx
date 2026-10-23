import { Box, type SxProps, type Theme } from "@mui/material";
import React, { useMemo } from "react";
import {
  buildHtmlCssDocument,
  buildHtmlCssReviewDocument,
  type HtmlCssHostRuntime,
  type HtmlCssHostTheme,
} from "./htmlCssSketchTheme";

export interface IsolatedHtmlCssDocumentProps {
  html: string;
  css: string;
  presentationStyle: HtmlCssHostTheme;
  title: string;
  /**
   * Host-owned review runtime. Only when supplied does the frame allow its
   * nonce-bound host script; authored content stays script-free either way.
   */
  runtime?: HtmlCssHostRuntime;
  testId?: string;
  sx?: SxProps<Theme>;
}

/**
 * The isolated boundary for authored HTML/CSS: an opaque-origin sandboxed
 * iframe with a no-network CSP, sanitized markup, and no referrer.
 */
export const IsolatedHtmlCssDocument = React.forwardRef<
  HTMLIFrameElement,
  IsolatedHtmlCssDocumentProps
>(({ html, css, presentationStyle, title, runtime, testId, sx }, ref) => {
  const srcDoc = useMemo(
    () =>
      runtime
        ? buildHtmlCssReviewDocument(html, css, presentationStyle, runtime)
        : buildHtmlCssDocument(html, css, presentationStyle),
    [css, html, presentationStyle, runtime]
  );

  return (
    <Box
      component="iframe"
      ref={ref}
      title={title}
      data-testid={testId}
      sandbox={runtime ? "allow-scripts" : ""}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      sx={[
        {
          width: "100%",
          height: "100%",
          border: 0,
          borderRadius: 1,
          bgcolor: "#f4f6fb",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
});

IsolatedHtmlCssDocument.displayName = "IsolatedHtmlCssDocument";
