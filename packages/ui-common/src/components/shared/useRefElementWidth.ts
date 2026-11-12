import { useEffect, useState } from "react";

/** Tracks the rendered width of the element behind `ref`, updating on resize. */
export const useRefElementWidth = (
  ref: React.RefObject<HTMLElement | null>,
): number => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};
