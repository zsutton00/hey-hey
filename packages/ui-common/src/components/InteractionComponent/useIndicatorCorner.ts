import type React from "react";
import { useEffect, useRef, useState } from "react";

export type IndicatorCorner =
  | "bottom-left"
  | "top-left"
  | "top-right"
  | "bottom-right";

/** Priority order: prefer bottom-left, fall back clockwise. */
export const CORNER_PRIORITY: IndicatorCorner[] = [
  "bottom-left",
  "top-left",
  "top-right",
  "bottom-right",
];

/** Absolute-position offsets for each corner (in px). */
export const CORNER_POSITIONS: Record<
  IndicatorCorner,
  { top?: number; bottom?: number; left?: number; right?: number }
> = {
  "bottom-left": { bottom: 6, left: 6 },
  "top-left": { top: 6, left: 6 },
  "top-right": { top: 6, right: 6 },
  "bottom-right": { bottom: 6, right: 6 },
};

export interface UseIndicatorCornerResult {
  activeCorner: IndicatorCorner | null;
  probeRefs: Record<IndicatorCorner, React.RefObject<HTMLSpanElement | null>>;
}

/**
 * Tracks which corner of a `position:relative` container is currently
 * visible in the viewport using four tiny probe elements (one per corner)
 * observed by a single IntersectionObserver. Returns the highest-priority
 * visible corner, or `null` before the first observation fires (indicator
 * stays hidden to avoid a positional flash on mount).
 *
 * The caller must render four probe `<span>` elements inside the container
 * and attach the returned refs to them.
 */
export function useIndicatorCorner(enabled: boolean): UseIndicatorCornerResult {
  const probeBottomLeft = useRef<HTMLSpanElement>(null);
  const probeTopLeft = useRef<HTMLSpanElement>(null);
  const probeTopRight = useRef<HTMLSpanElement>(null);
  const probeBottomRight = useRef<HTMLSpanElement>(null);

  const probeRefs: Record<
    IndicatorCorner,
    React.RefObject<HTMLSpanElement | null>
  > = {
    "bottom-left": probeBottomLeft,
    "top-left": probeTopLeft,
    "top-right": probeTopRight,
    "bottom-right": probeBottomRight,
  };

  const [activeCorner, setActiveCorner] = useState<IndicatorCorner | null>(
    null
  );

  useEffect(() => {
    if (!enabled) return;

    const visible = new Map<IndicatorCorner, boolean>(
      CORNER_PRIORITY.map((c) => [c, false])
    );

    const elementToCorner = new Map<Element, IndicatorCorner>();
    CORNER_PRIORITY.forEach((corner) => {
      const el = probeRefs[corner].current;
      if (el) elementToCorner.set(el, corner);
    });

    const pick = () =>
      setActiveCorner(CORNER_PRIORITY.find((c) => visible.get(c)) ?? null);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const corner = elementToCorner.get(entry.target);
          if (corner !== undefined) visible.set(corner, entry.isIntersecting);
        });
        pick();
      },
      { threshold: 0 }
    );

    elementToCorner.forEach((_, el) => observer.observe(el));

    return () => observer.disconnect();
    // Probe refs are stable (useRef) — only re-run when enabled changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { activeCorner, probeRefs };
}
