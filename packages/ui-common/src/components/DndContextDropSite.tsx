import React, { useMemo, useState, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import type {
  DndContextDropSiteProps,
  DraggableContent,
  FileDropEvent,
} from "../types/dragAndDrop";
import { validateFile } from "../utils/fileValidation";

export const DndContextDropSite: React.FC<DndContextDropSiteProps> = ({
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
}) => {
  const uniqueId = useMemo(
    () => id || `dnd-dropsite-${Date.now()}-${Math.random()}`,
    [id]
  );
  const [isOver, setIsOver] = useState(false);
  const [isFileOver, setIsFileOver] = useState(false);

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

        // Check custom file size limit
        if (maxFileSize && file.size > maxFileSize) {
          console.warn(`File ${file.name} exceeds size limit`);
          return false;
        }

        // Check custom file types
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

      // Only trigger if leaving the actual drop zone, not child elements
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
      onDrop,
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

  const style = {
    opacity: disabled ? 0.5 : 1,
    backgroundColor: isAnyDragOver ? "rgba(0, 150, 0, 0.1)" : "transparent",
    border: isAnyDragOver ? "2px dashed #00960A" : "2px dashed transparent",
    borderRadius: "4px",
    transition: "all 0.2s ease",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={className}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
    >
      {children}
    </div>
  );
};
