import type { WorkItemTypeSectionDefinition } from "../../api";
import { resolveHtmlCssSize } from "../../utils/htmlCssSizeProfiles";
import {
  decodeHtmlCssSectionContent,
  decodeStructuredMockupSectionContent,
} from "../../utils/workItemSections";

export interface ThumbnailSize {
  /** Declared presentation size the content is laid out at. */
  declared: { width: number; height: number };
  scale: number;
  /** Rendered (scaled) size. */
  width: number;
  height: number;
}

/**
 * Fits a declared presentation size into `width` x `maxHeight` without
 * distortion, never upscaling when `maxHeight` is set. Shared by both
 * thumbnails so callers can place controls against the rendered box.
 */
export const fitThumbnailSize = (
  declared: { width: number; height: number },
  width: number,
  maxHeight?: number,
): ThumbnailSize => {
  const scale =
    maxHeight === undefined
      ? width / declared.width
      : Math.min(width / declared.width, maxHeight / declared.height, 1);
  return {
    declared,
    scale,
    width: Math.round(declared.width * scale),
    height: Math.round(declared.height * scale),
  };
};

export const resolveHtmlCssThumbnailDeclaredSize = (
  decoded: ReturnType<typeof decodeHtmlCssSectionContent>,
  definition: WorkItemTypeSectionDefinition,
) =>
  decoded
    ? resolveHtmlCssSize({
        definition,
        content: decoded,
        context: "inline",
        containerWidth: Number.MAX_SAFE_INTEGER,
      })
    : null;

export const resolveStructuredMockupThumbnailDeclaredSize = (
  decoded: ReturnType<typeof decodeStructuredMockupSectionContent>,
  definition: WorkItemTypeSectionDefinition,
) =>
  decoded
    ? resolveHtmlCssSize({
        definition,
        content: decoded,
        context: "page",
        containerWidth: Number.MAX_SAFE_INTEGER,
      })
    : null;

/** Rendered size of an HTML/CSS thumbnail, or null when it cannot render. */
export const getHtmlCssThumbnailSize = (
  content: unknown,
  definition: WorkItemTypeSectionDefinition,
  width: number,
  maxHeight?: number,
): ThumbnailSize | null => {
  const declared = resolveHtmlCssThumbnailDeclaredSize(
    decodeHtmlCssSectionContent(content),
    definition,
  );
  return declared && declared.width > 0 && declared.height > 0
    ? fitThumbnailSize(declared, width, maxHeight)
    : null;
};

/** Rendered size of a structured mockup thumbnail, or null when it cannot render. */
export const getStructuredMockupThumbnailSize = (
  content: unknown,
  definition: WorkItemTypeSectionDefinition,
  width: number,
  maxHeight?: number,
): ThumbnailSize | null => {
  const declared = resolveStructuredMockupThumbnailDeclaredSize(
    decodeStructuredMockupSectionContent(content),
    definition,
  );
  return declared && declared.width > 0 && declared.height > 0
    ? fitThumbnailSize(declared, width, maxHeight)
    : null;
};
