import type { Variants } from "motion/react";

const HORIZ_SLIDE = 8;

/**
 * Subtle slide + fade combination for page transitions.
 * Creates smooth effect by combining opacity fade with small horizontal movement.
 * Slower duration (0.4s) to avoid flash effect.
 */
export const subtleSlideVariants: Variants = {
  hidden: {
    opacity: 0,
    x: HORIZ_SLIDE, // Very subtle 15px slide from right
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.4, // Slower to reduce flash
      ease: [0.4, 0, 0.2, 1], // Smooth easing curve
    },
  },
  exit: {
    opacity: 0,
    x: -HORIZ_SLIDE, // Very subtle slide to left on exit
    transition: {
      duration: 0.25,
      ease: [0.4, 0, 1, 1],
    },
  },
};

/**
 * Subtle transitions for tab content changes.
 * Uses vertical movement for visual distinction from page transitions.
 * Quick duration (0.2s) for responsive feel.
 */
export const tabTransitionVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 6, // Very small vertical movement
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2, // Quick for tabs
      ease: "easeOut",
    },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: {
      duration: 0.15,
    },
  },
};
