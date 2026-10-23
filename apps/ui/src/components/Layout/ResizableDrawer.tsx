import React, { useState, useCallback, useEffect, useRef } from "react";
import { Drawer, Box } from "@mui/material";
import { LAYOUT_CONSTANTS, LAYOUT_CSS } from "../../constants/layout";

interface ResizableDrawerProps {
  children: (props: { width: number; isMinimal: boolean }) => React.ReactNode;
}

/**
 * Resizable drawer component with hover-only resize handle
 * Switches to minimal icon-only mode when width is below threshold
 */
export const ResizableDrawer: React.FC<ResizableDrawerProps> = ({ children }) => {
  // Load width from localStorage, default to standard width
  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem("explorer_drawer_width");
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          return Math.max(
            LAYOUT_CONSTANTS.DRAWER_MIN_WIDTH,
            Math.min(LAYOUT_CONSTANTS.DRAWER_MAX_WIDTH, parsed)
          );
        }
      }
    } catch (error) {
      console.error("Failed to load drawer width from localStorage:", error);
    }
    return LAYOUT_CONSTANTS.DRAWER_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const [showHandle, setShowHandle] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Determine if in minimal mode
  const isMinimal = width < LAYOUT_CONSTANTS.DRAWER_MINIMAL_THRESHOLD;

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
  }, [width]);

  // Handle mouse move during resize
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = event.clientX - startXRef.current;
    const newWidth = startWidthRef.current + deltaX;

    const clampedWidth = Math.max(
      LAYOUT_CONSTANTS.DRAWER_MIN_WIDTH,
      Math.min(LAYOUT_CONSTANTS.DRAWER_MAX_WIDTH, newWidth)
    );

    setWidth(clampedWidth);
  }, [isResizing]);

  // Handle mouse up to end resize
  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      // Save to localStorage
      try {
        localStorage.setItem("explorer_drawer_width", String(width));
      } catch (error) {
        console.error("Failed to save drawer width to localStorage:", error);
      }
    }
  }, [isResizing, width]);

  // Add/remove global mouse event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: `${width}px`,
        flexShrink: 0,
        transition: isResizing ? "none" : "width 0.2s ease",
        [`& .MuiDrawer-paper`]: {
          width: `${width}px`,
          boxSizing: "border-box",
          top: LAYOUT_CSS.DRAWER_TOP_OFFSET,
          height: LAYOUT_CSS.DRAWER_HEIGHT,
          borderRight: "1px solid",
          borderColor: "divider",
          borderRadius: 0,
          overflow: "hidden",
          transition: isResizing ? "none" : "width 0.2s ease",
        },
      }}
      onMouseEnter={() => setShowHandle(true)}
      onMouseLeave={() => !isResizing && setShowHandle(false)}
    >
      {children({ width, isMinimal })}

      {/* Resize Handle - Only visible on hover */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: "ew-resize",
          opacity: showHandle || isResizing ? 1 : 0,
          transition: "opacity 0.2s ease",
          backgroundColor: isResizing ? "primary.main" : "transparent",
          "&:hover": {
            backgroundColor: "primary.main",
          },
          zIndex: 1000,
        }}
      />
    </Drawer>
  );
};
