import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import AdsClickOutlinedIcon from "@mui/icons-material/AdsClickOutlined";
import CheckIcon from "@mui/icons-material/Check";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import type {
  WorkItemHtmlCssAnnotation,
  WorkItemHtmlCssAnnotationTarget,
} from "../../api";
import {
  getHtmlCssElementAnnotationPoint,
  getHtmlCssPositionAnnotationPoint,
  getHtmlCssPositionTargetFromViewportPoint,
} from "./htmlCssAnnotationGeometry";
import type {
  HtmlCssReviewElementMetadata,
  HtmlCssReviewViewport,
} from "./htmlCssReviewBridge";

export const HTML_CSS_ELEMENT_SELECTION_EVENT =
  "hey-hey:html-css-element-selection";

export interface HtmlCssElementSelectionDetail {
  nodeId: string;
  x: number;
  y: number;
}

export type HtmlCssAnnotationDisplayMode = "hidden" | "pins" | "expanded";
export type HtmlCssAnnotationDisplayState = "open" | "resolved" | "outdated";
export type HtmlCssAnnotationPlacementMode = "position" | "element" | null;

export const getHtmlCssAnnotationDisplayState = (
  annotation: WorkItemHtmlCssAnnotation,
  materializedProposalId: string,
  presentationSizeKey: string
): HtmlCssAnnotationDisplayState =>
  annotation.authoredProposalId !== materializedProposalId ||
  annotation.authoredSizeKey !== presentationSizeKey
    ? "outdated"
    : annotation.lifecycle;

export interface HtmlCssAnnotationLayerProps {
  annotations: WorkItemHtmlCssAnnotation[];
  materializedProposalId: string;
  presentationSizeKey: string;
  canvasRef: React.RefObject<HTMLElement | null>;
  reviewViewport?: HtmlCssReviewViewport | null;
  elementMetadataViewports?: ReadonlyMap<string, HtmlCssReviewViewport>;
  elementsByNodeId?: ReadonlyMap<string, HtmlCssReviewElementMetadata>;
  mode: HtmlCssAnnotationDisplayMode;
  placementMode: HtmlCssAnnotationPlacementMode;
  onPlacementModeChange: (mode: HtmlCssAnnotationPlacementMode) => void;
  resolveAuthorName?: (annotation: WorkItemHtmlCssAnnotation) => string;
  onCreate?: (target: WorkItemHtmlCssAnnotationTarget) => void;
  onLifecycleChange?: (
    annotationId: string,
    lifecycle: WorkItemHtmlCssAnnotation["lifecycle"]
  ) => void;
  selectedAnnotationIds?: ReadonlySet<string>;
  onSelectedAnnotationIdsChange?: (ids: ReadonlySet<string>) => void;
}

const clampCoordinate = (value: number): number =>
  Math.min(1, Math.max(0, value));

export interface HtmlCssAnnotationControlsProps {
  mode: HtmlCssAnnotationDisplayMode;
  placementMode: HtmlCssAnnotationPlacementMode;
  canCreate: boolean;
  onModeChange: (mode: HtmlCssAnnotationDisplayMode) => void;
  onPlacementModeChange: (mode: HtmlCssAnnotationPlacementMode) => void;
}

export const HtmlCssAnnotationControls: React.FC<
  HtmlCssAnnotationControlsProps
> = ({
  mode,
  placementMode,
  canCreate,
  onModeChange,
  onPlacementModeChange,
}) => (
  <Stack
    direction="row"
    spacing={0.5}
    alignItems="center"
    data-testid="html-css-annotation-toolbar"
  >
    <Tooltip title="Add a note at a position in the mockup">
      <span>
        <Button
          aria-label="Add positional note"
          aria-pressed={placementMode === "position"}
          data-testid="html-css-add-annotation"
          disabled={!canCreate}
          color={placementMode === "position" ? "primary" : "inherit"}
          size="small"
          startIcon={<AddCommentOutlinedIcon />}
          onClick={() => {
            onModeChange("pins");
            onPlacementModeChange(
              placementMode === "position" ? null : "position"
            );
          }}
        >
          Add note
        </Button>
      </span>
    </Tooltip>
    <Tooltip title="Add note to element">
      <span>
        <IconButton
          aria-label="Add element note"
          aria-pressed={placementMode === "element"}
          data-testid="html-css-add-element-annotation"
          disabled={!canCreate}
          color={placementMode === "element" ? "primary" : "default"}
          size="small"
          onClick={() => {
            onModeChange("pins");
            onPlacementModeChange(
              placementMode === "element" ? null : "element"
            );
          }}
        >
          <AdsClickOutlinedIcon />
        </IconButton>
      </span>
    </Tooltip>
    {(
      [
        ["hidden", "Hidden", <VisibilityOffOutlinedIcon key="hidden" />],
        ["pins", "Pins", <PushPinOutlinedIcon key="pins" />],
        ["expanded", "Expanded", <UnfoldMoreIcon key="expanded" />],
      ] as const
    ).map(([value, label, icon]) => (
      <Tooltip key={value} title={label}>
        <IconButton
          aria-label={label}
          aria-pressed={mode === value}
          data-testid={`html-css-annotations-${value}`}
          color={mode === value ? "primary" : "default"}
          size="small"
          onClick={() => {
            onModeChange(value);
            onPlacementModeChange(null);
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
    ))}
  </Stack>
);

export const HtmlCssAnnotationLayer: React.FC<HtmlCssAnnotationLayerProps> = ({
  annotations,
  materializedProposalId,
  presentationSizeKey,
  canvasRef,
  reviewViewport = null,
  elementMetadataViewports = new Map(),
  elementsByNodeId = new Map(),
  mode,
  placementMode,
  onPlacementModeChange,
  resolveAuthorName,
  onCreate,
  onLifecycleChange,
  selectedAnnotationIds = new Set(),
  onSelectedAnnotationIdsChange,
}) => {
  const [elementPositions, setElementPositions] = useState<
    ReadonlyMap<string, { x: number; y: number }>
  >(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleElementSelection = (event: Event) => {
      const detail = (event as CustomEvent<HtmlCssElementSelectionDetail>)
        .detail;
      if (
        !detail ||
        typeof detail.nodeId !== "string" ||
        detail.nodeId.length === 0 ||
        !Number.isFinite(detail.x) ||
        !Number.isFinite(detail.y)
      ) {
        return;
      }
      setElementPositions((current) => {
        const next = new Map(current);
        next.set(detail.nodeId, {
          x: clampCoordinate(detail.x),
          y: clampCoordinate(detail.y),
        });
        return next;
      });
      if (placementMode === "element" && onCreate) {
        onCreate({ type: "element", nodeId: detail.nodeId });
        onPlacementModeChange(null);
      }
    };
    canvas.addEventListener(
      HTML_CSS_ELEMENT_SELECTION_EVENT,
      handleElementSelection
    );
    return () =>
      canvas.removeEventListener(
        HTML_CSS_ELEMENT_SELECTION_EVENT,
        handleElementSelection
      );
  }, [canvasRef, onCreate, onPlacementModeChange, placementMode]);

  const canvasSize = (() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  })();
  const positions = annotations.map((annotation) => {
    if (annotation.target.type === "position") {
      return {
        annotation,
        position: getHtmlCssPositionAnnotationPoint({
          target: annotation.target,
          viewport: reviewViewport,
          canvasSize,
        }),
      };
    }
    const metadata = elementsByNodeId.get(annotation.target.nodeId);
    return {
      annotation,
      position: metadata
        ? getHtmlCssElementAnnotationPoint({
            metadata,
            capturedViewport:
              elementMetadataViewports.get(annotation.target.nodeId) ?? null,
            currentViewport: reviewViewport,
            canvasSize,
          })
        : elementPositions.get(annotation.target.nodeId),
    };
  });

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (placementMode !== "position" || !onCreate) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    onCreate(
      getHtmlCssPositionTargetFromViewportPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        canvasRect: rect,
        viewport: reviewViewport,
        sizeKey: presentationSizeKey,
      })
    );
    onPlacementModeChange(null);
  };

  return (
    <Box
      data-testid="html-css-annotation-layer"
      sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Box
        aria-label={
          placementMode === "position"
            ? "Choose annotation location"
            : undefined
        }
        data-testid="html-css-annotation-canvas"
        onClick={handleCanvasClick}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: placementMode === "position" ? "auto" : "none",
          cursor: placementMode === "position" ? "crosshair" : "default",
        }}
      >
        {mode !== "hidden"
          ? positions.map(({ annotation, position }, index) =>
              position ? (
                <Tooltip key={annotation.id} title={annotation.note}>
                  <Button
                    aria-label={`Annotation ${index + 1}: ${annotation.note}`}
                    data-testid="html-css-annotation-pin"
                    data-annotation-id={annotation.id}
                    sx={{
                      position: "absolute",
                      left: `${position.x * 100}%`,
                      top: `${position.y * 100}%`,
                      minWidth: 28,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      transform: "translate(-50%, -50%)",
                      p: 0,
                      pointerEvents: "auto",
                    }}
                    variant="contained"
                  >
                    {index + 1}
                  </Button>
                </Tooltip>
              ) : null
            )
          : null}
      </Box>
      {mode === "expanded" ? (
        <Stack
          spacing={1}
          data-testid="html-css-annotation-notes"
          sx={{
            position: "absolute",
            zIndex: 3,
            top: 8,
            right: 8,
            width: "min(360px, calc(100% - 16px))",
            maxHeight: "calc(100% - 16px)",
            overflow: "auto",
            pointerEvents: "auto",
          }}
        >
          {annotations.map((annotation, index) => {
            const state = getHtmlCssAnnotationDisplayState(
              annotation,
              materializedProposalId,
              presentationSizeKey
            );
            const selectable = state === "open";
            return (
              <Paper key={annotation.id} variant="outlined" sx={{ p: 1.25 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography variant="subtitle2">Note {index + 1}</Typography>
                  {onSelectedAnnotationIdsChange ? (
                    <Tooltip
                      title={
                        selectable
                          ? "Include this note in the agent revision"
                          : "Only open, current notes can be sent"
                      }
                    >
                      <span>
                        <Checkbox
                          size="small"
                          checked={
                            selectable &&
                            selectedAnnotationIds.has(annotation.id)
                          }
                          disabled={!selectable}
                          inputProps={{
                            "aria-label": `Select annotation ${index + 1}`,
                          }}
                          data-testid="html-css-select-annotation"
                          onChange={(event) => {
                            const next = new Set(selectedAnnotationIds);
                            if (event.target.checked) next.add(annotation.id);
                            else next.delete(annotation.id);
                            onSelectedAnnotationIdsChange(next);
                          }}
                        />
                      </span>
                    </Tooltip>
                  ) : null}
                  {onLifecycleChange ? (
                    <Tooltip
                      title={
                        annotation.lifecycle === "open"
                          ? "Resolve note"
                          : "Reopen note"
                      }
                    >
                      <IconButton
                        aria-label={`${
                          annotation.lifecycle === "open" ? "Resolve" : "Reopen"
                        } annotation ${index + 1}`}
                        data-testid={`html-css-${
                          annotation.lifecycle === "open" ? "resolve" : "reopen"
                        }-annotation`}
                        onClick={() =>
                          onLifecycleChange(
                            annotation.id,
                            annotation.lifecycle === "open"
                              ? "resolved"
                              : "open"
                          )
                        }
                      >
                        {annotation.lifecycle === "open" ? (
                          <CheckIcon />
                        ) : (
                          <ReplayIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </Stack>
                <Typography
                  variant="body2"
                  sx={{ mt: 1, whiteSpace: "pre-wrap" }}
                >
                  {annotation.note}
                </Typography>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mt: 1 }}
                >
                  <Typography variant="caption" color="warning.main">
                    {state === "outdated" ? "From an earlier version" : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {resolveAuthorName?.(annotation) ?? "Reviewer"}
                  </Typography>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      ) : null}
    </Box>
  );
};
