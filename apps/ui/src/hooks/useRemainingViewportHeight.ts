import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
} from "react";

export const calculateRemainingViewportHeight = (
  viewportHeight: number,
  elementTop: number,
  bottomInset: number,
): number =>
  Math.max(
    0,
    Math.floor(viewportHeight - Math.max(0, elementTop) - bottomInset),
  );

interface RemainingViewportHeight {
  containerRef: RefCallback<HTMLDivElement>;
  height: number | null;
}

export const useRemainingViewportHeight = (
  enabled: boolean,
  bottomInset: number,
): RemainingViewportHeight => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      return;
    }

    const nextHeight = calculateRemainingViewportHeight(
      window.innerHeight,
      container.getBoundingClientRect().top,
      bottomInset,
    );
    setMeasuredHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, [bottomInset, enabled]);

  const setContainerRef = useCallback<RefCallback<HTMLDivElement>>(
    (container) => {
      containerRef.current = container;
      if (container) {
        measure();
      }
    },
    [measure],
  );

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, measure]);

  return {
    containerRef: setContainerRef,
    height: enabled ? measuredHeight : null,
  };
};
