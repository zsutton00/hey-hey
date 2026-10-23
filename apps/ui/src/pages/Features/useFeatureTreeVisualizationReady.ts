import { useCallback, useLayoutEffect, useState, type RefCallback } from "react";

const READY_SELECTOR = '[data-testid="feature-tree-ready"]';

interface FeatureTreeVisualizationReadyState {
  hostRef: RefCallback<HTMLDivElement>;
  isReady: boolean;
}

/**
 * Latches readiness only after FeatureTreeVisualization mounts its ready
 * presentation. The visualization has additional required reads beyond the
 * shared feature-list query, so the page cannot infer this boundary from
 * useFeatureTree alone.
 */
export const useFeatureTreeVisualizationReady = (
  readinessKey: string,
): FeatureTreeVisualizationReadyState => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const hostRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setHost(node);
  }, []);

  useLayoutEffect(() => {
    if (!host) return;

    let observer: MutationObserver | null = null;
    const latchReadyPresentation = (): boolean => {
      if (!host.querySelector(READY_SELECTOR)) return false;

      setReadyKey(readinessKey);
      observer?.disconnect();
      return true;
    };

    if (latchReadyPresentation()) return;

    observer = new MutationObserver(() => {
      latchReadyPresentation();
    });
    observer.observe(host, {
      attributeFilter: ["data-testid"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => observer?.disconnect();
  }, [host, readinessKey]);

  return {
    hostRef,
    isReady: readyKey === readinessKey,
  };
};
