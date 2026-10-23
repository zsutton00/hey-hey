import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion, AnimatePresence } from "motion/react";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";

interface ScrollHintProps {
  show: boolean;
  column: "left" | "center" | "right";
  progress: number;
}

const ScrollHint: React.FC<ScrollHintProps> = ({ show, column, progress }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show hint after a brief delay when column becomes active
    if (show && progress < 10) {
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [show, progress]);

  const getHintText = () => {
    switch (column) {
      case "left":
        return "Scroll to explore our planning features";
      case "center":
        return "Discover Hey Hey's capabilities";
      case "right":
        return "Learn about integrations";
      default:
        return "Scroll to continue";
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{
            duration: 0.6,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
          style={{
            position: "absolute",
            bottom: 40,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              color: "rgba(255, 255, 255, 0.8)",
              textAlign: "center",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontSize: "0.75rem",
                fontWeight: 500,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              {getHintText()}
            </Typography>

            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <KeyboardArrowDown
                sx={{
                  fontSize: 24,
                  opacity: 0.6,
                }}
              />
            </motion.div>
          </Box>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ScrollHint;
