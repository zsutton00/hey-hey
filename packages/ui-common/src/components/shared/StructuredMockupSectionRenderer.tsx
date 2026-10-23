import { Alert, Box } from "@mui/material";
import { Render } from "@puckeditor/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkItemStructuredMockupSectionContent,
  WorkItemTypeSectionDefinition,
} from "../../api";
import {
  resolveHtmlCssSize,
  type HtmlCssRenderingContext,
} from "../../utils/htmlCssSizeProfiles";
import { decodeStructuredMockupSectionContent } from "../../utils/workItemSections";
import {
  structuredMockupDocumentToPuckData,
  structuredMockupPuckConfig,
  ReferencedMockupContext,
} from "./structuredMockupPuck";
import { StructuredMockupAnnotationLayer } from "./StructuredMockupAnnotationLayer";

export interface StructuredMockupSectionRendererProps {
  content: WorkItemStructuredMockupSectionContent | string | unknown;
  definition: WorkItemTypeSectionDefinition;
  context: HtmlCssRenderingContext;
  materializedProposalId?: string;
  organizationId?: string;
  projectId?: string;
}

export const StructuredMockupSectionRenderer: React.FC<
  StructuredMockupSectionRendererProps
> = ({ content, definition, context, materializedProposalId, organizationId, projectId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const document = useMemo(
    () => decodeStructuredMockupSectionContent(content),
    [content]
  );
  const data = useMemo(
    () => (document ? structuredMockupDocumentToPuckData(document) : null),
    [document]
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = (width: number) => setContainerWidth(width);
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      update(entry.contentRect.width)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const resolvedSize = useMemo(
    () =>
      document && containerWidth !== null
        ? resolveHtmlCssSize({
            definition,
            content: document,
            context,
            containerWidth,
          })
        : null,
    [containerWidth, context, definition, document]
  );

  if (!document || !data || (containerWidth !== null && !resolvedSize)) {
    return (
      <Alert severity="warning">
        This structured mockup section cannot be rendered.
      </Alert>
    );
  }

  return (
    <Box
      ref={containerRef}
      data-testid="structured-mockup-section-renderer"
      data-rendering-context={context}
      sx={{
        width: "100%",
        maxWidth: "100%",
        overflowX: context === "page" ? "auto" : "hidden",
      }}
    >
      <Box
        ref={canvasRef}
        data-testid="structured-mockup-static-preview"
        sx={{
          position: "relative",
          width:
            context === "page"
              ? resolvedSize?.width ?? "100%"
              : "100%",
          maxWidth:
            context === "inline"
              ? resolvedSize?.width ?? "100%"
              : "none",
          minWidth: context === "page" ? resolvedSize?.width ?? 0 : 0,
          height: resolvedSize?.height ?? "auto",
          minHeight: 80,
          overflow: "auto",
          contain: "layout paint style",
          isolation: "isolate",
          boxSizing: "border-box",
          p: 2,
          color: "#302e2a",
          bgcolor: "#f3efe4",
          border: "1.5px solid #59544b",
          borderRadius: "20px 9px 17px 10px / 9px 18px 11px 17px",
          boxShadow: "2px 3px 0 #bdb5a6",
          fontFamily: '"Comic Sans MS", cursive',
        }}
      >
        <ReferencedMockupContext.Provider value={{ organizationId, projectId, ancestors: new Set() }}><Render config={structuredMockupPuckConfig} data={data} /></ReferencedMockupContext.Provider>
        {materializedProposalId ? (
          <StructuredMockupAnnotationLayer
            document={document}
            materializedProposalId={materializedProposalId}
            presentationSizeKey={document.sizeKey ?? definition.defaultSizeKey ?? "default"}
            canvasRef={canvasRef}
          />
        ) : null}
      </Box>
    </Box>
  );
};
