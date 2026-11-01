import { Box } from "@mui/material";
import React, { useMemo } from "react";
import type { WorkItemTypeSectionDefinition } from "../../api";
import { decodeStructuredMockupSectionContent } from "../../utils/workItemSections";
import {
  fitThumbnailSize,
  resolveStructuredMockupThumbnailDeclaredSize,
} from "./mockupThumbnailSize";
import { StructuredMockupSectionRenderer } from "./StructuredMockupSectionRenderer";

export interface StructuredMockupSectionThumbnailProps {
  content: unknown;
  definition: WorkItemTypeSectionDefinition;
  width: number;
  /** When set, the whole mockup fits inside `width` x `maxHeight`, never upscaled. */
  maxHeight?: number;
  organizationId?: string;
  projectId?: string;
}

/**
 * Read-only, non-interactive miniature of a structured mockup section. The
 * mockup renders at its page-size profile and is scaled down to `width`, the
 * structured counterpart of `HtmlCssSectionThumbnail`.
 */
export const StructuredMockupSectionThumbnail: React.FC<
  StructuredMockupSectionThumbnailProps
> = ({ content, definition, width, maxHeight, organizationId, projectId }) => {
  const decoded = useMemo(
    () => decodeStructuredMockupSectionContent(content),
    [content],
  );
  const declaredSize = useMemo(
    () => resolveStructuredMockupThumbnailDeclaredSize(decoded, definition),
    [decoded, definition],
  );

  if (!decoded || !declaredSize || declaredSize.width <= 0) return null;

  const fitted = fitThumbnailSize(declaredSize, width, maxHeight);

  return (
    <Box
      data-testid="structured-mockup-section-thumbnail"
      aria-hidden
      sx={{
        position: "relative",
        width: fitted.width,
        maxWidth: "100%",
        mx: "auto",
        height: fitted.height,
        overflow: "hidden",
        borderRadius: 1,
      }}
    >
      <Box
        inert
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: declaredSize.width,
          height: declaredSize.height,
          pointerEvents: "none",
          transform: `scale(${fitted.scale})`,
          transformOrigin: "top left",
          "& *": { overflow: "hidden !important" },
        }}
      >
        <StructuredMockupSectionRenderer
          content={decoded}
          definition={definition}
          context="page"
          organizationId={organizationId}
          projectId={projectId}
        />
      </Box>
    </Box>
  );
};
