import React from "react";
import { Box, Card, CardContent, Typography, Chip, Alert } from "@mui/material";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import type { FileContent, AnimationConfig } from "../types/dragAndDrop";
import type { ProcessedFile } from "../utils/fileProcessing";
import { FileCategory, getFileIcon } from "../utils/fileValidation";

const defaultFileAnimation: AnimationConfig = {
  enabled: true,
  duration: 0.3,
  ease: [0.12, 0, 0.39, 0] as const,
  scale: {
    hover: 1.03,
    drag: 0.98,
  },
  opacity: {
    drag: 0.9,
  },
};

const fileVariants = {
  initial: {
    scale: 1,
    opacity: 1,
    y: 0,
  },
  hover: {
    scale: 1.03,
    y: -2,
    transition: {
      duration: 0.2,
      ease: [0.12, 0, 0.39, 0] as const,
    },
  },
  tap: {
    scale: 0.98,
    transition: {
      duration: 0.1,
      ease: [0.12, 0, 0.39, 0] as const,
    },
  },
  enter: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.12, 0, 0.39, 0] as const,
    },
  },
  exit: {
    scale: 0.8,
    opacity: 0,
    y: 20,
    transition: {
      duration: 0.2,
      ease: [0.55, 0.085, 0.68, 0.53] as const,
    },
  },
};

const validationVariants = {
  initial: { opacity: 0, scale: 0.9, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      delay: 0.2,
      duration: 0.3,
      ease: [0.12, 0, 0.39, 0] as const,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    y: -10,
    transition: {
      duration: 0.2,
      ease: [0.55, 0.085, 0.68, 0.53] as const,
    },
  },
};

interface AnimatedFilePreviewProps {
  fileContent: FileContent | ProcessedFile;
  showValidation?: boolean;
  compact?: boolean;
  onClick?: () => void;
  animation?: AnimationConfig;
  delay?: number;
}

export const AnimatedFilePreview: React.FC<AnimatedFilePreviewProps> = ({
  fileContent,
  showValidation = false,
  compact = false,
  onClick,
  animation = defaultFileAnimation,
  delay = 0,
}) => {
  const { t } = useTranslation();
  const isProcessedFile = "isValid" in fileContent;
  const processedFile = isProcessedFile ? (fileContent as ProcessedFile) : null;
  const config = { ...defaultFileAnimation, ...animation };

  const category = fileContent.metadata?.category as FileCategory;
  const icon =
    (fileContent.metadata?.icon as string) ||
    getFileIcon(category || FileCategory.UNKNOWN);
  const formattedSize = fileContent.metadata?.formattedSize as string;

  const renderPreview = () => {
    if (!fileContent.preview) return null;

    // Image preview
    if (fileContent.type.startsWith("image/")) {
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.3, duration: 0.3 }}
          style={{ marginTop: "8px", textAlign: "center" }}
        >
          <img
            src={fileContent.preview}
            alt={fileContent.name}
            style={{
              maxWidth: compact ? "100px" : "200px",
              maxHeight: compact ? "60px" : "120px",
              objectFit: "contain",
              borderRadius: "4px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            }}
          />
        </motion.div>
      );
    }

    // Text preview
    if (
      typeof fileContent.preview === "string" &&
      !fileContent.type.startsWith("image/")
    ) {
      return (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ delay: delay + 0.3, duration: 0.3 }}
          style={{
            marginTop: "8px",
            padding: "8px",
            backgroundColor: "#f5f5f5",
            borderRadius: "4px",
            maxHeight: compact ? "60px" : "120px",
            overflow: "hidden",
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontFamily: "monospace",
              fontSize: compact ? "10px" : "12px",
              lineHeight: 1.2,
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fileContent.preview}
          </Typography>
        </motion.div>
      );
    }

    return null;
  };

  const renderValidationStatus = () => {
    if (!showValidation || !processedFile) return null;

    return (
      <AnimatePresence>
        <motion.div
          variants={validationVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ marginTop: "8px" }}
        >
          {!processedFile.isValid && (
            <Alert severity="error">
              <Typography variant="body2">
                {processedFile.errorMessage}
              </Typography>
              {processedFile.suggestedAction && (
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                  {t("file.suggestion")}: {processedFile.suggestedAction}
                </Typography>
              )}
            </Alert>
          )}

          {processedFile.isValid && !processedFile.isLLMAnalyzable && (
            <Alert severity="warning">
              <Typography variant="body2">{t("file.notAnalyzable")}</Typography>
            </Alert>
          )}

          {processedFile.isValid && processedFile.isLLMAnalyzable && (
            <Alert severity="success">
              <Typography variant="body2">{t("file.analyzable")}</Typography>
            </Alert>
          )}
        </motion.div>
      </AnimatePresence>
    );
  };

  const getCategoryColor = (
    cat: FileCategory,
  ):
    | "default"
    | "primary"
    | "secondary"
    | "error"
    | "info"
    | "success"
    | "warning" => {
    switch (cat) {
      case FileCategory.CODE:
        return "info";
      case FileCategory.DOCUMENT:
        return "primary";
      case FileCategory.IMAGE:
        return "secondary";
      case FileCategory.DATA:
        return "success";
      default:
        return "default";
    }
  };

  return (
    <motion.div
      variants={config.enabled ? fileVariants : undefined}
      initial={config.enabled ? "initial" : undefined}
      animate={config.enabled ? "enter" : undefined}
      exit={config.enabled ? "exit" : undefined}
      whileHover={config.enabled && onClick ? "hover" : undefined}
      whileTap={config.enabled && onClick ? "tap" : undefined}
      transition={{
        delay,
        duration: config.duration || 0.3,
        ease: [0.12, 0, 0.39, 0] as const,
      }}
    >
      <Card
        sx={{
          cursor: onClick ? "pointer" : "default",
          height: compact ? "auto" : "100%",
          overflow: "hidden",
        }}
        onClick={onClick}
      >
        <CardContent sx={{ p: compact ? 1 : 2 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                delay: delay + 0.1,
                duration: 0.4,
                ease: [0.12, 0, 0.39, 0] as const,
                type: "spring",
                stiffness: 200,
              }}
            >
              <Typography variant={compact ? "h6" : "h5"} sx={{ mr: 1 }}>
                {icon}
              </Typography>
            </motion.div>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: delay + 0.2, duration: 0.3 }}
              >
                <Typography
                  variant={compact ? "body2" : "h6"}
                  noWrap
                  title={fileContent.name}
                >
                  {fileContent.name}
                </Typography>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: delay + 0.25, duration: 0.3 }}
                style={{
                  display: "flex",
                  gap: "4px",
                  marginTop: "4px",
                  flexWrap: "wrap",
                }}
              >
                {category && (
                  <Chip
                    label={category}
                    size="small"
                    color={getCategoryColor(category)}
                    variant="outlined"
                  />
                )}

                {formattedSize && (
                  <Chip label={formattedSize} size="small" variant="outlined" />
                )}

                {processedFile && processedFile.isLLMAnalyzable && (
                  <Chip
                    label={t("file.llmReady")}
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                )}
              </motion.div>

              {!compact && renderPreview()}
              {renderValidationStatus()}
            </Box>
          </Box>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export interface AnimatedFileGridProps {
  files: (FileContent | ProcessedFile)[];
  showValidation?: boolean;
  onFileClick?: (file: FileContent | ProcessedFile) => void;
  compact?: boolean;
  animation?: AnimationConfig;
  staggerDelay?: number;
}

export const AnimatedFileGrid: React.FC<AnimatedFileGridProps> = ({
  files,
  showValidation = false,
  onFileClick,
  compact = false,
  animation = defaultFileAnimation,
  staggerDelay = 0.1,
}) => {
  if (files.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        display: "grid",
        gap: "8px",
        gridTemplateColumns: compact
          ? "repeat(auto-fill, minmax(200px, 1fr))"
          : "repeat(auto-fill, minmax(300px, 1fr))",
      }}
    >
      <AnimatePresence>
        {files.map((file, index) => (
          <AnimatedFilePreview
            key={file.id}
            fileContent={file}
            showValidation={showValidation}
            compact={compact}
            animation={animation}
            delay={index * staggerDelay}
            onClick={onFileClick ? () => onFileClick(file) : undefined}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};
