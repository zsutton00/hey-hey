import React from "react";
import { Box, Typography, Chip } from "@mui/material";
import { useScrollPerformance } from "../../hooks/useScrollPerformance";

interface PerformanceMonitorProps {
  show?: boolean;
}

const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  show = process.env.NODE_ENV === "development",
}) => {
  const { fps, averageFps, isOptimized, frameDrops, isMonitoring } =
    useScrollPerformance();

  if (!show || !isMonitoring) return null;

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return "#4caf50"; // Green
    if (fps >= 30) return "#ff9800"; // Orange
    return "#f44336"; // Red
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 80, // Below header
        right: 16,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        color: "white",
        padding: 2,
        borderRadius: 2,
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        fontFamily: "monospace",
        fontSize: "0.75rem",
        minWidth: 200,
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
        Performance Monitor
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <span>Current FPS:</span>
          <Chip
            label={`${fps}`}
            size="small"
            sx={{
              backgroundColor: getFpsColor(fps),
              color: "white",
              fontSize: "0.7rem",
              minWidth: 40,
              height: 20,
            }}
          />
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <span>Average FPS:</span>
          <Chip
            label={`${averageFps}`}
            size="small"
            sx={{
              backgroundColor: getFpsColor(averageFps),
              color: "white",
              fontSize: "0.7rem",
              minWidth: 40,
              height: 20,
            }}
          />
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <span>Frame Drops:</span>
          <Chip
            label={`${frameDrops}`}
            size="small"
            sx={{
              backgroundColor: frameDrops > 5 ? "#f44336" : "#4caf50",
              color: "white",
              fontSize: "0.7rem",
              minWidth: 40,
              height: 20,
            }}
          />
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <span>Optimized:</span>
          <Chip
            label={isOptimized ? "YES" : "NO"}
            size="small"
            sx={{
              backgroundColor: isOptimized ? "#ff9800" : "#4caf50",
              color: "white",
              fontSize: "0.7rem",
              minWidth: 40,
              height: 20,
            }}
          />
        </Box>
      </Box>

      {isOptimized && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 1,
            color: "#ff9800",
            fontWeight: "bold",
          }}
        >
          ⚡ Performance mode active
        </Typography>
      )}
    </Box>
  );
};

export default PerformanceMonitor;
