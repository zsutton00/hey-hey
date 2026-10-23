import type { Variants, Transition } from "motion/react";
import { withSpeed } from "./config";

// Accessibility-aware animations
export const shouldReduceMotion = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

// Base transitions - now using centralized speed control
export const transitions = {
  fast: withSpeed({ duration: 0.15, ease: [0.4, 0, 0.2, 1] }) as Transition,
  medium: withSpeed({ duration: 0.25, ease: [0.4, 0, 0.2, 1] }) as Transition,
  slow: withSpeed({ duration: 0.4, ease: [0.4, 0, 0.2, 1] }) as Transition,
  spring: withSpeed({
    type: "spring",
    stiffness: 300,
    damping: 30,
  }) as Transition,
  bouncy: withSpeed({
    type: "spring",
    stiffness: 400,
    damping: 25,
  }) as Transition,
} as const;

// Core animation variants
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    transition: transitions.fast,
  },
};

export const slideUpVariants: Variants = {
  hidden: {
    opacity: 0,
    y: shouldReduceMotion() ? 0 : 30,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    y: shouldReduceMotion() ? 0 : -30,
    transition: transitions.fast,
  },
};

export const slideDownVariants: Variants = {
  hidden: {
    opacity: 0,
    y: shouldReduceMotion() ? 0 : -30,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    y: shouldReduceMotion() ? 0 : 30,
    transition: transitions.fast,
  },
};

export const slideLeftVariants: Variants = {
  hidden: {
    opacity: 0,
    x: shouldReduceMotion() ? 0 : 30,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    x: shouldReduceMotion() ? 0 : -30,
    transition: transitions.fast,
  },
};

export const slideRightVariants: Variants = {
  hidden: {
    opacity: 0,
    x: shouldReduceMotion() ? 0 : -30,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    x: shouldReduceMotion() ? 0 : 30,
    transition: transitions.fast,
  },
};

export const scaleInVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: shouldReduceMotion() ? 1 : 0.8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: transitions.medium,
  },
  exit: {
    opacity: 0,
    scale: shouldReduceMotion() ? 1 : 0.8,
    transition: transitions.fast,
  },
};

// ActionsCapsule expansion animation - springs from bottom-right corner
export const capsuleExpandVariants: Variants = {
  inactive: {
    width: "auto",
    maxHeight: 82,
    borderRadius: 32,
    scale: shouldReduceMotion() ? 1 : 0.95,
    transition: transitions.fast,
  },
  drag: {
    width: "auto",
    maxHeight: 200,
    borderRadius: 16,
    scale: 1,
    transition: transitions.fast,
  },
  active: {
    width: 800,
    maxHeight: 620,
    borderRadius: 16,
    scale: 1,
    transition: transitions.spring,
  },
  "full-size": {
    width: "calc(100vw - 300px)",
    maxHeight: "calc(100vh - 150px)",
    borderRadius: 16,
    scale: 1,
    transition: transitions.spring,
  },
};

// Stagger container for lists
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: shouldReduceMotion() ? 0 : 0.1,
      delayChildren: shouldReduceMotion() ? 0 : 0.1,
    },
  },
};

// Stagger items
export const staggerItem: Variants = {
  hidden: {
    opacity: 0,
    y: shouldReduceMotion() ? 0 : 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.medium,
  },
};

// Legacy variants for backward compatibility
export const pageVariants = fadeVariants;
export const slideVariants = slideLeftVariants;
export const scaleVariants = scaleInVariants;
export const messageBubbleVariants = fadeVariants;
export const progressVariants: Variants = {
  initial: { width: 0 },
  animate: (progress: number) => ({
    width: `${progress}%`,
    transition: withSpeed({
      duration: 0.8,
      ease: [0.4, 0, 0.2, 1],
    }),
  }),
};
export const checkmarkVariants: Variants = {
  hidden: {
    pathLength: 0,
    opacity: 0,
  },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: withSpeed({
        type: "tween",
        duration: 0.6,
        ease: "easeInOut",
      }),
      opacity: withSpeed({ duration: 0.2 }),
    },
  },
};
export const spinnerVariants: Variants = {
  animate: {
    rotate: 360,
    transition: withSpeed({
      duration: 1,
      repeat: Infinity,
      ease: "linear",
    }),
  },
};
export const pulseVariants: Variants = {
  animate: {
    opacity: [0.5, 1, 0.5],
    transition: withSpeed({
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    }),
  },
};
export const typingDotVariants: Variants = {
  animate: {
    y: [0, -10, 0],
    transition: withSpeed({
      duration: 0.6,
      repeat: Infinity,
      ease: "easeInOut",
    }),
  },
};
export const backdropVariants = fadeVariants;
export const modalVariants = scaleInVariants;
export const notificationVariants = slideRightVariants;
export const fieldVariants = fadeVariants;
export const collapseVariants: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: transitions.medium,
  },
  expanded: {
    height: "auto",
    opacity: 1,
    transition: transitions.medium,
  },
};

// Safe animation wrapper that respects motion preferences
export const createSafeVariants = (variants: Variants) => {
  if (shouldReduceMotion()) {
    const safeVariants: Variants = {};
    Object.keys(variants).forEach((key) => {
      const variant = variants[key];
      const resolvedOpacity =
        typeof variant === "function"
          ? 1
          : "opacity" in variant
          ? (variant.opacity as number | undefined) ?? 1
          : 1;
      safeVariants[key] = {
        opacity: resolvedOpacity,
        transition: withSpeed({ duration: 0.1 }),
      };
    });
    return safeVariants;
  }
  return variants;
};
