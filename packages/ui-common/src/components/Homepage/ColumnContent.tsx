import React from "react";
import { Box } from "@mui/material";
import ScrollHint from "./ScrollHint";

interface ColumnContentProps {
  isActive: boolean;
  panelIndex: number;
  panelProgress: number; // Progress within current panel (pixels)
  totalPanels: number;
  children: React.ReactNode;
  column: "left" | "center" | "right";
  isTransitioning?: boolean;
  panelHeight?: number; // Panel height for percentage conversion
}

const ColumnContent: React.FC<ColumnContentProps> = ({
  isActive,
  panelIndex,
  panelProgress,
  totalPanels,
  children,
  column,
  isTransitioning = false,
  panelHeight = 0,
}) => {
  // Simple, clean offset calculation
  // Panel 0 = 0%, Panel 1 = 33.33%, Panel 2 = 66.66%
  const baseOffset = panelIndex * 33.33;

  // Convert panel progress (pixels) to percentage for smooth scrolling
  const progressPercent =
    panelHeight > 0 ? (panelProgress / panelHeight) * 33.33 : 0;
  const totalOffset = baseOffset + progressPercent;
  const scrollOffset = `${-totalOffset}%`;

  // Debug logging for active column
  if (isActive) {
    console.log(
      `Column ${column} - Panel: ${
        panelIndex + 1
      }/${totalPanels}, Progress: ${panelProgress.toFixed(
        1
      )}px, Offset: ${scrollOffset}`
    );
  }

  // All columns maintain same opacity and scale
  const opacity = 1;
  const scale = 1;

  return (
    <Box
      className={`column-content ${isActive ? "active" : ""}`}
      sx={{
        height: "100%", // Match parent height (66vh)
        overflow: "hidden",
        position: "relative",
        opacity,
        transform: `scale(${scale})`,
        transition:
          "opacity 0.6s var(--easing-apple-standard), transform 0.6s var(--easing-apple-standard)",
        willChange: isActive ? "transform" : "auto",
      }}
    >
      <Box
        sx={{
          height: `${totalPanels * 100}%`, // Height = number of panels * 100% of parent
          transform: `translate3d(0, ${scrollOffset}, 0)`,
          transition: isTransitioning
            ? "transform 0.3s var(--easing-apple-standard)"
            : "transform 0.3s var(--easing-apple-standard)",
          willChange: isActive ? "transform" : "auto",
        }}
      >
        {children}
      </Box>

      {/* Debug progress indicator */}
      {isActive && (
        <Box
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            bgcolor: "rgba(0,0,0,0.7)",
            color: "white",
            p: 1,
            borderRadius: 1,
            fontSize: "12px",
            fontFamily: "monospace",
            zIndex: 1000,
          }}
        >
          {column.toUpperCase()}: Panel {panelIndex + 1}/{totalPanels} (
          {panelProgress.toFixed(1)}px)
        </Box>
      )}

      {/* Scroll hint for active column */}
      <ScrollHint
        show={isActive}
        column={column}
        progress={(panelIndex / (totalPanels - 1)) * 100}
      />
    </Box>
  );
};

export default ColumnContent;
