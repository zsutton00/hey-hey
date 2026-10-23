import { useState, useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

interface TouchState {
  startY: number;
  currentY: number;
  isScrolling: boolean;
  startTime: number;
  velocity: number;
}

// Simple state - just the global scroll position
interface ScrollState {
  globalScrollPosition: number; // 0 to totalScrollSpace
  panelHeight: number;
  containerHeight: number;
  isTransitioning: boolean;
  contentSet: number;
  totalContentSets: number;
  lastFrameTime: number;
  isOptimizedMode: boolean;
  velocity: number; // Current scroll velocity for momentum
  isDecelerating: boolean; // Whether momentum deceleration is active
}

// Visual state calculated from scroll position
interface VisualState {
  activeColumn: "left" | "center" | "right";
  panelPositions: {
    left: number;
    center: number;
    right: number;
  };
  scrollWithinActiveColumn: number;
  activeRow: number; // 0, 1, or 2 for the three rows
}

const PANELS_PER_COLUMN = 3;
const TOTAL_COLUMNS = 3;
const COLUMN_SEQUENCE: ("left" | "center" | "right")[] = [
  "left",
  "center",
  "right",
];

const initialState: ScrollState = {
  globalScrollPosition: 0,
  panelHeight: 0,
  containerHeight: 0,
  isTransitioning: false,
  contentSet: 0,
  totalContentSets: 2,
  lastFrameTime: performance.now(),
  isOptimizedMode: false,
  velocity: 0,
  isDecelerating: false,
};

const initialTouchState: TouchState = {
  startY: 0,
  currentY: 0,
  isScrolling: false,
  startTime: 0,
  velocity: 0,
};

// Pure function: globalScrollPosition → visual state
export function calculateVisualState(
  globalScrollPosition: number,
  panelHeight: number
): VisualState {
  if (panelHeight === 0) {
    return {
      activeColumn: "left",
      panelPositions: { left: 0, center: 0, right: 0 },
      scrollWithinActiveColumn: 0,
      activeRow: 0,
    };
  }

  // Cap totalPanelsScrolled to the maximum number of panels available
  // Note: Each column can only scroll (PANELS_PER_COLUMN - 1) * panelHeight
  // because when you've scrolled 2 panels, the 3rd panel is at the top
  const maxScrollablePanels = (PANELS_PER_COLUMN - 1) * TOTAL_COLUMNS; // 2 * 3 = 6 scrollable panels
  const uncappedPanelsScrolled = Math.floor(globalScrollPosition / panelHeight);
  const totalPanelsScrolled = Math.min(
    uncappedPanelsScrolled,
    maxScrollablePanels - 1
  );
  const currentColumnIndex = totalPanelsScrolled % TOTAL_COLUMNS;
  const scrollWithinActiveColumn =
    globalScrollPosition - totalPanelsScrolled * panelHeight;

  const panelPositions = {
    left: Math.min(
      Math.floor(totalPanelsScrolled / TOTAL_COLUMNS) +
        (totalPanelsScrolled % TOTAL_COLUMNS > 0 ? 1 : 0),
      PANELS_PER_COLUMN - 1
    ),
    center: Math.min(
      Math.floor(totalPanelsScrolled / TOTAL_COLUMNS) +
        (totalPanelsScrolled % TOTAL_COLUMNS > 1 ? 1 : 0),
      PANELS_PER_COLUMN - 1
    ),
    right: Math.min(
      Math.floor(totalPanelsScrolled / TOTAL_COLUMNS) +
        (totalPanelsScrolled % TOTAL_COLUMNS > 2 ? 1 : 0),
      PANELS_PER_COLUMN - 1
    ),
  };

  // Calculate activeRow based on panel positions
  // Row 0: All panels at position 0 (first screens)
  // Row 1: At least one panel at position 1 (second screens)
  // Row 2: At least one panel at position 2 (third screens)
  const maxPanelPosition = Math.max(
    panelPositions.left,
    panelPositions.center,
    panelPositions.right
  );
  const activeRow = Math.min(maxPanelPosition, 2); // Cap at 2 for three rows (0, 1, 2)

  const result = {
    activeColumn: COLUMN_SEQUENCE[currentColumnIndex],
    panelPositions,
    scrollWithinActiveColumn,
    activeRow,
  };

  return result;
}

export const useColumnScroll = (
  enableScrolling: boolean = true,
  touchOptimized: boolean = false
) => {
  const [scrollState, setScrollState] = useState<ScrollState>(initialState);
  const [touchState, setTouchState] = useState<TouchState>(initialTouchState);
  const reducedMotion = useReducedMotion();
  const touchRef = useRef<TouchState>(initialTouchState);
  const containerRef = useRef<HTMLElement | null>(null);

  // Calculate panel dimensions
  const calculateDimensions = useCallback(() => {
    const container = document.querySelector(
      "[data-column-scroll-container]"
    ) as HTMLElement;
    if (container) {
      containerRef.current = container;
      const containerHeight = container.offsetHeight;
      const panelHeight = containerHeight / PANELS_PER_COLUMN;

      setScrollState((prev) => ({
        ...prev,
        containerHeight,
        panelHeight,
      }));
    }
  }, []);

  // Calculate dimensions on mount and resize
  useEffect(() => {
    calculateDimensions();
    const handleResize = () => calculateDimensions();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [calculateDimensions]);

  // Calculate total scroll space
  // Each column can only scroll (PANELS_PER_COLUMN - 1) panels before the last panel is at the top
  const totalScrollSpace =
    scrollState.panelHeight * (PANELS_PER_COLUMN - 1) * TOTAL_COLUMNS;

  // Core scroll processing with momentum
  const processScroll = useCallback(
    (delta: number, applyMomentum: boolean = true) => {
      setScrollState((prev) => {
        if (prev.panelHeight === 0) return prev;

        const scrollSpeed = reducedMotion ? 6.3 : 28;
        const adjustedDelta = Math.sign(delta) * scrollSpeed;
        const newGlobalPosition = prev.globalScrollPosition + adjustedDelta;

        // Clamp to boundaries
        const clampedPosition = Math.max(
          0,
          Math.min(newGlobalPosition, totalScrollSpace)
        );

        console.log(
          `🎯 SCROLL: globalPos ${prev.globalScrollPosition}px → ${clampedPosition}px (total: ${totalScrollSpace}px)`
        );

        // Calculate visual state for logging
        const visualState = calculateVisualState(
          clampedPosition,
          prev.panelHeight
        );
        console.log(
          `   Visual: ${visualState.activeColumn} column, panels [L:${
            visualState.panelPositions.left
          }, C:${visualState.panelPositions.center}, R:${
            visualState.panelPositions.right
          }], progress: ${visualState.scrollWithinActiveColumn.toFixed(1)}px`
        );

        // Update velocity for momentum (only if not already decelerating)
        const newVelocity =
          applyMomentum && !prev.isDecelerating
            ? adjustedDelta * 0.3 // Reduced from 0.8 to 0.3 for lighter momentum
            : prev.velocity;

        return {
          ...prev,
          globalScrollPosition: clampedPosition,
          velocity: newVelocity,
          lastFrameTime: performance.now(),
        };
      });
    },
    [reducedMotion, totalScrollSpace]
  );

  // Momentum animation loop
  const momentumAnimationRef = useRef<number | null>(null);
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startMomentumScroll = useCallback(() => {
    if (momentumAnimationRef.current) {
      cancelAnimationFrame(momentumAnimationRef.current);
    }

    const animate = () => {
      setScrollState((prev) => {
        // If velocity is too small, stop momentum
        if (Math.abs(prev.velocity) < 1.0 || prev.panelHeight === 0) {
          // Increased threshold from 0.5 to 1.0
          return {
            ...prev,
            velocity: 0,
            isDecelerating: false,
          };
        }

        // Apply momentum
        const newGlobalPosition = prev.globalScrollPosition + prev.velocity;
        const clampedPosition = Math.max(
          0,
          Math.min(newGlobalPosition, totalScrollSpace)
        );

        // Decelerate velocity with stronger friction
        const friction = 0.88; // Increased friction from 0.95 to 0.88 for faster deceleration
        const newVelocity = prev.velocity * friction;

        // If we hit boundaries, stop momentum
        const hitBoundary = newGlobalPosition !== clampedPosition;

        if (hitBoundary || Math.abs(newVelocity) < 1.0) {
          // Increased threshold from 0.5 to 1.0
          return {
            ...prev,
            globalScrollPosition: clampedPosition,
            velocity: 0,
            isDecelerating: false,
          };
        }

        return {
          ...prev,
          globalScrollPosition: clampedPosition,
          velocity: newVelocity,
          isDecelerating: true,
        };
      });

      // Continue animation if we have velocity
      setScrollState((current) => {
        if (Math.abs(current.velocity) >= 1.0) {
          // Increased threshold from 0.5 to 1.0
          momentumAnimationRef.current = requestAnimationFrame(animate);
        } else {
          momentumAnimationRef.current = null;
        }
        return current;
      });
    };

    momentumAnimationRef.current = requestAnimationFrame(animate);
  }, [totalScrollSpace]);

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
      }
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!enableScrolling) return;

      const delta = event.deltaY;
      if (Math.abs(delta) < 1) return;

      // Get current page scroll position
      const pageScrollY = window.scrollY || document.documentElement.scrollTop;

      // Check if we're at the end of column scrolling and trying to scroll down
      const isAtEnd = scrollState.globalScrollPosition >= totalScrollSpace;
      const isScrollingDown = delta > 0;

      // If we're at the end and scrolling down, allow normal page scroll
      if (isAtEnd && isScrollingDown) {
        return; // Don't prevent default, allow normal page scroll
      }

      // Check if we're at the beginning and trying to scroll up
      const isAtBeginning = scrollState.globalScrollPosition <= 0;
      const isScrollingUp = delta < 0;

      // If we're at the beginning and scrolling up, allow normal page scroll
      if (isAtBeginning && isScrollingUp) {
        return; // Don't prevent default, allow normal page scroll
      }

      // Check if we're scrolling up from footer back to columns
      // If page has scrolled down (footer is visible) and user scrolls up,
      // we need to handle the transition back to column scrolling
      if (pageScrollY > 0 && isScrollingUp) {
        // If we're not at the end of column scroll, capture the scroll
        if (!isAtEnd) {
          event.preventDefault();
          event.stopPropagation();
          processScroll(delta * 0.7);
          return;
        }
        // If we are at the end, let page scroll up naturally until it reaches top
        // Then column scrolling will take over again
        return;
      }

      // Otherwise, use column scrolling
      event.preventDefault();
      event.stopPropagation();

      // Stop any existing momentum
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
        momentumAnimationRef.current = null;
      }

      // Clear any existing wheel timeout
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }

      // Reset deceleration state and process scroll
      setScrollState((prev) => ({ ...prev, isDecelerating: false }));
      processScroll(delta * 0.7);

      // Start momentum when wheel events stop
      wheelTimeoutRef.current = setTimeout(() => {
        startMomentumScroll();
      }, 100);
    },
    [
      processScroll,
      enableScrolling,
      scrollState.globalScrollPosition,
      totalScrollSpace,
      startMomentumScroll,
    ]
  );

  // Touch event handlers
  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (!enableScrolling || !touchOptimized) return;

      const touch = event.touches[0];
      const newTouchState = {
        startY: touch.clientY,
        currentY: touch.clientY,
        isScrolling: true,
        startTime: performance.now(),
        velocity: 0,
      };

      setTouchState(newTouchState);
      touchRef.current = newTouchState;
    },
    [enableScrolling, touchOptimized]
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (!enableScrolling || !touchOptimized || !touchRef.current.isScrolling)
        return;

      const touch = event.touches[0];
      const currentTime = performance.now();
      const deltaY = touchRef.current.startY - touch.clientY;
      const deltaTime = currentTime - touchRef.current.startTime;

      const velocity = Math.abs(deltaY) / Math.max(deltaTime, 1);

      if (touchOptimized) {
        event.preventDefault();
      }

      const newTouchState = {
        ...touchRef.current,
        currentY: touch.clientY,
        velocity,
      };

      setTouchState(newTouchState);
      touchRef.current = newTouchState;

      processScroll(deltaY * 0.42);
    },
    [enableScrolling, touchOptimized, processScroll]
  );

  const handleTouchEnd = useCallback(() => {
    if (!enableScrolling || !touchOptimized) return;

    const finalTouchState = {
      ...touchRef.current,
      isScrolling: false,
    };

    setTouchState(finalTouchState);
    touchRef.current = finalTouchState;
  }, [enableScrolling, touchOptimized]);

  // Keyboard navigation
  const handleKeydown = useCallback(
    (event: KeyboardEvent) => {
      const keyActions: Record<string, () => void> = {
        ArrowDown: () => processScroll(28),
        ArrowUp: () => processScroll(-28),
        Space: () => {
          event.preventDefault();
          processScroll(35);
        },
        Home: () => {
          setScrollState((prev) => ({
            ...prev,
            globalScrollPosition: 0,
          }));
        },
        End: () => {
          setScrollState((prev) => ({
            ...prev,
            globalScrollPosition: totalScrollSpace,
          }));
        },
      };

      keyActions[event.key]?.();
    },
    [processScroll, totalScrollSpace]
  );

  // Set up event listeners
  useEffect(() => {
    if (!enableScrolling) return;

    window.addEventListener("wheel", handleWheel as unknown as EventListener, {
      passive: false,
    });

    if (touchOptimized) {
      window.addEventListener(
        "touchstart",
        handleTouchStart as unknown as EventListener,
        {
          passive: false,
        }
      );
      window.addEventListener(
        "touchmove",
        handleTouchMove as unknown as EventListener,
        {
          passive: false,
        }
      );
      window.addEventListener(
        "touchend",
        handleTouchEnd as unknown as EventListener,
        {
          passive: true,
        }
      );
    }

    document.addEventListener(
      "keydown",
      handleKeydown as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "wheel",
        handleWheel as unknown as EventListener
      );
      if (touchOptimized) {
        window.removeEventListener(
          "touchstart",
          handleTouchStart as unknown as EventListener
        );
        window.removeEventListener(
          "touchmove",
          handleTouchMove as unknown as EventListener
        );
        window.removeEventListener(
          "touchend",
          handleTouchEnd as unknown as EventListener
        );
      }
      document.removeEventListener(
        "keydown",
        handleKeydown as unknown as EventListener
      );
    };
  }, [
    handleWheel,
    handleKeydown,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    touchOptimized,
    enableScrolling,
  ]);

  // Reset transition state
  useEffect(() => {
    if (scrollState.isTransitioning) {
      const timeout = setTimeout(() => {
        setScrollState((prev) => ({
          ...prev,
          isTransitioning: false,
        }));
      }, 300);

      return () => clearTimeout(timeout);
    }
  }, [scrollState.isTransitioning]);

  // Calculate visual state from global position
  const visualState = calculateVisualState(
    scrollState.globalScrollPosition,
    scrollState.panelHeight
  );

  // Return combined state with visual calculations
  return {
    scrollState: {
      ...scrollState,
      // Add calculated visual state
      activeColumn: visualState.activeColumn,
      activeRow: visualState.activeRow,
      panelPositions: visualState.panelPositions,
      panelProgress: {
        [visualState.activeColumn]: visualState.scrollWithinActiveColumn,
        // Non-active columns have 0 progress
        left:
          visualState.activeColumn === "left"
            ? visualState.scrollWithinActiveColumn
            : 0,
        center:
          visualState.activeColumn === "center"
            ? visualState.scrollWithinActiveColumn
            : 0,
        right:
          visualState.activeColumn === "right"
            ? visualState.scrollWithinActiveColumn
            : 0,
      },
    },
    touchState,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    processScroll,
  };
};
