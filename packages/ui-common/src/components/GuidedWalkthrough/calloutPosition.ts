import type { CalloutPlacement } from "./GuidedWalkthroughRunner";

export const CALLOUT_WIDTH = 300;
/** Room a callout needs above/below its target before it flips. */
const CALLOUT_CLEARANCE = 140;
const GAP = 12;
const MARGIN = 8;

export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface CalloutPosition {
  placement: CalloutPlacement;
  top: number;
  left: number;
  /** CSS transform anchoring the callout edge at (left, top). */
  transform: string;
}

function resolvePlacement(
  preferred: CalloutPlacement,
  rect: TargetRect,
  viewport: Viewport
): CalloutPlacement {
  const roomRight = viewport.width - (rect.left + rect.width);
  const roomAbove = rect.top;
  const roomBelow = viewport.height - (rect.top + rect.height);
  switch (preferred) {
    case "right":
      if (roomRight >= CALLOUT_WIDTH + GAP + MARGIN) return "right";
      return roomBelow >= CALLOUT_CLEARANCE ? "bottom" : "top";
    case "top":
      return roomAbove >= CALLOUT_CLEARANCE ? "top" : "bottom";
    case "bottom":
      return roomBelow >= CALLOUT_CLEARANCE ? "bottom" : "top";
  }
}

function clampCentre(centre: number, viewport: Viewport): number {
  const half = CALLOUT_WIDTH / 2;
  return Math.min(
    Math.max(centre, half + MARGIN),
    Math.max(half + MARGIN, viewport.width - half - MARGIN)
  );
}

/**
 * Anchors a fixed-position callout beside its target, flipping when the
 * preferred side lacks room and keeping it inside the viewport horizontally.
 */
export function computeCalloutPosition(
  preferred: CalloutPlacement,
  rect: TargetRect,
  viewport: Viewport
): CalloutPosition {
  const placement = resolvePlacement(preferred, rect, viewport);
  const centreX = clampCentre(rect.left + rect.width / 2, viewport);
  switch (placement) {
    case "right":
      return {
        placement,
        top: Math.max(MARGIN, rect.top + rect.height / 2),
        left: rect.left + rect.width + GAP,
        transform: "translateY(-50%)",
      };
    case "top":
      return {
        placement,
        top: rect.top - GAP,
        left: centreX,
        transform: "translate(-50%, -100%)",
      };
    case "bottom":
      return {
        placement,
        top: rect.top + rect.height + GAP,
        left: centreX,
        transform: "translateX(-50%)",
      };
  }
}
