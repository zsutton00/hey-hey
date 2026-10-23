import { useCallback, useEffect, useState } from "react";

import {
  DEMO_SCENE_ATTRIBUTE,
  DEMO_TARGET_ATTRIBUTE,
  type MiniDemoTargetId,
} from "./types";

interface SceneTargetPosition {
  x: number;
  y: number;
}

type SceneTargetMeasurementStatus = "waiting" | "ready";

export interface SceneTargetMeasurement {
  sceneId: string | null;
  targetId: MiniDemoTargetId | null;
  status: SceneTargetMeasurementStatus;
  targetCount: number;
  position: SceneTargetPosition | null;
}

export type SceneRefCallback = (element: HTMLDivElement | null) => void;

const SETTLED_LAYOUT_DELAYS_MS = [300, 600] as const;

const waitingMeasurement = (
  sceneId: string | null,
  targetId: MiniDemoTargetId | null,
): SceneTargetMeasurement => ({
  sceneId,
  targetId,
  status: targetId ? "waiting" : "ready",
  targetCount: 0,
  position: null,
});

const measurementsMatch = (
  previous: SceneTargetMeasurement,
  next: SceneTargetMeasurement,
): boolean =>
  previous.sceneId === next.sceneId &&
  previous.targetId === next.targetId &&
  previous.status === next.status &&
  previous.targetCount === next.targetCount &&
  ((previous.position === null && next.position === null) ||
    (previous.position !== null &&
      next.position !== null &&
      Math.abs(previous.position.x - next.position.x) < 1 &&
      Math.abs(previous.position.y - next.position.y) < 1));

const findSceneRoot = (
  root: HTMLDivElement,
  sceneId: string,
): HTMLElement | null => {
  if (
    root.matches(`[${DEMO_SCENE_ATTRIBUTE}]`) &&
    root.getAttribute(DEMO_SCENE_ATTRIBUTE) === sceneId
  ) {
    return root;
  }

  return (
    Array.from(
      root.querySelectorAll<HTMLElement>(`[${DEMO_SCENE_ATTRIBUTE}]`),
    ).find(
      (candidate) => candidate.getAttribute(DEMO_SCENE_ATTRIBUTE) === sceneId,
    ) ?? null
  );
};

const findSceneTargets = (
  sceneRoot: HTMLElement,
  targetId: MiniDemoTargetId,
): HTMLElement[] =>
  Array.from(
    sceneRoot.querySelectorAll<HTMLElement>(`[${DEMO_TARGET_ATTRIBUTE}]`),
  ).filter(
    (candidate) => candidate.getAttribute(DEMO_TARGET_ATTRIBUTE) === targetId,
  );

/**
 * Measures the actual marked control in a scene's natural coordinate space.
 * A target is ready only when the scene marker contains exactly one visible
 * matching target with non-zero geometry.
 */
export const measureSceneTarget = (
  root: HTMLDivElement,
  sceneId: string,
  targetId: MiniDemoTargetId,
  sceneWidth: number,
  sceneHeight: number,
): SceneTargetMeasurement => {
  const sceneRoot = findSceneRoot(root, sceneId);
  if (!sceneRoot) return waitingMeasurement(sceneId, targetId);

  const targets = findSceneTargets(sceneRoot, targetId);

  if (targets.length !== 1) {
    return {
      ...waitingMeasurement(sceneId, targetId),
      targetCount: targets.length,
    };
  }

  const sceneRect = sceneRoot.getBoundingClientRect();
  const targetRect = targets[0].getBoundingClientRect();
  if (
    sceneRect.width <= 0 ||
    sceneRect.height <= 0 ||
    targetRect.width <= 0 ||
    targetRect.height <= 0
  ) {
    return {
      ...waitingMeasurement(sceneId, targetId),
      targetCount: 1,
    };
  }

  return {
    sceneId,
    targetId,
    status: "ready",
    targetCount: 1,
    position: {
      x:
        ((targetRect.left + targetRect.width / 2 - sceneRect.left) /
          sceneRect.width) *
        sceneWidth,
      y:
        ((targetRect.top + targetRect.height / 2 - sceneRect.top) /
          sceneRect.height) *
        sceneHeight,
    },
  };
};

/**
 * Observe the marked scene and target through initial mount, DOM changes,
 * resize changes, and the known post-mount layout settling window.
 */
export const useSceneTargetMeasurement = (
  sceneId: string | null,
  targetId: MiniDemoTargetId | null,
  sceneWidth: number,
  sceneHeight: number,
): [SceneTargetMeasurement, SceneRefCallback] => {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [measurement, setMeasurement] = useState<SceneTargetMeasurement>(() =>
    waitingMeasurement(sceneId, targetId),
  );
  const refCallback = useCallback<SceneRefCallback>((element) => {
    setRoot(element);
  }, []);

  useEffect(() => {
    const initialMeasurement = waitingMeasurement(sceneId, targetId);
    setMeasurement(initialMeasurement);
    if (!root || !sceneId || !targetId) return;

    let cancelled = false;
    let observedTargets: HTMLElement[] = [];
    let resizeObserver: ResizeObserver | null = null;

    const measure = (): void => {
      if (cancelled) return;
      const next = measureSceneTarget(
        root,
        sceneId,
        targetId,
        sceneWidth,
        sceneHeight,
      );
      if (resizeObserver) {
        const sceneRoot = findSceneRoot(root, sceneId);
        const nextTargets = sceneRoot
          ? findSceneTargets(sceneRoot, targetId)
          : [];
        observedTargets.forEach((observedTarget) => {
          if (!nextTargets.includes(observedTarget)) {
            resizeObserver?.unobserve(observedTarget);
          }
        });
        nextTargets.forEach((target) => {
          if (!observedTargets.includes(target)) {
            resizeObserver?.observe(target);
          }
        });
        observedTargets = nextTargets;
      }
      setMeasurement((previous) =>
        measurementsMatch(previous, next) ? previous : next,
      );
    };

    resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());

    measure();
    const observer = new MutationObserver(measure);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    resizeObserver?.observe(root);
    const settleTimers = SETTLED_LAYOUT_DELAYS_MS.map((delay) =>
      window.setTimeout(measure, delay),
    );

    return () => {
      cancelled = true;
      observer.disconnect();
      resizeObserver?.disconnect();
      settleTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [root, sceneHeight, sceneId, sceneWidth, targetId]);

  return [measurement, refCallback];
};
