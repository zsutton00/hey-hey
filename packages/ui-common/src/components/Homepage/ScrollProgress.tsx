import React from "react";
import { Box } from "@mui/material";
import { motion } from "motion/react";

interface ScrollProgressProps {
  panelProgress: {
    left: number;
    center: number;
    right: number;
  };
  activeColumn: "left" | "center" | "right";
  isTransitioning?: boolean;
  panelHeight?: number;
}

const ScrollProgress: React.FC<ScrollProgressProps> = ({
  panelProgress,
  activeColumn,
  isTransitioning = false,
  panelHeight = 0,
}) => {
  const columns = ["left", "center", "right"] as const;

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 32,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 1,
        zIndex: 1000,
        padding: "12px 20px",
        backgroundColor: "rgba(0, 0, 0, 0.1)",
        backdropFilter: "blur(10px)",
        borderRadius: 3,
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    >
      {columns.map((column) => {
        const progressPercent =
          panelHeight > 0
            ? Math.min(100, (panelProgress[column] / panelHeight) * 100)
            : 0;

        return (
          <Box
            key={column}
            sx={{
              position: "relative",
              width: 60,
              height: 4,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {/* Progress fill */}
            <motion.div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                backgroundColor:
                  activeColumn === column
                    ? "rgb(8, 126, 139)"
                    : "rgba(255, 255, 255, 0.4)",
                borderRadius: 2,
              }}
              initial={{ width: "0%" }}
              animate={{
                width: `${progressPercent}%`,
                backgroundColor:
                  activeColumn === column
                    ? "rgb(8, 126, 139)"
                    : "rgba(255, 255, 255, 0.4)",
              }}
              transition={{
                width: {
                  duration: isTransitioning ? 0.3 : 0.1,
                  ease: [0.25, 0.46, 0.45, 0.94], // Apple easing
                },
                backgroundColor: {
                  duration: 0.3,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
              }}
            />

            {/* Active column glow effect */}
            {activeColumn === column && (
              <motion.div
                style={{
                  position: "absolute",
                  top: -1,
                  left: -1,
                  right: -1,
                  bottom: -1,
                  borderRadius: 3,
                  boxShadow: "0 0 8px rgba(8, 126, 139, 0.6)",
                  pointerEvents: "none",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              />
            )}
          </Box>
        );
      })}

      {/* Column labels */}
      <Box
        sx={{
          position: "absolute",
          top: -30,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 1,
          fontSize: "0.75rem",
          color: "rgba(255, 255, 255, 0.8)",
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {columns.map((column) => (
          <Box
            key={column}
            sx={{
              width: 60,
              textAlign: "center",
              opacity: activeColumn === column ? 1 : 0.6,
              transition: "opacity 0.3s ease",
              textTransform: "capitalize",
            }}
          >
            {column}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ScrollProgress;
