import { useState, useEffect } from "react";

/**
 * Hook to detect user's motion preferences
 * Returns true if user prefers reduced motion
 */
export const useReducedMotion = (): boolean => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    // Add listener
    mediaQuery.addEventListener("change", handleChange);

    // Cleanup
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return prefersReducedMotion;
};

/**
 * Hook that returns animation-safe values based on motion preferences
 */
export const useAnimationConfig = () => {
  const prefersReducedMotion = useReducedMotion();

  return {
    prefersReducedMotion,
    duration: prefersReducedMotion ? 0 : undefined,
    scale: prefersReducedMotion ? 1 : undefined,
    y: prefersReducedMotion ? 0 : undefined,
    x: prefersReducedMotion ? 0 : undefined,
    opacity: 1, // Always animate opacity as it's generally safe
  };
};
