// Main animations export - your single source of truth for animations

// Configuration and debugging
export {
  getAnimationConfig,
  setAnimationDebug,
  setAnimationSpeed,
  withSpeed,
} from "./config";

// All variants
export {
  // Core variants
  fadeVariants,
  slideUpVariants,
  slideDownVariants,
  slideLeftVariants,
  slideRightVariants,
  scaleInVariants,

  // Legacy variants (for backward compatibility)
  pageVariants,
  slideVariants,
  scaleVariants,
  staggerContainer,
  staggerItem,
  messageBubbleVariants,
  progressVariants,
  checkmarkVariants,
  spinnerVariants,
  pulseVariants,
  typingDotVariants,
  backdropVariants,
  modalVariants,
  notificationVariants,
  fieldVariants,
  collapseVariants,

  // Utilities
  shouldReduceMotion,
  createSafeVariants,
  transitions,
} from "./variants";

// Pre-built animation components - THE MAIN EVENT!
export {
  // Basic animations
  FadeIn,
  SlideUp,
  SlideDown,
  SlideLeft,
  SlideRight,
  ScaleIn,
  Scale,

  // Advanced components
  StaggerChildren,
  AnimatedConditional,
  AnimatedTransform,
  HoverScale,
  LoadingSpinner,
  Pulse,
  ProgressBar,
} from "./components";

// Re-export motion for convenience
export { motion, AnimatePresence } from "motion/react";
export type { Variants, Transition, MotionProps } from "motion/react";
