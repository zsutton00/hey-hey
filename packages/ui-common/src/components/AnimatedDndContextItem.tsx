import React, { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { motion } from "motion/react";
import type { MotionStyle } from "motion/react";
import type {
  DndContextItemProps,
  AnimationConfig,
} from "../types/dragAndDrop";

const defaultAnimation: AnimationConfig = {
  enabled: true,
  duration: 0.2,
  ease: [0.25, 0.46, 0.45, 0.94],
  scale: {
    hover: 1.02,
    drag: 0.95,
    drop: 1.1,
  },
  opacity: {
    drag: 0.8,
    drop: 0.6,
  },
  rotate: {
    hover: 0,
    drag: 2,
  },
};

export const AnimatedDndContextItem: React.FC<DndContextItemProps> = ({
  content,
  children,
  id,
  disabled = false,
  onDragStart,
  onDragEnd,
  className,
  animation = defaultAnimation,
}) => {
  const uniqueId = useMemo(
    () => id || `dnd-item-${Date.now()}-${Math.random()}`,
    [id]
  );
  const config = { ...defaultAnimation, ...animation };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: uniqueId,
    disabled: disabled || !config.enabled,
    data: {
      content,
      sourceId: uniqueId,
      onDragStart,
      onDragEnd,
    },
  });

  // Calculate motion styles based on current state
  const getMotionStyle = (): MotionStyle => {
    const baseStyle: MotionStyle = {
      cursor: disabled ? "default" : "grab",
    };

    if (!config.enabled) return baseStyle;

    // When dragging
    if (isDragging) {
      return {
        ...baseStyle,
        scale: config.scale?.drag || 0.95,
        opacity: config.opacity?.drag || 0.8,
        rotate: config.rotate?.drag || 2,
        zIndex: 999,
        cursor: "grabbing",
      };
    }

    return baseStyle;
  };

  const motionVariants = {
    initial: {
      scale: 1,
      opacity: 1,
      rotate: 0,
    },
    hover: config.enabled
      ? {
          scale: config.scale?.hover || 1.02,
          rotate: config.rotate?.hover || 0,
          transition: {
            duration: config.duration || 0.2,
            ease: [0.12, 0, 0.39, 0] as const,
          },
        }
      : {},
    drag: config.enabled
      ? {
          scale: config.scale?.drag || 0.95,
          opacity: config.opacity?.drag || 0.8,
          rotate: config.rotate?.drag || 2,
          transition: {
            duration: 0.1,
            ease: [0.12, 0, 0.39, 0] as const,
          },
        }
      : {},
    drop: config.enabled
      ? {
          scale: config.scale?.drop || 1.1,
          opacity: config.opacity?.drop || 0.6,
          transition: {
            duration: 0.15,
            ease: [0.12, 0, 0.39, 0] as const,
          },
        }
      : {},
  };

  return (
    <motion.div
      ref={setNodeRef}
      className={className}
      style={getMotionStyle()}
      variants={motionVariants}
      initial="initial"
      animate={isDragging ? "drag" : "initial"}
      whileHover={!disabled && !isDragging ? "hover" : undefined}
      whileTap={!disabled ? "drag" : undefined}
      transition={{
        duration: config.duration || 0.2,
        ease: [0.12, 0, 0.39, 0],
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </motion.div>
  );
};
