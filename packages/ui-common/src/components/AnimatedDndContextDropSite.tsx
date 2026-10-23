import React, { useMemo, useState, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import { motion, AnimatePresence } from "motion/react";
import { withSpeed } from "../animations/config";
import type {
  AnimationConfig,
  DndContextDropSiteProps,
  DraggableContent,
  DropEvent,
  FileDropEvent,
} from "../types/dragAndDrop";
import { validateFile } from "../utils/fileValidation";

const defaultDropSiteAnimation: AnimationConfig = {
  enabled: true,
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94],
  scale: {
    hover: 1.02,
    drag: 1.0,
    drop: 1.05,
  },
  opacity: {
    drag: 0.9,
    drop: 1.0,
  },
};

const dropZoneVariants = {
  initial: {
    scale: 1,
    opacity: 1,
  },
  dragOver: {
    scale: 1.02,
    transition: {
      duration: 0.2,
    },
  },
  dragLeave: {
    scale: 1,
    transition: {
      duration: 0.3,
    },
  },
  drop: {
    scale: 1.05,
    transition: {
      duration: 0.15,
    },
  },
};

const pulseVariants = {
  pulse: {
    scale: [1, 1.03, 1],
    opacity: [0.7, 1, 0.7],
    transition: {
      duration: 1.5,
      repeat: Infinity,
    },
  },
};

export const AnimatedDndContextDropSite: React.FC<DndContextDropSiteProps> = ({
  children,
  id,
  acceptedTypes,
  disabled = false,
  onDrop,
  onFileDrop,
  onDragOver,
  onDragLeave,
  className,
  acceptFiles = true,
  maxFileSize,
  acceptedFileTypes,
  animation = defaultDropSiteAnimation,
}) => {
  const uniqueId = useMemo(
    () => id || `dnd-dropsite-${Date.now()}-${Math.random()}`,
    [id]
  );
  const [isOver, setIsOver] = useState(false);
  const [isFileOver, setIsFileOver] = useState(false);
  const [justDropped, setJustDropped] = useState(false);
  const config = { ...defaultDropSiteAnimation, ...animation };

  const canAccept = (content: DraggableContent): boolean => {
    if (!acceptedTypes || acceptedTypes.length === 0) return true;
    return acceptedTypes.includes(content.type);
  };

  const canAcceptFiles = useCallback((): boolean => {
    return acceptFiles && !disabled;
  }, [acceptFiles, disabled]);

  const validateDroppedFiles = useCallback(
    (files: File[]): File[] => {
      return files.filter((file) => {
        const validation = validateFile(file);

        if (maxFileSize && file.size > maxFileSize) {
          console.warn(`File ${file.name} exceeds size limit`);
          return false;
        }

        if (acceptedFileTypes && acceptedFileTypes.length > 0) {
          const extension = file.name
            .toLowerCase()
            .substring(file.name.lastIndexOf("."));
          const mimeType = file.type.toLowerCase();
          const isAccepted = acceptedFileTypes.some(
            (type) =>
              type.toLowerCase() === extension ||
              type.toLowerCase() === mimeType ||
              (type.startsWith(".") && extension === type.toLowerCase()) ||
              (type.includes("/") && mimeType.includes(type.toLowerCase()))
          );

          if (!isAccepted) {
            console.warn(`File ${file.name} type not accepted`);
            return false;
          }
        }

        return validation.isValid;
      });
    },
    [maxFileSize, acceptedFileTypes]
  );

  // Handle native file drag events
  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (canAcceptFiles() && event.dataTransfer.types.includes("Files")) {
        setIsFileOver(true);
      }
    },
    [canAcceptFiles]
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setIsFileOver(false);
        onDragLeave?.();
      }
    },
    [onDragLeave]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (canAcceptFiles() && event.dataTransfer.types.includes("Files")) {
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [canAcceptFiles]
  );

  const handleFileDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      setIsFileOver(false);
      setJustDropped(true);

      // Reset drop animation after duration
      setTimeout(() => setJustDropped(false), 300);

      if (!canAcceptFiles() || !onFileDrop) return;

      const files = Array.from(event.dataTransfer.files);
      const validFiles = validateDroppedFiles(files);

      if (validFiles.length > 0) {
        const fileDropEvent: FileDropEvent = {
          files: validFiles,
          targetId: uniqueId,
        };

        onFileDrop(fileDropEvent);
      }
    },
    [canAcceptFiles, onFileDrop, uniqueId, validateDroppedFiles]
  );

  const { setNodeRef, isOver: isOverDroppable } = useDroppable({
    id: uniqueId,
    disabled,
    data: {
      onDrop: (event: DropEvent) => {
        setJustDropped(true);
        setTimeout(() => setJustDropped(false), 300);
        onDrop?.(event);
      },
      onDragOver: (content: DraggableContent) => {
        if (canAccept(content)) {
          setIsOver(true);
          onDragOver?.(content);
        }
      },
      onDragLeave: () => {
        setIsOver(false);
        onDragLeave?.();
      },
    },
  });

  const isDragOver = isOver && isOverDroppable;
  const isAnyDragOver = isDragOver || isFileOver;

  const getCurrentVariant = () => {
    if (justDropped) return "drop";
    if (isAnyDragOver) return "dragOver";
    return "initial";
  };

  return (
    <motion.div
      ref={setNodeRef}
      className={className}
      variants={config.enabled ? dropZoneVariants : undefined}
      initial="initial"
      animate={getCurrentVariant()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
      style={{
        position: "relative",
        borderRadius: "8px",
        border: "2px dashed transparent",
        transition: config.enabled ? undefined : "all 0.2s ease",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}

      {/* Animated drop indicator */}
      <AnimatePresence>
        {config.enabled && isAnyDragOver && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={withSpeed({ duration: 0.2 })}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: "none",
              borderRadius: "6px",
              border: "2px dashed #00960A",
              backgroundColor: "rgba(0, 150, 0, 0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <motion.div
              variants={pulseVariants}
              animate="pulse"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: "#00960A",
                opacity: 0.3,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
