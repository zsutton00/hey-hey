import React, { useState, useCallback } from "react";
import { Box, Typography, Tabs, Tab } from "@mui/material";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";

import { AnimatedDndContextDropSite } from "./AnimatedDndContextDropSite";
import { FilePondDropZone } from "./FilePondDropZone";
import { AnimatedFileGrid } from "./AnimatedFilePreview";

import type {
  DndContextDropSiteProps,
  DraggableContent,
  DropEvent,
  FileDropEvent,
} from "../types/dragAndDrop";
import type { ProcessedFile } from "../utils/fileProcessing";

interface HybridDndDropZoneProps extends Omit<
  DndContextDropSiteProps,
  "children"
> {
  children?: React.ReactNode;

  // FilePond specific props
  enableFilePond?: boolean;
  filePondServer?: string | object;
  filePondInstantUpload?: boolean;
  filePondMaxFiles?: number;

  // Display options
  showModeToggle?: boolean;
  defaultMode?: "dnd" | "filepond" | "both";
  showFileGrid?: boolean;
  /**
   * Whether to automatically convert FilePond files to DraggableContent.
   * Set to true if you only want to use onHybridContentAdded callback.
   * Set to false (default) if you're using both onFilePondFilesAdded and onHybridContentAdded
   * to prevent duplication.
   */
  autoConvertFilesToContent?: boolean;

  // Callbacks
  onFilePondFilesAdded?: (files: ProcessedFile[]) => void;
  onHybridContentAdded?: (content: DraggableContent[]) => void;

  // Styling
  title?: string;
  subtitle?: string;
  minHeight?: number;
}

type DropMode = "dnd" | "filepond" | "both";

export const HybridDndDropZone: React.FC<HybridDndDropZoneProps> = ({
  children,
  enableFilePond = true,
  filePondServer,
  filePondInstantUpload = false,
  filePondMaxFiles = 10,
  showModeToggle = true,
  defaultMode = "both",
  showFileGrid = true,
  autoConvertFilesToContent = false, // Default to false to prevent duplication
  onFilePondFilesAdded,
  onHybridContentAdded,
  title,
  subtitle,
  minHeight = 200,
  animation,
  onDrop,
  onFileDrop,
  ...dndProps
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DropMode>(defaultMode);
  const [droppedContent, setDroppedContent] = useState<DraggableContent[]>([]);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);

  const handleDndDrop = useCallback(
    (event: DropEvent) => {
      setDroppedContent((prev) => [...prev, event.content]);
      onDrop?.(event);
    },
    [onDrop],
  );

  const handleDndFileDrop = useCallback(
    (event: FileDropEvent) => {
      // This handles files dropped directly on the dnd zone
      onFileDrop?.(event);
    },
    [onFileDrop],
  );

  const handleFilePondFiles = useCallback(
    (files: ProcessedFile[]) => {
      setProcessedFiles((prev) => [...prev, ...files]);
      onFilePondFilesAdded?.(files);

      // Only convert to DraggableContent if explicitly enabled
      // This prevents double-counting when both file and content handlers are used
      if (autoConvertFilesToContent && onHybridContentAdded) {
        const contentItems = files.map((file) => ({
          type: "file" as const,
          data: file,
        }));
        onHybridContentAdded(contentItems);
      }
    },
    [onFilePondFilesAdded, onHybridContentAdded, autoConvertFilesToContent],
  );

  const handleFilePondContentCreated = useCallback(
    (content: DraggableContent[]) => {
      setDroppedContent((prev) => [...prev, ...content]);
      onHybridContentAdded?.(content);
    },
    [onHybridContentAdded],
  );

  const handleModeChange = (
    _event: React.SyntheticEvent,
    newValue: DropMode,
  ) => {
    setMode(newValue);
  };

  const clearAll = () => {
    setDroppedContent([]);
    setProcessedFiles([]);
  };

  const modeVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.3, ease: [0.12, 0, 0.39, 0] as const },
    },
    exit: {
      opacity: 0,
      y: -20,
      scale: 0.95,
      transition: { duration: 0.2, ease: [0.55, 0.085, 0.68, 0.53] as const },
    },
  };

  const renderDndZone = () => (
    <motion.div
      key="dnd-zone"
      variants={modeVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <AnimatedDndContextDropSite
        {...dndProps}
        onDrop={handleDndDrop}
        onFileDrop={handleDndFileDrop}
        animation={animation}
      >
        <Box
          sx={{
            minHeight,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: "2px dashed #ccc",
            borderRadius: "12px",
            p: 3,
            background: "linear-gradient(145deg, #f8f9fa 0%, #e9ecef 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {children || (
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h6" gutterBottom>
                🎯 {title || t("hybrid.dndTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {subtitle || t("hybrid.dndSubtitle")}
              </Typography>
            </Box>
          )}

          {/* Decorative background */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              opacity: 0.1,
              fontSize: "32px",
            }}
          >
            ⚡
          </motion.div>
        </Box>
      </AnimatedDndContextDropSite>
    </motion.div>
  );

  const renderFilePondZone = () => (
    <motion.div
      key="filepond-zone"
      variants={modeVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <Box
        sx={{
          "& .filepond--root": {
            minHeight,
            fontFamily: "inherit",
          },
          "& .filepond--panel-root": {
            background: "linear-gradient(145deg, #f0f2f5 0%, #e8eaf6 100%)",
            border: "2px dashed #ccc",
            borderRadius: "12px",
          },
          "& .filepond--drop-label": {
            color: "#333",
          },
        }}
      >
        <FilePondDropZone
          onFilesAdded={handleFilePondFiles}
          onFileContentCreated={handleFilePondContentCreated}
          acceptedFileTypes={dndProps.acceptedFileTypes}
          maxFileSize={dndProps.maxFileSize}
          maxFiles={filePondMaxFiles}
          server={filePondServer}
          instantUpload={filePondInstantUpload}
          labelIdle={`
            <div style="padding: 20px; text-align: center;">
              <div style="font-size: 32px; margin-bottom: 12px;">📁</div>
              <div style="font-size: 18px; margin-bottom: 8px; font-weight: 600;">
                ${title || t("hybrid.filePondTitle")}
              </div>
              <div style="font-size: 14px; color: #666; margin-bottom: 12px;">
                ${subtitle || t("hybrid.filePondSubtitle")}
              </div>
              <div style="font-size: 14px; color: #007acc;">
                ${t("hybrid.browseFiles")} 
                <span class="filepond--label-action">
                  ${t("hybrid.browse")}
                </span>
              </div>
            </div>
          `}
        />
      </Box>
    </motion.div>
  );

  const renderBothModes = () => (
    <motion.div
      key="both-modes"
      variants={modeVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <Box
        sx={{
          display: "flex",
          gap: 2,
          flexDirection: { xs: "column", md: "row" },
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" gutterBottom sx={{ textAlign: "center" }}>
            🎯 {t("hybrid.dragDropMode")}
          </Typography>
          {renderDndZone()}
        </Box>

        <Box
          sx={{
            display: { xs: "none", md: "flex" },
            alignItems: "center",
            px: 1,
          }}
        >
          <Typography variant="h5" color="text.secondary">
            OR
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" gutterBottom sx={{ textAlign: "center" }}>
            📁 {t("hybrid.fileUploadMode")}
          </Typography>
          {renderFilePondZone()}
        </Box>
      </Box>
    </motion.div>
  );

  return (
    <Box>
      {/* Mode Toggle */}
      {showModeToggle && enableFilePond && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <Box
            sx={{
              mb: 2,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Tabs value={mode} onChange={handleModeChange} variant="scrollable">
              <Tab label={t("hybrid.dndOnly")} value="dnd" />
              <Tab label={t("hybrid.filePondOnly")} value="filepond" />
              <Tab label={t("hybrid.bothModes")} value="both" />
            </Tabs>

            {(droppedContent.length > 0 || processedFiles.length > 0) && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={clearAll}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                {t("hybrid.clearAll")}
              </motion.button>
            )}
          </Box>
        </motion.div>
      )}

      {/* Drop Zone Content */}
      <AnimatePresence mode="wait">
        {mode === "dnd" && renderDndZone()}
        {mode === "filepond" && enableFilePond && renderFilePondZone()}
        {mode === "both" && enableFilePond && renderBothModes()}
      </AnimatePresence>

      {/* Results Display */}
      {showFileGrid &&
        (droppedContent.length > 0 || processedFiles.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                📋 {t("hybrid.results")} (
                {droppedContent.length + processedFiles.length})
              </Typography>

              {/* Regular dropped content */}
              {droppedContent.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    🎯 {t("hybrid.draggedItems")}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {droppedContent.map((item, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.1 }}
                        style={{
                          padding: "8px 12px",
                          background: "rgba(0, 150, 10, 0.1)",
                          borderRadius: "8px",
                          border: "1px solid rgba(0, 150, 10, 0.2)",
                        }}
                      >
                        <Typography variant="body2">
                          {item.type === "artifact" && `📄 ${item.data.title}`}
                          {item.type === "conversation" &&
                            `💬 ${item.data.title}`}
                          {item.type === "initiative" && `🎯 ${item.data.name}`}
                          {item.type === "file" && `📁 ${item.data.name}`}
                        </Typography>
                      </motion.div>
                    ))}
                  </Box>
                </Box>
              )}

              {/* FilePond files */}
              {processedFiles.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    📁 {t("hybrid.uploadedFiles")}
                  </Typography>
                  <AnimatedFileGrid
                    files={processedFiles}
                    showValidation={true}
                    compact={true}
                    staggerDelay={0.1}
                  />
                </Box>
              )}
            </Box>
          </motion.div>
        )}
    </Box>
  );
};
