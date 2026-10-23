import React, { useRef } from "react";
import { motion } from "motion/react";
import { useLocation } from "react-router-dom";
import { useReducedMotion } from "@hey-hey/ui-common/hooks";
import { fadeVariants } from "@hey-hey/ui-common/animations";
import { subtleSlideVariants } from "../utils/routeTransitions";

interface AnimatedPageWrapperProps {
  children: React.ReactNode;
}

// Using subtleSlideVariants which combines fade + small horizontal slide
// Slower duration (0.4s) to reduce flash effect

const AnimatedPageWrapper: React.FC<AnimatedPageWrapperProps> = ({
  children,
}) => {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialLocationKeyRef = useRef(location.key);
  const pageVariants = prefersReducedMotion
    ? fadeVariants
    : subtleSlideVariants;

  return (
    <motion.div
      key={location.key}
      variants={pageVariants}
      initial={
        location.key === initialLocationKeyRef.current ? false : "hidden"
      }
      animate="visible"
      exit="exit"
      style={{
        position: "relative",
        width: "100%",
        transformOrigin: "top center",
        maxWidth: "100%",
        // Keep horizontal clipping during transitions without breaking sticky headers.
        overflowX: "clip",
        overflowY: "visible",
      }}
      onAnimationStart={() => {
        // Temporarily prevent horizontal scroll during animation
        if (document.body) {
          document.body.style.overflowX = "hidden";
        }
      }}
      onAnimationComplete={() => {
        // Restore normal overflow
        if (document.body) {
          document.body.style.overflowX = "";
        }
        // Clean up will-change
        if (containerRef.current) {
          containerRef.current.style.willChange = "auto";
        }
      }}
    >
      <div ref={containerRef} style={{ overflow: "visible" }}>
        {children}
      </div>
    </motion.div>
  );
};

export default AnimatedPageWrapper;
