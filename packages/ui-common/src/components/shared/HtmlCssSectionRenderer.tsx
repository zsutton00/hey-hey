import {
  Alert,
  Box,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  WorkItemHtmlCssAnnotation,
  WorkItemHtmlCssAnnotationTarget,
  WorkItemHtmlCssSectionContent,
  WorkItemTypeSectionDefinition,
} from "../../api";
import { useUsers } from "../../data/hooks/useUsers";
import { getCurrentUser } from "../../services/authService";
import { decodeHtmlCssSectionContent } from "../../utils/workItemSections";
import {
  resolveHtmlCssSize,
  type HtmlCssRenderingContext,
} from "../../utils/htmlCssSizeProfiles";
import { IsolatedHtmlCssDocument } from "./IsolatedHtmlCssDocument";
import type { MockupPageSource } from "../../utils/mockupPageUrl";
import { MockupBrowserPencil } from "./MockupBrowserPencil";
import {
  DEFAULT_HTML_CSS_PRESENTATION_STYLE,
  HTML_CSS_PRESENTATION_STYLE_LABELS,
  HTML_CSS_PRESENTATION_STYLES,
  type HtmlCssHostRuntime,
  type HtmlCssPresentationStyle,
} from "./htmlCssSketchTheme";
import {
  createHtmlCssReviewRuntime,
  parseHtmlCssReviewBridgeMessage,
  type HtmlCssReviewElementMetadata,
  type HtmlCssReviewViewport,
} from "./htmlCssReviewBridge";
import { getHtmlCssRenderedElementMetadata } from "./htmlCssAnnotationGeometry";
import {
  HTML_CSS_ELEMENT_SELECTION_EVENT,
  getHtmlCssAnnotationDisplayState,
  HtmlCssAnnotationControls,
  HtmlCssAnnotationLayer,
  type HtmlCssAnnotationDisplayMode,
  type HtmlCssAnnotationPlacementMode,
} from "./HtmlCssAnnotationLayer";

export interface HtmlCssSectionRendererProps {
  content: WorkItemHtmlCssSectionContent | string | unknown;
  definition: WorkItemTypeSectionDefinition;
  context: HtmlCssRenderingContext;
  title?: string;
  organizationId?: string;
  /** Where the pencil's page reads this mockup from; omit when it has no page (e.g. a proposal's "before" state). */
  mockupSource?: MockupPageSource;
  projectId?: string;
  materializedProposalId?: string;
  onCreateAnnotation?: (target: WorkItemHtmlCssAnnotationTarget) => void;
  onAnnotationLifecycleChange?: (
    annotationId: string,
    lifecycle: WorkItemHtmlCssAnnotation["lifecycle"],
  ) => void;
  onRevisionContextChange?: (context: HtmlCssRevisionRenderedContext) => void;
  onRequestRevision?: (request: HtmlCssRevisionRequest) => void;
}

export interface HtmlCssRevisionRenderedContext {
  renderedSize: { width: number; height: number };
  elementsByNodeId: ReadonlyMap<string, HtmlCssReviewElementMetadata>;
}

export interface HtmlCssRevisionRequest extends HtmlCssRevisionRenderedContext {
  sectionKey: string;
  sizeKey: string;
  content: WorkItemHtmlCssSectionContent;
  materializedProposalId: string;
  annotations: WorkItemHtmlCssAnnotation[];
}

export type HtmlCssRevisionLaunchBlocker =
  | "missing-provenance"
  | "missing-resolved-size"
  | "no-selected-annotations"
  | "missing-element-context";

export interface HtmlCssRevisionLaunchValidation {
  canLaunch: boolean;
  blocker: HtmlCssRevisionLaunchBlocker | null;
  missingNodeIds: string[];
}

export const validateHtmlCssRevisionLaunch = ({
  materializedProposalId,
  renderedSize,
  annotations,
  elementsByNodeId,
}: {
  materializedProposalId?: string;
  renderedSize: { width: number; height: number } | null;
  annotations: readonly WorkItemHtmlCssAnnotation[];
  elementsByNodeId: ReadonlyMap<string, HtmlCssReviewElementMetadata>;
}): HtmlCssRevisionLaunchValidation => {
  if (!materializedProposalId) {
    return {
      canLaunch: false,
      blocker: "missing-provenance",
      missingNodeIds: [],
    };
  }
  if (!renderedSize) {
    return {
      canLaunch: false,
      blocker: "missing-resolved-size",
      missingNodeIds: [],
    };
  }
  if (annotations.length === 0) {
    return {
      canLaunch: false,
      blocker: "no-selected-annotations",
      missingNodeIds: [],
    };
  }
  const missingNodeIds = Array.from(
    new Set(
      annotations.flatMap((annotation) =>
        annotation.target.type === "element" &&
        !elementsByNodeId.has(annotation.target.nodeId)
          ? [annotation.target.nodeId]
          : [],
      ),
    ),
  );
  if (missingNodeIds.length > 0) {
    return {
      canLaunch: false,
      blocker: "missing-element-context",
      missingNodeIds,
    };
  }
  return { canLaunch: true, blocker: null, missingNodeIds: [] };
};

export const HtmlCssSectionRenderer: React.FC<HtmlCssSectionRendererProps> = ({
  content,
  definition,
  context,
  title = "HTML/CSS mockup preview",
  organizationId,
  mockupSource,
  projectId,
  materializedProposalId,
  onCreateAnnotation,
  onAnnotationLifecycleChange,
  onRevisionContextChange,
  onRequestRevision,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reviewChannelToken] = useState(() => crypto.randomUUID());
  const [reviewNonce] = useState(() => crypto.randomUUID());
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [presentationStyle, setPresentationStyle] =
    useState<HtmlCssPresentationStyle>(DEFAULT_HTML_CSS_PRESENTATION_STYLE);
  const [annotationMode, setAnnotationMode] =
    useState<HtmlCssAnnotationDisplayMode>("pins");
  const [annotationPlacementMode, setAnnotationPlacementMode] =
    useState<HtmlCssAnnotationPlacementMode>(null);
  const [hoveredElement, setHoveredElement] =
    useState<HtmlCssReviewElementMetadata | null>(null);
  const [selectedElement, setSelectedElement] =
    useState<HtmlCssReviewElementMetadata | null>(null);
  const [elementsByNodeId, setElementsByNodeId] = useState<
    ReadonlyMap<string, HtmlCssReviewElementMetadata>
  >(new Map());
  const [reviewViewport, setReviewViewport] =
    useState<HtmlCssReviewViewport | null>(null);
  const [elementMetadataViewports, setElementMetadataViewports] = useState<
    ReadonlyMap<string, HtmlCssReviewViewport>
  >(new Map());
  const reviewViewportRef = useRef<HtmlCssReviewViewport | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const decoded = useMemo(
    () => decodeHtmlCssSectionContent(content),
    [content],
  );
  const effectiveSizeKey =
    decoded?.sizeKey ?? definition.defaultSizeKey ?? "default";
  const elementReviewActive = annotationPlacementMode === "element";
  const annotationControlsEnabled = Boolean(
    onCreateAnnotation || onAnnotationLifecycleChange,
  );
  const reviewRuntimeActive =
    annotationControlsEnabled &&
    (elementReviewActive ||
      annotationPlacementMode === "position" ||
      Boolean(onRevisionContextChange) ||
      Boolean(onRequestRevision) ||
      Boolean(decoded?.annotations?.length));
  const { data: organizationMembers } = useUsers(organizationId, {
    enabled: annotationControlsEnabled && Boolean(organizationId),
  });
  const resolveAuthorName = useCallback(
    (annotation: WorkItemHtmlCssAnnotation): string => {
      const author = annotation.author;
      if (author.type === "agent") return "Agent";
      const memberName = organizationMembers.find(
        (member) => member.userId === author.userId,
      )?.user?.name;
      if (memberName) return memberName;
      const currentUser = getCurrentUser();
      if (currentUser?.id === author.userId) {
        return currentUser.name ?? currentUser.email;
      }
      return "Reviewer";
    },
    [organizationMembers],
  );
  const selectedAnnotations = useMemo(
    () =>
      (decoded?.annotations ?? []).filter(
        (annotation) =>
          selectedAnnotationIds.has(annotation.id) &&
          materializedProposalId !== undefined &&
          getHtmlCssAnnotationDisplayState(
            annotation,
            materializedProposalId,
            decoded?.sizeKey ?? definition.defaultSizeKey ?? "default",
          ) === "open",
      ),
    [
      decoded,
      definition.defaultSizeKey,
      materializedProposalId,
      selectedAnnotationIds,
    ],
  );
  const revisionTargetNodeIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedAnnotations.flatMap((annotation) =>
            annotation.target.type === "element"
              ? [annotation.target.nodeId]
              : [],
          ),
        ),
      ).sort(),
    [selectedAnnotations],
  );
  const reviewRuntime = useMemo<HtmlCssHostRuntime | undefined>(
    () =>
      reviewRuntimeActive
        ? {
            nonce: reviewNonce,
            ...createHtmlCssReviewRuntime(
              reviewChannelToken,
              elementReviewActive,
              revisionTargetNodeIds,
            ),
          }
        : undefined,
    [
      elementReviewActive,
      reviewRuntimeActive,
      reviewChannelToken,
      reviewNonce,
      revisionTargetNodeIds,
    ],
  );
  useEffect(() => {
    setElementsByNodeId(new Map());
    setReviewViewport(null);
    setElementMetadataViewports(new Map());
    reviewViewportRef.current = null;
  }, [decoded, presentationStyle, reviewRuntime]);
  useEffect(() => {
    if (!reviewRuntimeActive) {
      setHoveredElement(null);
      setElementsByNodeId(new Map());
      setReviewViewport(null);
      setElementMetadataViewports(new Map());
      reviewViewportRef.current = null;
      return;
    }
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseHtmlCssReviewBridgeMessage(
        event.data,
        reviewChannelToken,
      );
      if (!message) return;
      if (message.interaction === "viewport") {
        reviewViewportRef.current = message.viewport;
        setReviewViewport(message.viewport);
        return;
      }
      if (message.interaction === "snapshot") {
        setElementsByNodeId(
          new Map(message.elements.map((element) => [element.nodeId, element])),
        );
        const capturedViewport = reviewViewportRef.current;
        setElementMetadataViewports(
          capturedViewport
            ? new Map(
                message.elements.map((element) => [
                  element.nodeId,
                  capturedViewport,
                ]),
              )
            : new Map(),
        );
        return;
      }
      if (message.interaction === "hover") {
        setHoveredElement(message.element);
        if (message.element) {
          const element = message.element;
          setElementsByNodeId((current) => {
            const next = new Map(current);
            next.set(element.nodeId, element);
            return next;
          });
          setElementMetadataViewports((current) => {
            const next = new Map(current);
            const capturedViewport = reviewViewportRef.current;
            if (capturedViewport) {
              next.set(element.nodeId, capturedViewport);
            } else {
              next.delete(element.nodeId);
            }
            return next;
          });
        }
        return;
      }
      if (!message.element) return;
      const element = message.element;
      setSelectedElement(element);
      setElementsByNodeId((current) => {
        const next = new Map(current);
        next.set(element.nodeId, element);
        return next;
      });
      setElementMetadataViewports((current) => {
        const next = new Map(current);
        const capturedViewport = reviewViewportRef.current;
        if (capturedViewport) {
          next.set(element.nodeId, capturedViewport);
        } else {
          next.delete(element.nodeId);
        }
        return next;
      });
      previewRef.current?.dispatchEvent(
        new CustomEvent(HTML_CSS_ELEMENT_SELECTION_EVENT, {
          bubbles: true,
          detail: {
            nodeId: element.nodeId,
            x: element.x,
            y: element.y,
          },
        }),
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [reviewChannelToken, reviewRuntimeActive]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = (width: number) => setContainerWidth(width);
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      update(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const resolvedSize = useMemo(
    () =>
      decoded && containerWidth !== null
        ? resolveHtmlCssSize({
            definition,
            content: decoded,
            context,
            containerWidth,
          })
        : null,
    [containerWidth, context, decoded, definition],
  );
  const displayedReviewElement = annotationControlsEnabled
    ? elementReviewActive && hoveredElement
      ? hoveredElement
      : selectedElement
    : null;
  const renderedElementsByNodeId = useMemo(() => {
    if (!reviewViewport) return elementsByNodeId;
    return new Map(
      Array.from(elementsByNodeId.entries()).map(([nodeId, metadata]) => [
        nodeId,
        getHtmlCssRenderedElementMetadata(
          metadata,
          elementMetadataViewports.get(nodeId) ?? null,
          reviewViewport,
        ),
      ]),
    );
  }, [elementMetadataViewports, elementsByNodeId, reviewViewport]);
  const launchValidation = validateHtmlCssRevisionLaunch({
    materializedProposalId,
    renderedSize: resolvedSize
      ? { width: resolvedSize.width, height: resolvedSize.height }
      : null,
    annotations: selectedAnnotations,
    elementsByNodeId: renderedElementsByNodeId,
  });

  useEffect(() => {
    if (!resolvedSize || !onRevisionContextChange) return;
    onRevisionContextChange({
      renderedSize: { width: resolvedSize.width, height: resolvedSize.height },
      elementsByNodeId: renderedElementsByNodeId,
    });
  }, [onRevisionContextChange, renderedElementsByNodeId, resolvedSize]);

  if (!decoded || (containerWidth !== null && !resolvedSize)) {
    return (
      <Alert severity="warning">
        This HTML/CSS section cannot be rendered.
      </Alert>
    );
  }

  return (
    <Stack
      ref={containerRef}
      spacing={1}
      data-testid="html-css-section-renderer"
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        data-testid="html-css-section-controls"
      >
        <Stack direction="row" spacing={1} alignItems="center">
          {materializedProposalId && annotationControlsEnabled ? (
            <>
              <HtmlCssAnnotationControls
                mode={annotationMode}
                placementMode={annotationPlacementMode}
                canCreate={Boolean(onCreateAnnotation)}
                onModeChange={setAnnotationMode}
                onPlacementModeChange={setAnnotationPlacementMode}
              />
              {onRequestRevision ? (
                <Button
                  size="small"
                  variant="contained"
                  data-testid="html-css-request-revision"
                  disabled={!decoded || !launchValidation.canLaunch}
                  onClick={() => {
                    if (!decoded || !resolvedSize) return;
                    onRequestRevision({
                      sectionKey: definition.key,
                      sizeKey:
                        decoded.sizeKey ??
                        definition.defaultSizeKey ??
                        "default",
                      content: decoded,
                      materializedProposalId,
                      renderedSize: {
                        width: resolvedSize.width,
                        height: resolvedSize.height,
                      },
                      elementsByNodeId: renderedElementsByNodeId,
                      annotations: selectedAnnotations,
                    });
                  }}
                >
                  Send selected ({selectedAnnotations.length})
                </Button>
              ) : null}
            </>
          ) : null}
        </Stack>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={presentationStyle}
          onChange={(_event, nextStyle: HtmlCssPresentationStyle | null) => {
            if (nextStyle) {
              setPresentationStyle(nextStyle);
            }
          }}
          aria-label="HTML/CSS preview style"
          data-testid="html-css-section-style-controls"
        >
          {HTML_CSS_PRESENTATION_STYLES.map((style) => (
            <ToggleButton
              key={style}
              value={style}
              aria-label={`${style} HTML/CSS preview style`}
              data-testid={`html-css-section-style-${style}`}
            >
              {HTML_CSS_PRESENTATION_STYLE_LABELS[style]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {annotationControlsEnabled &&
      selectedAnnotations.length > 0 &&
      launchValidation.blocker === "missing-element-context" ? (
        <Alert severity="info" data-testid="html-css-revision-validation">
          Waiting for rendered context for:{" "}
          {launchValidation.missingNodeIds.join(", ")}
        </Alert>
      ) : null}
      {displayedReviewElement ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="html-css-review-element-summary"
        >
          {elementReviewActive && hoveredElement ? "Hovered" : "Selected"} &lt;
          {displayedReviewElement.tag}&gt;
          {displayedReviewElement.textExcerpt
            ? ` — ${displayedReviewElement.textExcerpt}`
            : ""}
        </Typography>
      ) : null}
      <Box
        ref={previewRef}
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: resolvedSize?.width ?? "100%",
          height: resolvedSize?.height ?? 1,
          overflow: "hidden",
        }}
      >
        <IsolatedHtmlCssDocument
          ref={iframeRef}
          title={title}
          html={decoded.html}
          css={decoded.css}
          presentationStyle={presentationStyle}
          runtime={reviewRuntime}
        />
        {materializedProposalId && annotationControlsEnabled ? (
          <HtmlCssAnnotationLayer
            annotations={decoded.annotations ?? []}
            materializedProposalId={materializedProposalId}
            presentationSizeKey={
              decoded.sizeKey ?? definition.defaultSizeKey ?? "default"
            }
            canvasRef={previewRef}
            reviewViewport={reviewViewport}
            elementMetadataViewports={elementMetadataViewports}
            elementsByNodeId={elementsByNodeId}
            mode={annotationMode}
            placementMode={annotationPlacementMode}
            onPlacementModeChange={setAnnotationPlacementMode}
            resolveAuthorName={resolveAuthorName}
            onCreate={onCreateAnnotation}
            onLifecycleChange={onAnnotationLifecycleChange}
            selectedAnnotationIds={selectedAnnotationIds}
            onSelectedAnnotationIdsChange={setSelectedAnnotationIds}
          />
        ) : null}
        <Box
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 3 }}
          data-testid="html-css-pencil-overlay"
        >
          <MockupBrowserPencil
            source={mockupSource}
            organizationId={organizationId}
            projectId={projectId}
            sizeKey={effectiveSizeKey}
          />
        </Box>
      </Box>
    </Stack>
  );
};
