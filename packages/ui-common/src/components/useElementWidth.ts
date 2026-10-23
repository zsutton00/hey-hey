import { useEffect, useRef, useState } from "react";

/**
 * Hook to measure and track an element's width, updating on resize
 */
export const useElementWidth = <T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number | null
] => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = () => {
      setWidth(element.offsetWidth);
    };

    // Set initial width
    updateWidth();

    // Create ResizeObserver to track width changes
    const resizeObserver = new ResizeObserver(() => {
      updateWidth();
    });

    resizeObserver.observe(element);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return [ref, width];
};
