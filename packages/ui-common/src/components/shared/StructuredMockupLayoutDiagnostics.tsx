import { Box, SvgIcon, Typography } from "@mui/material";
import { createUsePuck, type ComponentData } from "@puckeditor/core";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import {
  resolveStructuredMockupLayout,
  resolveStructuredMockupContainerLayout,
  structuredMockupPuckConfig,
  type EffectiveStructuredMockupLayout,
  type StructuredMockupAlignment,
  type StructuredMockupJustification,
  type StructuredMockupContainerEditorProps,
  type StructuredMockupDirection,
  type StructuredMockupLayoutProps,
} from "./structuredMockupPuck";

const useStructuredMockupPuck =
  createUsePuck<typeof structuredMockupPuckConfig>();

export interface LayoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DiagnosticPlacement {
  left: number;
  top: number;
}

export interface ParentLayoutMetadata {
  dimensions: string;
  direction: StructuredMockupDirection;
  justification: StructuredMockupJustification;
  alignment: StructuredMockupAlignment;
  padding: number;
  gap: number;
}

interface DiagnosticSnapshot {
  selected: {
    bounds: LayoutBounds;
    sizing: string;
  };
  parent?: ParentLayoutMetadata & { bounds: LayoutBounds };
}

const LABEL_WIDTH = 196;

export const formatStructuredMockupSizingTuple = (
  layout: StructuredMockupLayoutProps
): string => {
  const resolved = resolveStructuredMockupLayout(layout);
  const format = (
    sizing:
      | EffectiveStructuredMockupLayout["width"]
      | EffectiveStructuredMockupLayout["height"]
  ): string =>
    sizing.mode === "fixed" ? `fixed ${sizing.value}px` : sizing.mode;
  return `(${format(resolved.width)}, ${format(resolved.height)})`;
};

export const getParentLayoutMetadata = (
  props: Pick<
    StructuredMockupContainerEditorProps,
    "direction" | "justify" | "align" | "padding" | "gap"
  >,
  bounds: LayoutBounds
): ParentLayoutMetadata => {
  const layout = resolveStructuredMockupContainerLayout(props);
  return {
    dimensions: `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`,
    direction: layout.direction,
    justification: layout.justification,
    alignment: layout.alignment,
    padding: layout.padding,
    gap: layout.gap,
  };
};

export const getAlignmentGuideAxis = (
  direction: StructuredMockupDirection
): "horizontal" | "vertical" =>
  direction === "row" ? "horizontal" : "vertical";

export const placeDiagnosticBadge = ({
  anchor,
  corner,
}: {
  anchor: LayoutBounds;
  corner: "top-right" | "bottom-right";
}): DiagnosticPlacement => ({
  left: anchor.left + anchor.width,
  top: corner === "top-right" ? anchor.top : anchor.top + anchor.height,
});

const relativeBounds = (
  element: HTMLElement,
  canvas: HTMLElement
): LayoutBounds => {
  const elementRect = element.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    left: elementRect.left - canvasRect.left,
    top: elementRect.top - canvasRect.top,
    width: elementRect.width,
    height: elementRect.height,
  };
};

const findRenderedComponent = (
  canvas: HTMLElement,
  componentId: string
): HTMLElement | null => {
  const escaped =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(componentId)
      : componentId.replace(/["\\]/g, "\\$&");
  return canvas.querySelector<HTMLElement>(
    `[data-structured-mockup-component-id="${escaped}"], [data-puck-component="${escaped}"]`
  );
};

const isStructuredMockupContainer = (
  item: ComponentData
): item is ComponentData<
  StructuredMockupContainerEditorProps,
  "row" | "column"
> =>
  (item.type === "row" || item.type === "column") &&
  (item.props.direction === "row" || item.props.direction === "column") &&
  ["start", "center", "end", "spread"].includes(item.props.justify) &&
  ["start", "center", "end", "stretch"].includes(item.props.align) &&
  typeof item.props.padding === "number" &&
  typeof item.props.gap === "number";

const labelSx = {
  position: "absolute",
  width: LABEL_WIDTH,
  color: "primary.main",
  lineHeight: 1.2,
  whiteSpace: "nowrap",
  textShadow: "0 1px 1px rgba(255, 255, 255, 0.9)",
} as const;

const DirectionIcon: React.FC<{ direction: StructuredMockupDirection }> = ({
  direction,
}) => (
  <SvgIcon
    data-testid={`structured-mockup-direction-${direction}`}
    sx={{ fontSize: "1em", verticalAlign: "-0.125em" }}
  >
    <path d="M0 0h24v24H0z" fill="none" />
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="18" x="2" y="3" rx="2" />
      <path d={direction === "row" ? "M12 3v18" : "M22 12H2"} />
    </g>
  </SvgIcon>
);

const AlignmentGuide: React.FC<{
  bounds: LayoutBounds;
  direction: StructuredMockupDirection;
  justification: StructuredMockupJustification;
}> = ({ bounds, direction, justification }) => {
  const horizontal = getAlignmentGuideAxis(direction) === "horizontal";
  const spread = justification === "spread";
  const position =
    justification === "start" ? 0 : justification === "end" ? 1 : 0.5;
  return (
    <Box
      data-testid="structured-mockup-alignment-guide"
      data-axis={horizontal ? "horizontal" : "vertical"}
      data-justification={justification}
      sx={{
        position: "absolute",
        borderColor: "primary.main",
        opacity: 0.3,
        ...(spread
          ? {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              borderStyle: "solid",
              borderWidth: horizontal ? "0 1px" : "1px 0",
            }
          : horizontal
          ? {
              left: bounds.left,
              top: bounds.top + bounds.height * position,
              width: bounds.width,
              borderTopWidth: 1,
              borderTopStyle: "solid",
            }
          : {
              left: bounds.left + bounds.width * position,
              top: bounds.top,
              height: bounds.height,
              borderLeftWidth: 1,
              borderLeftStyle: "solid",
            }),
      }}
    />
  );
};

export const StructuredMockupLayoutDiagnostics: React.FC<{
  canvasRef: React.RefObject<HTMLElement | null>;
  presentationKey: string;
}> = ({ canvasRef, presentationKey }) => {
  const selectedItem = useStructuredMockupPuck((state) => state.selectedItem);
  const parentItem = useStructuredMockupPuck((state) => {
    if (!selectedItem) return undefined;
    return state.getParentById(selectedItem.props.id);
  });
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [isParentHovered, setIsParentHovered] = useState(false);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedItem) {
      setSnapshot(null);
      return;
    }
    const selectedElement = findRenderedComponent(
      canvas,
      selectedItem.props.id
    );
    if (!selectedElement) {
      setSnapshot(null);
      return;
    }
    const selected = {
      bounds: relativeBounds(selectedElement, canvas),
      sizing: formatStructuredMockupSizingTuple(selectedItem.props),
    };
    if (!parentItem || !isStructuredMockupContainer(parentItem)) {
      setSnapshot({ selected });
      return;
    }
    const parentElement = findRenderedComponent(canvas, parentItem.props.id);
    if (!parentElement) {
      setSnapshot({ selected });
      return;
    }
    const bounds = relativeBounds(parentElement, canvas);
    setSnapshot({
      selected,
      parent: {
        bounds,
        ...getParentLayoutMetadata(parentItem.props, bounds),
      },
    });
  }, [canvasRef, parentItem, selectedItem]);

  useLayoutEffect(measure, [measure, presentationKey]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parentItem) {
      setIsParentHovered(false);
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const hoveredComponent =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-puck-component]")
          : null;
      setIsParentHovered(
        hoveredComponent?.dataset.puckComponent === parentItem.props.id
      );
    };
    const handleMouseLeave = () => setIsParentHovered(false);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [canvasRef, parentItem]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedItem) return;
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(canvas);
    const selectedElement = findRenderedComponent(
      canvas,
      selectedItem.props.id
    );
    if (selectedElement) resizeObserver?.observe(selectedElement);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    const preview = canvas.querySelector("[data-puck-preview]");
    if (preview) {
      mutationObserver.observe(preview, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    const scrollport = canvas.parentElement;
    window.addEventListener("resize", scheduleMeasure);
    scrollport?.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      scrollport?.removeEventListener("scroll", scheduleMeasure);
    };
  }, [canvasRef, measure, selectedItem]);

  if (!snapshot) return null;
  const parentPlacement = snapshot.parent
    ? placeDiagnosticBadge({
        anchor: snapshot.parent.bounds,
        corner: "top-right",
      })
    : undefined;
  const selectedPlacement = placeDiagnosticBadge({
    anchor: snapshot.selected.bounds,
    corner: "bottom-right",
  });

  return (
    <Box
      data-testid="structured-mockup-layout-diagnostics"
      data-parent-type={parentItem?.type}
      aria-hidden="true"
      sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
    >
      {snapshot.parent && parentPlacement ? (
        <>
          {isParentHovered ? (
            <AlignmentGuide
              bounds={snapshot.parent.bounds}
              direction={snapshot.parent.direction}
              justification={snapshot.parent.justification}
            />
          ) : null}
          <Box
            data-testid="structured-mockup-parent-layout-diagnostic"
            data-presentation="inline-text"
            sx={{
              ...labelSx,
              left: parentPlacement.left,
              top: parentPlacement.top,
              transform: "translateY(-100%)",
              color: "text.secondary",
              opacity: 0.65,
            }}
          >
            <Typography component="div" sx={{ fontSize: 10, lineHeight: 1.2 }}>
              {snapshot.parent.dimensions} ·{" "}
              <DirectionIcon direction={snapshot.parent.direction} />
              {` · justify ${snapshot.parent.justification} · align ${snapshot.parent.alignment}`}
            </Typography>
          </Box>
        </>
      ) : null}
      <Box
        data-testid="structured-mockup-selected-layout-diagnostic"
        data-presentation="inline-text"
        sx={{
          ...labelSx,
          left: selectedPlacement.left,
          top: selectedPlacement.top,
        }}
      >
        <Typography component="div" variant="caption" fontWeight={700}>
          {snapshot.selected.sizing}
        </Typography>
      </Box>
    </Box>
  );
};
