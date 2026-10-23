import type { WorkItemHtmlCssAnnotationPositionTarget } from "../../api";
import type {
  HtmlCssReviewElementBounds,
  HtmlCssReviewElementMetadata,
  HtmlCssReviewViewport,
} from "./htmlCssReviewBridge";

export interface HtmlCssAnnotationCanvasSize {
  width: number;
  height: number;
}

export interface HtmlCssAnnotationPoint {
  x: number;
  y: number;
}

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const normalize = (value: number): number => Math.min(1, Math.max(0, value));

export const getHtmlCssFallbackViewport = (
  canvasSize: HtmlCssAnnotationCanvasSize
): HtmlCssReviewViewport => ({
  scrollX: 0,
  scrollY: 0,
  viewportWidth: positive(canvasSize.width, 1),
  viewportHeight: positive(canvasSize.height, 1),
  documentWidth: positive(canvasSize.width, 1),
  documentHeight: positive(canvasSize.height, 1),
});

export const getHtmlCssPositionTargetFromViewportPoint = ({
  clientX,
  clientY,
  canvasRect,
  viewport,
  sizeKey,
}: {
  clientX: number;
  clientY: number;
  canvasRect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  viewport: HtmlCssReviewViewport | null;
  sizeKey: string;
}): WorkItemHtmlCssAnnotationPositionTarget => {
  const fallbackViewport = getHtmlCssFallbackViewport(canvasRect);
  const effectiveViewport = viewport ?? fallbackViewport;
  const localX = clientX - canvasRect.left;
  const localY = clientY - canvasRect.top;
  const viewportWidth = positive(
    effectiveViewport.viewportWidth,
    canvasRect.width
  );
  const viewportHeight = positive(
    effectiveViewport.viewportHeight,
    canvasRect.height
  );
  return {
    type: "position",
    x: normalize(
      (localX + effectiveViewport.scrollX) /
        positive(effectiveViewport.documentWidth, viewportWidth)
    ),
    y: normalize(
      (localY + effectiveViewport.scrollY) /
        positive(effectiveViewport.documentHeight, viewportHeight)
    ),
    sizeKey,
  };
};

export const getHtmlCssPositionAnnotationPoint = ({
  target,
  viewport,
  canvasSize,
}: {
  target: WorkItemHtmlCssAnnotationPositionTarget;
  viewport: HtmlCssReviewViewport | null;
  canvasSize: HtmlCssAnnotationCanvasSize;
}): HtmlCssAnnotationPoint => {
  if (!viewport) return { x: target.x, y: target.y };
  const viewportWidth = positive(viewport.viewportWidth, canvasSize.width);
  const viewportHeight = positive(viewport.viewportHeight, canvasSize.height);
  const documentWidth = positive(viewport.documentWidth, viewportWidth);
  const documentHeight = positive(viewport.documentHeight, viewportHeight);
  const documentX = target.x * documentWidth;
  const documentY = target.y * documentHeight;
  return {
    x: (documentX - viewport.scrollX) / viewportWidth,
    y: (documentY - viewport.scrollY) / viewportHeight,
  };
};

export const translateHtmlCssElementBounds = (
  bounds: HtmlCssReviewElementBounds,
  capturedViewport: HtmlCssReviewViewport | null,
  currentViewport: HtmlCssReviewViewport | null
): HtmlCssReviewElementBounds => {
  if (!capturedViewport || !currentViewport) return bounds;
  return {
    ...bounds,
    x: bounds.x + capturedViewport.scrollX - currentViewport.scrollX,
    y: bounds.y + capturedViewport.scrollY - currentViewport.scrollY,
  };
};

export const getHtmlCssElementAnnotationPoint = ({
  metadata,
  capturedViewport,
  currentViewport,
  canvasSize,
}: {
  metadata: HtmlCssReviewElementMetadata;
  capturedViewport: HtmlCssReviewViewport | null;
  currentViewport: HtmlCssReviewViewport | null;
  canvasSize: HtmlCssAnnotationCanvasSize;
}): HtmlCssAnnotationPoint => {
  const bounds = translateHtmlCssElementBounds(
    metadata.bounds,
    capturedViewport,
    currentViewport
  );
  const viewportWidth = positive(
    currentViewport?.viewportWidth ?? 0,
    canvasSize.width
  );
  const viewportHeight = positive(
    currentViewport?.viewportHeight ?? 0,
    canvasSize.height
  );
  return {
    x: (bounds.x + bounds.width / 2) / viewportWidth,
    y: (bounds.y + bounds.height / 2) / viewportHeight,
  };
};

export const getHtmlCssRenderedElementMetadata = (
  metadata: HtmlCssReviewElementMetadata,
  capturedViewport: HtmlCssReviewViewport | null,
  currentViewport: HtmlCssReviewViewport | null
): HtmlCssReviewElementMetadata => {
  const bounds = translateHtmlCssElementBounds(
    metadata.bounds,
    capturedViewport,
    currentViewport
  );
  if (!currentViewport) return { ...metadata, bounds };
  return {
    ...metadata,
    x: normalize((bounds.x + bounds.width / 2) / currentViewport.viewportWidth),
    y: normalize(
      (bounds.y + bounds.height / 2) / currentViewport.viewportHeight
    ),
    bounds,
  };
};
