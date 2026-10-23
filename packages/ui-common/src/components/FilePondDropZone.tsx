import React, { useState, useCallback } from "react";
import { FilePond, registerPlugin } from "react-filepond";
import type { FilePondFile } from "filepond";
import { Box, Typography, Alert } from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../i18n/keys";

// Import FilePond styles
import "filepond/dist/filepond.min.css";
import "filepond-plugin-image-preview/dist/filepond-plugin-image-preview.css";

// Import and register FilePond plugins
import FilePondPluginImageExifOrientation from "filepond-plugin-image-exif-orientation";
import FilePondPluginImagePreview from "filepond-plugin-image-preview";
import FilePondPluginFileValidateType from "filepond-plugin-file-validate-type";
import FilePondPluginFileValidateSize from "filepond-plugin-file-validate-size";

import type { FileDropEvent, DraggableContent } from "../types/dragAndDrop";
import { validateFile, MAX_FILE_SIZE } from "../utils/fileValidation";
import { processFiles, createFileContent } from "../utils/fileProcessing";
import type { ProcessedFile } from "../utils/fileProcessing";

// Register FilePond plugins
registerPlugin(
  FilePondPluginImageExifOrientation,
  FilePondPluginImagePreview,
  FilePondPluginFileValidateType,
  FilePondPluginFileValidateSize
);

const isBrowserFile = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

export interface FilePondDropZoneProps {
  onFilesAdded?: (files: ProcessedFile[]) => void;
  onFileDropEvent?: (event: FileDropEvent) => void;
  onFileContentCreated?: (content: DraggableContent[]) => void;
  acceptedFileTypes?: string[];
  maxFileSize?: number | string;
  maxFiles?: number;
  allowMultiple?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  showValidation?: boolean;
  server?: string | object;
  instantUpload?: boolean;
  labelIdle?: string;
}

export const FilePondDropZone: React.FC<FilePondDropZoneProps> = ({
  onFilesAdded,
  onFileDropEvent,
  onFileContentCreated,
  acceptedFileTypes,
  maxFileSize = MAX_FILE_SIZE,
  maxFiles = 10,
  allowMultiple = true,
  disabled = false,
  className,
  id,
  showValidation = true,
  server,
  instantUpload = false,
  labelIdle,
}) => {
  const { t } = useTranslation();
  const [fileItems, setFileItems] = useState<FilePondFile[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const filePondMaxFileSize =
    typeof maxFileSize === "number" ? `${maxFileSize}B` : maxFileSize;

  // Convert our accepted file types to FilePond format
  const getFilePondAcceptedTypes = useCallback(() => {
    if (!acceptedFileTypes || acceptedFileTypes.length === 0) {
      // Default to LLM-analyzable types
      return [
        "text/*",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/json",
        "application/xml",
        "image/*",
        "application/javascript",
        "text/javascript",
        "application/typescript",
        ".js",
        ".ts",
        ".jsx",
        ".tsx",
        ".py",
        ".java",
        ".c",
        ".cpp",
        ".cs",
        ".php",
        ".rb",
        ".go",
        ".rs",
        ".sql",
        ".md",
        ".txt",
        ".yaml",
        ".yml",
      ];
    }
    return acceptedFileTypes;
  }, [acceptedFileTypes]);

  const handleUpdateFiles = useCallback(
    async (items: FilePondFile[]) => {
      setFileItems(items);

      const actualFiles = items
        .map((fileItem) => fileItem.file)
        .filter(isBrowserFile);

      if (actualFiles.length === 0) {
        setValidationErrors([]);
        return;
      }

      // Validate files with our validation system
      const errors: string[] = [];
      const validFiles: File[] = [];

      for (const file of actualFiles) {
        const validation = validateFile(file);
        if (!validation.isValid && validation.errorMessage) {
          errors.push(`${file.name}: ${validation.errorMessage}`);
        } else {
          validFiles.push(file);
        }
      }

      setValidationErrors(errors);

      if (validFiles.length > 0) {
        try {
          // Process files with our system
          const processedFiles = await processFiles(validFiles);

          // Trigger callbacks
          if (onFilesAdded) {
            onFilesAdded(processedFiles);
          }

          if (onFileDropEvent) {
            onFileDropEvent({
              files: validFiles,
              targetId: id || "filepond-dropzone",
            });
          }

          if (onFileContentCreated) {
            const fileContents = await Promise.all(
              validFiles.map(async (file) => {
                const content = await createFileContent(file);
                return { type: "file" as const, data: content };
              })
            );
            onFileContentCreated(fileContents);
          }
        } catch (error) {
          console.error("Error processing files:", error);
          setValidationErrors((prev) => [
            ...prev,
            t(KEYS.filepond.processingError),
          ]);
        }
      }
    },
    [onFilesAdded, onFileDropEvent, onFileContentCreated, id, t]
  );

  const getCustomLabelIdle = () => {
    if (labelIdle) return labelIdle;

    return `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 24px; margin-bottom: 8px;">📁</div>
        <div style="font-size: 16px; margin-bottom: 4px;">${t(
          KEYS.filepond.dragDropFiles
        )}</div>
        <div style="font-size: 14px; color: #666;">
          ${t(KEYS.filepond.orBrowse)} 
          <span class="filepond--label-action" style="color: #007acc; text-decoration: underline;">
            ${t(KEYS.filepond.browse)}
          </span>
        </div>
        <div style="font-size: 12px; color: #999; margin-top: 8px;">
          ${t(KEYS.filepond.supportedTypes)}
        </div>
      </div>
    `;
  };

  return (
    <Box className={className}>
      <FilePond
        onupdatefiles={handleUpdateFiles}
        allowMultiple={allowMultiple}
        maxFiles={maxFiles}
        server={instantUpload ? server : undefined}
        name="files"
        labelIdle={getCustomLabelIdle()}
        acceptedFileTypes={getFilePondAcceptedTypes()}
        maxFileSize={filePondMaxFileSize}
        disabled={disabled}
        credits={false}
        // Styling props
        stylePanelAspectRatio="1:1"
        styleLoadIndicatorPosition="center bottom"
        styleButtonRemoveItemPosition="left bottom"
        styleButtonProcessItemPosition="right bottom"
        // Validation props
        allowFileTypeValidation={true}
        allowFileSizeValidation={true}
        // Image preview props (when applicable)
        allowImagePreview={true}
        // Custom validation
        beforeAddFile={(item) => {
          if (item.file && isBrowserFile(item.file)) {
            const validation = validateFile(item.file);
            if (!validation.isLLMAnalyzable && showValidation) {
              console.warn(`File ${item.file.name} is not LLM analyzable`);
            }
          }
          return true;
        }}
        // Localization
        labelInvalidField={t(KEYS.filepond.invalidField)}
        labelFileWaitingForSize={t(KEYS.filepond.waitingForSize)}
        labelFileSizeNotAvailable={t(KEYS.filepond.sizeNotAvailable)}
        labelFileLoading={t(KEYS.filepond.loading)}
        labelFileLoadError={t(KEYS.filepond.loadError)}
        labelFileProcessing={t(KEYS.filepond.processing)}
        labelFileProcessingComplete={t(KEYS.filepond.processingComplete)}
        labelFileProcessingAborted={t(KEYS.filepond.processingAborted)}
        labelFileProcessingError={t(KEYS.filepond.processingError)}
        labelFileProcessingRevertError={t(KEYS.filepond.revertError)}
        labelFileRemoveError={t(KEYS.filepond.removeError)}
        labelTapToCancel={t(KEYS.filepond.tapToCancel)}
        labelTapToRetry={t(KEYS.filepond.tapToRetry)}
        labelTapToUndo={t(KEYS.filepond.tapToUndo)}
        labelButtonRemoveItem={t(KEYS.filepond.remove)}
        labelButtonAbortItemLoad={t(KEYS.filepond.abort)}
        labelButtonRetryItemLoad={t(KEYS.filepond.retry)}
        labelButtonAbortItemProcessing={t(KEYS.filepond.abort)}
        labelButtonUndoItemProcessing={t(KEYS.filepond.undo)}
        labelButtonRetryItemProcessing={t(KEYS.filepond.retry)}
        labelButtonProcessItem={t(KEYS.filepond.upload)}
      />

      {/* Validation Errors */}
      {showValidation && validationErrors.length > 0 && (
        <Box sx={{ mt: 2 }}>
          {validationErrors.map((error, index) => (
            <Alert key={index} severity="error" sx={{ mb: 1 }}>
              <Typography variant="body2">{error}</Typography>
            </Alert>
          ))}
        </Box>
      )}

      {/* LLM Compatibility Info */}
      {showValidation && fileItems.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="info">
            <Typography variant="body2">
              {t(KEYS.filepond.llmCompatibilityInfo)}
            </Typography>
          </Alert>
        </Box>
      )}
    </Box>
  );
};
