import React from "react";
import { Box, Card, CardContent, Typography, Chip, Alert } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { FileContent } from "../types/dragAndDrop";
import type { ProcessedFile } from "../utils/fileProcessing";
import { FileCategory, getFileIcon } from "../utils/fileValidation";

interface FilePreviewProps {
  fileContent: FileContent | ProcessedFile;
  showValidation?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  fileContent,
  showValidation = false,
  compact = false,
  onClick,
}) => {
  const { t } = useTranslation();
  const isProcessedFile = "isValid" in fileContent;
  const processedFile = isProcessedFile ? (fileContent as ProcessedFile) : null;

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
        <Box sx={{ mt: 1, textAlign: "center" }}>
          <img
            src={fileContent.preview}
            alt={fileContent.name}
            style={{
              maxWidth: compact ? "100px" : "200px",
              maxHeight: compact ? "60px" : "120px",
              objectFit: "contain",
              borderRadius: "4px",
            }}
          />
        </Box>
      );
    }

    // Text preview
    if (
      typeof fileContent.preview === "string" &&
      !fileContent.type.startsWith("image/")
    ) {
      return (
        <Box
          sx={{
            mt: 1,
            p: 1,
            bgcolor: "grey.100",
            borderRadius: 1,
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
        </Box>
      );
    }

    return null;
  };

  const renderValidationStatus = () => {
    if (!showValidation || !processedFile) return null;

    if (!processedFile.isValid) {
      return (
        <Alert severity="error" sx={{ mt: 1 }}>
          <Typography variant="body2">{processedFile.errorMessage}</Typography>
          {processedFile.suggestedAction && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              {t("file.suggestion")}: {processedFile.suggestedAction}
            </Typography>
          )}
        </Alert>
      );
    }

    if (!processedFile.isLLMAnalyzable) {
      return (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Typography variant="body2">{t("file.notAnalyzable")}</Typography>
        </Alert>
      );
    }

    return (
      <Alert severity="success" sx={{ mt: 1 }}>
        <Typography variant="body2">{t("file.analyzable")}</Typography>
      </Alert>
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
    <Card
      sx={{
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { backgroundColor: "action.hover" } : {},
        height: compact ? "auto" : "100%",
      }}
      onClick={onClick}
    >
      <CardContent sx={{ p: compact ? 1 : 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Typography variant={compact ? "h6" : "h5"} sx={{ mr: 1 }}>
            {icon}
          </Typography>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant={compact ? "body2" : "h6"}
              noWrap
              title={fileContent.name}
            >
              {fileContent.name}
            </Typography>

            <Box sx={{ display: "flex", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
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
            </Box>

            {!compact && renderPreview()}
            {renderValidationStatus()}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

interface FileGridProps {
  files: (FileContent | ProcessedFile)[];
  showValidation?: boolean;
  onFileClick?: (file: FileContent | ProcessedFile) => void;
  compact?: boolean;
}

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  showValidation = false,
  onFileClick,
  compact = false,
}) => {
  if (files.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 1,
        gridTemplateColumns: compact
          ? "repeat(auto-fill, minmax(200px, 1fr))"
          : "repeat(auto-fill, minmax(300px, 1fr))",
      }}
    >
      {files.map((file) => (
        <FilePreview
          key={file.id}
          fileContent={file}
          showValidation={showValidation}
          compact={compact}
          onClick={onFileClick ? () => onFileClick(file) : undefined}
        />
      ))}
    </Box>
  );
};
