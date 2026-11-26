import { useCallback, useLayoutEffect, useState } from "react";

/**
 * The rendered width of an element, kept current as it resizes. Zero until the
 * element is mounted and laid out.
 */
export function useElementWidth(): [
  ref: (element: HTMLElement | null) => void,
  width: number,
] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((next: HTMLElement | null) => setElement(next), []);

  useLayoutEffect(() => {
    if (!element) {
      return;
    }
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}
