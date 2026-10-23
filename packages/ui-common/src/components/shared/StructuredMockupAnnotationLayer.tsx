import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import CheckIcon from "@mui/icons-material/Check";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import React, { useEffect, useState } from "react";
import type {
  WorkItemStructuredMockupAnnotation,
  WorkItemStructuredMockupAnnotationTarget,
} from "../../api";
import type { NormalizedWorkItemStructuredMockupDocument } from "../../utils/workItemSections";

export type AnnotationDisplayMode = "hidden" | "pins" | "expanded";
export type AnnotationDisplayState = "open" | "resolved" | "outdated";

export const getAnnotationDisplayState = (
  annotation: WorkItemStructuredMockupAnnotation,
  materializedProposalId: string,
  presentationSizeKey: string
): AnnotationDisplayState =>
  !("authoredProposalId" in annotation) ||
  annotation.authoredProposalId !== materializedProposalId ||
  annotation.authoredSizeKey !== presentationSizeKey
    ? "outdated"
    : annotation.lifecycle;

export interface StructuredMockupAnnotationLayerProps {
  document: NormalizedWorkItemStructuredMockupDocument;
  materializedProposalId: string;
  presentationSizeKey: string;
  canvasRef: React.RefObject<HTMLElement | null>;
  onCreate?: (target: WorkItemStructuredMockupAnnotationTarget) => void;
  onLifecycleChange?: (
    annotationId: string,
    lifecycle: WorkItemStructuredMockupAnnotation["lifecycle"]
  ) => void;
}

const authorLabel = (annotation: WorkItemStructuredMockupAnnotation): string =>
  annotation.author.type === "human" ? "Human reviewer" : "Agent reviewer";

const componentPosition = (
  canvas: HTMLElement | null,
  componentId: string
): { x: number; y: number } | null => {
  if (!canvas) return null;
  const escaped =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(componentId)
      : componentId.replace(/["\\]/g, "\\$&");
  const element = canvas.querySelector<HTMLElement>(
    `[data-structured-mockup-component-id="${escaped}"]`
  );
  if (!element) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  return {
    x:
      (targetRect.left + targetRect.width / 2 - canvasRect.left) /
      canvasRect.width,
    y:
      (targetRect.top + targetRect.height / 2 - canvasRect.top) /
      canvasRect.height,
  };
};

export const StructuredMockupAnnotationLayer: React.FC<
  StructuredMockupAnnotationLayerProps
> = ({
  document,
  materializedProposalId,
  presentationSizeKey,
  canvasRef,
  onCreate,
  onLifecycleChange,
}) => {
  const [mode, setMode] = useState<AnnotationDisplayMode>("pins");
  const [placing, setPlacing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [, refreshPositions] = useState(0);

  const startPlacement = () => {
    if (!onCreate) return;
    setMode("pins");
    setPlacing(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onCreate) return;
    const openContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setContextMenu({ top: event.clientY, left: event.clientX });
    };
    canvas.addEventListener("contextmenu", openContextMenu);
    return () => canvas.removeEventListener("contextmenu", openContextMenu);
  }, [canvasRef, onCreate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    refreshPositions((value) => value + 1);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      refreshPositions((value) => value + 1)
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, document.content]);

  const positions = document.annotations.map((annotation) => ({
    annotation,
    position:
      annotation.target.type === "position"
        ? annotation.target
        : componentPosition(canvasRef.current, annotation.target.componentId),
  }));

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onCreate || !placing) return;
    const targetElement = [
      event.target as HTMLElement,
      ...(typeof globalThis.document.elementsFromPoint === "function"
        ? globalThis.document.elementsFromPoint(event.clientX, event.clientY)
        : []),
    ]
      .map((element) =>
        element.closest<HTMLElement>("[data-structured-mockup-component-id]")
      )
      .find((element) => element !== null);
    if (targetElement?.dataset.structuredMockupComponentId) {
      onCreate({
        type: "component",
        componentId: targetElement.dataset.structuredMockupComponentId,
      });
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      onCreate({
        type: "position",
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      });
    }
    setPlacing(false);
  };

  return (
    <Box
      data-testid="structured-mockup-annotation-layer"
      sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Stack
        component={Paper}
        elevation={2}
        direction="row"
        spacing={0.5}
        data-testid="structured-mockup-annotation-toolbar"
        sx={(theme) => ({
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 3,
          pointerEvents: "auto",
          alignItems: "center",
          p: 0.25,
          border: 1,
          borderColor: alpha(theme.palette.divider, 0.72),
          bgcolor: alpha(theme.palette.background.paper, 0.84),
          backdropFilter: "blur(4px)",
        })}
      >
        <Tooltip title="Add note">
          <span>
            <IconButton
              data-testid="structured-mockup-add-annotation"
              aria-label="Add note"
              aria-pressed={placing}
              color={placing ? "primary" : "default"}
              size="small"
              disabled={!onCreate}
              sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 18 } }}
              onClick={() => (placing ? setPlacing(false) : startPlacement())}
            >
              <AddCommentOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Stack
          direction="row"
          role="group"
          aria-label="Annotation display mode"
          data-testid="structured-mockup-annotation-display-controls"
          sx={{ borderLeft: 1, borderColor: "divider", pl: 0.5 }}
        >
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
                color={mode === value ? "primary" : "default"}
                size="small"
                sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 18 } }}
                onClick={() => {
                  setMode(value);
                  setPlacing(false);
                }}
                data-testid={`structured-mockup-annotations-${value}`}
              >
                {icon}
              </IconButton>
            </Tooltip>
          ))}
        </Stack>
      </Stack>
      <Box
        onClick={handleCanvasClick}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: placing ? "auto" : "none",
          cursor: placing ? "crosshair" : "default",
        }}
        aria-label={placing ? "Choose annotation location" : undefined}
        data-testid="structured-mockup-annotation-canvas"
        title={onCreate ? "Right-click to Add note" : undefined}
      >
        {mode !== "hidden"
          ? positions.map(({ annotation, position }, index) =>
              position ? (
                <Tooltip
                  key={annotation.id}
                  title={`${annotation.note} · ${authorLabel(annotation)} · ${
                    annotation.category
                  } · ${getAnnotationDisplayState(
                    annotation,
                    materializedProposalId,
                    presentationSizeKey
                  )}`}
                >
                  <Button
                    aria-label={`Annotation ${index + 1}: ${annotation.note}`}
                    data-testid="structured-mockup-annotation-pin"
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
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ?? undefined}
      >
        <MenuItem
          data-testid="structured-mockup-context-add-annotation"
          onClick={() => {
            setContextMenu(null);
            startPlacement();
          }}
        >
          Add note
        </MenuItem>
      </Menu>
      {mode === "expanded" ? (
        <Stack
          spacing={1}
          data-testid="structured-mockup-annotation-notes"
          sx={{
            position: "absolute",
            zIndex: 3,
            top: 48,
            right: 8,
            width: "min(360px, calc(100% - 16px))",
            maxHeight: "calc(100% - 56px)",
            overflow: "auto",
            pointerEvents: "auto",
          }}
        >
          {document.annotations.map((annotation, index) => {
            const state = getAnnotationDisplayState(
              annotation,
              materializedProposalId,
              presentationSizeKey
            );
            return (
              <Paper key={annotation.id} variant="outlined" sx={{ p: 1.25 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <Typography variant="subtitle2">Note {index + 1}</Typography>
                  <Chip size="small" label={authorLabel(annotation)} />
                  <Chip size="small" label={annotation.category} />
                  <Chip
                    size="small"
                    color={
                      state === "outdated"
                        ? "warning"
                        : state === "resolved"
                        ? "success"
                        : "default"
                    }
                    label={state}
                  />
                  {onLifecycleChange ? (
                    <IconButton
                      data-testid={`structured-mockup-${
                        annotation.lifecycle === "open" ? "resolve" : "reopen"
                      }-annotation`}
                      aria-label={`${
                        annotation.lifecycle === "open" ? "Resolve" : "Reopen"
                      } annotation ${index + 1}`}
                      onClick={() =>
                        onLifecycleChange(
                          annotation.id,
                          annotation.lifecycle === "open" ? "resolved" : "open"
                        )
                      }
                    >
                      {annotation.lifecycle === "open" ? (
                        <CheckIcon />
                      ) : (
                        <ReplayIcon />
                      )}
                    </IconButton>
                  ) : null}
                </Stack>
                <Typography
                  variant="body2"
                  sx={{ mt: 1, whiteSpace: "pre-wrap" }}
                >
                  {annotation.note}
                </Typography>
              </Paper>
            );
          })}
        </Stack>
      ) : null}
    </Box>
  );
};
