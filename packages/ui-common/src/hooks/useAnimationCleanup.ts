import { useEffect, useRef } from "react";

/**
 * Hook to ensure proper cleanup of animations when components unmount
 */
export const useAnimationCleanup = () => {
  const animationRefs = useRef<Set<() => void>>(new Set());

  const registerCleanup = (cleanup: () => void) => {
    animationRefs.current.add(cleanup);

    // Return a function to unregister the cleanup
    return () => {
      animationRefs.current.delete(cleanup);
    };
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      animationRefs.current.forEach((cleanup) => cleanup());
      animationRefs.current.clear();
    };
  }, []);

  return { registerCleanup };
};
