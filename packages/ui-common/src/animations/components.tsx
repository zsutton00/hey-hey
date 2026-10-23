import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  fadeVariants,
  slideUpVariants,
  slideDownVariants,
  slideLeftVariants,
  slideRightVariants,
  scaleInVariants,
  staggerContainer,
  staggerItem,
  transitions,
} from "./variants";

// Base props for all animation components
interface BaseAnimationProps {
  children: React.ReactNode;
  delay?: number;
  duration?: "fast" | "medium" | "slow";
  springy?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onAnimationStart?: () => void;
  onAnimationComplete?: () => void;
  layout?: boolean;
}

// Simple animation components that render motion.div directly without wrappers
export const FadeIn: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...fadeVariants,
    visible: {
      ...fadeVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

export const SlideUp: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...slideUpVariants,
    visible: {
      ...slideUpVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

export const SlideDown: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...slideDownVariants,
    visible: {
      ...slideDownVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

export const SlideLeft: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...slideLeftVariants,
    visible: {
      ...slideLeftVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

export const SlideRight: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...slideRightVariants,
    visible: {
      ...slideRightVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

export const ScaleIn: React.FC<BaseAnimationProps> = ({
  children,
  delay = 0,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
  layout,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];
  const modifiedVariants = {
    ...scaleInVariants,
    visible: {
      ...scaleInVariants.visible,
      transition: {
        ...customTransition,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={modifiedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
      style={style}
      layout={layout}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

// StaggerChildren component for lists
interface StaggerChildrenProps {
  children: React.ReactNode;
  stagger?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const StaggerChildren: React.FC<StaggerChildrenProps> = ({
  children,
  stagger = 0.1,
  className,
  style,
}) => {
  const customStaggerVariants = {
    ...staggerContainer,
    visible: {
      ...staggerContainer.visible,
      transition: {
        staggerChildren: stagger,
        delayChildren: 0.1,
      },
    },
  };

  return (
    <motion.div
      variants={customStaggerVariants}
      initial="hidden"
      animate="visible"
      className={className}
      style={style}
    >
      {React.Children.map(children, (child, index) => (
        <motion.div key={index} variants={staggerItem}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
};

// AnimatedPresence wrapper for conditional rendering
interface AnimatedConditionalProps {
  show: boolean;
  children: React.ReactNode;
  animationType?:
    | "fade"
    | "slideUp"
    | "slideDown"
    | "slideLeft"
    | "slideRight"
    | "scale";
  duration?: "fast" | "medium" | "slow";
  springy?: boolean;
}

export const AnimatedConditional: React.FC<AnimatedConditionalProps> = ({
  show,
  children,
  animationType = "fade",
  duration = "medium",
  springy = false,
}) => {
  const getVariants = () => {
    switch (animationType) {
      case "slideUp":
        return slideUpVariants;
      case "slideDown":
        return slideDownVariants;
      case "slideLeft":
        return slideLeftVariants;
      case "slideRight":
        return slideRightVariants;
      case "scale":
        return scaleInVariants;
      default:
        return fadeVariants;
    }
  };

  const variants = getVariants();
  const customTransition = springy ? transitions.spring : transitions[duration];

  const modifiedVariants = {
    ...variants,
    visible: {
      ...variants.visible,
      transition: customTransition,
    },
    exit: {
      ...variants.exit,
      transition: transitions.fast,
    },
  };

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          variants={modifiedVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Generic transform animation component
interface AnimatedTransformProps {
  children: React.ReactNode;
  animate: {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
    opacity?: number;
  };
  duration?: "fast" | "medium" | "slow";
  springy?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onAnimationStart?: () => void;
  onAnimationComplete?: () => void;
}

export const AnimatedTransform: React.FC<AnimatedTransformProps> = ({
  children,
  animate: animateProps,
  duration = "medium",
  springy = false,
  className,
  style,
  onAnimationStart,
  onAnimationComplete,
}) => {
  const customTransition = springy ? transitions.spring : transitions[duration];

  return (
    <motion.div
      className={className}
      style={style}
      animate={{
        ...animateProps,
        transition: customTransition,
      }}
      onAnimationStart={onAnimationStart}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </motion.div>
  );
};

// Hover scale animation component (for subtle interactions)
interface HoverScaleProps {
  children: React.ReactNode;
  scaleAmount?: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  disabled?: boolean;
}

export const HoverScale: React.FC<HoverScaleProps> = ({
  children,
  scaleAmount = 1.05,
  className,
  style,
  onClick,
  disabled = false,
}) => {
  return (
    <motion.div
      className={className}
      style={style}
      onClick={disabled ? undefined : onClick}
      animate={{
        scale: 1,
      }}
      whileHover={
        disabled
          ? undefined
          : {
              scale: scaleAmount,
              transition: transitions.fast,
            }
      }
      whileTap={
        disabled
          ? undefined
          : {
              scale: scaleAmount * 0.98,
              transition: transitions.fast,
            }
      }
    >
      {children}
    </motion.div>
  );
};

// Loading spinner component
interface LoadingSpinnerProps {
  size?: number;
  color?: string;
  thickness?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 24,
  color = "#1976d2",
  thickness = 3,
  className,
  style,
}) => {
  return (
    <motion.div
      className={className}
      style={{
        width: size,
        height: size,
        border: `${thickness}px solid ${color}20`,
        borderTop: `${thickness}px solid ${color}`,
        borderRadius: "50%",
        ...style,
      }}
      animate={{
        rotate: 360,
      }}
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: "linear",
      }}
    />
  );
};

// Pulse animation component (for blinking cursors, etc)
interface PulseProps {
  children: React.ReactNode;
  duration?: number;
  pulseScale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Pulse: React.FC<PulseProps> = ({
  children,
  duration = 1,
  pulseScale = 1.05,
  className,
  style,
}) => {
  return (
    <motion.span
      className={className}
      style={style}
      animate={{
        opacity: [1, 0, 1],
        scale: pulseScale > 0 ? [1, pulseScale, 1] : 1,
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      {children}
    </motion.span>
  );
};

// Progress bar component with animated width
interface ProgressBarProps {
  progress: number; // 0-100
  height?: number;
  backgroundColor?: string;
  progressColor?: string;
  duration?: "fast" | "medium" | "slow";
  className?: string;
  style?: React.CSSProperties;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  height = 8,
  backgroundColor = "#e0e0e0",
  progressColor = "#2196f3",
  duration = "medium",
  className,
  style,
}) => {
  const customTransition = transitions[duration];

  return (
    <motion.div
      className={className}
      style={{
        width: "100%",
        height,
        backgroundColor,
        borderRadius: height / 2,
        overflow: "hidden",
        ...style,
      }}
    >
      <motion.div
        style={{
          height: "100%",
          backgroundColor: progressColor,
          borderRadius: height / 2,
        }}
        initial={{ width: "0%" }}
        animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        transition={customTransition}
      />
    </motion.div>
  );
};

// Aliases for backward compatibility
export const Scale = ScaleIn;
