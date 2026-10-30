import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Box,
  Button,
  DialogContent,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  IMAGE_SECTION_ACCEPT,
  encodeImageFile,
  imageSectionDataUrl,
  readImageSection,
  serializeImageSection,
} from "./imageSection";

export interface ImageSectionRendererProps {
  content: unknown;
  /** Accessible description of the image, usually the section label. */
  label: string;
  /**
   * When provided the section is editable: upload/drop, replace, and remove
   * emit canonical section JSON, or "" to return the section to absence.
   */
  onChange?: (content: string) => void;
  disabled?: boolean;
  emptyText?: string;
}

const ImagePreview: React.FC<{ src: string; label: string }> = ({
  src,
  label,
}) => {
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  }>();
  const [originalOpen, setOriginalOpen, originalOpenOwnerKey] =
    useModalState(false);

  return (
    <Stack spacing={0.5} alignItems="flex-start">
      <Box
        component="img"
        src={src}
        alt={label}
        data-testid="image-section-preview"
        onLoad={(event: React.SyntheticEvent<HTMLImageElement>) =>
          setDimensions({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        sx={{
          display: "block",
          maxWidth: "100%",
          maxHeight: 480,
          width: "auto",
          height: "auto",
          objectFit: "contain",
          borderRadius: 1,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {dimensions ? `${dimensions.width} × ${dimensions.height} px · ` : ""}
        <Link
          component="button"
          type="button"
          variant="caption"
          onClick={() => setOriginalOpen(true)}
        >
          View original size
        </Link>
      </Typography>
      <Dialog
        ownerKey={originalOpenOwnerKey}
        workTitle="Image preview"
        open={originalOpen}
        onClose={() => setOriginalOpen(false)}
        maxWidth={false}
      >
        <DialogContent sx={{ p: 1, overflow: "auto" }}>
          <Box
            component="img"
            src={src}
            alt={label}
            sx={{ display: "block" }}
          />
        </DialogContent>
      </Dialog>
    </Stack>
  );
};

/**
 * Renders a schema-backed image section identically in draft, proposal
 * review, and approved views. Editing never exposes the base64 payload.
 */
export const ImageSectionRenderer: React.FC<ImageSectionRendererProps> = ({
  content,
  label,
  onChange,
  disabled = false,
  emptyText = "No image",
}) => {
  const value = useMemo(() => readImageSection(content), [content]);
  const src =
    value.status === "valid" ? imageSectionDataUrl(value.image) : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const acceptFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !onChange) return;
      const encoded = await encodeImageFile(file);
      if (encoded.status === "error") {
        // Keep the existing draft content untouched on an invalid selection.
        setError(encoded.message);
        return;
      }
      setError(undefined);
      onChange(serializeImageSection(encoded.image));
    },
    [onChange],
  );

  const editable = Boolean(onChange) && !disabled;

  const preview =
    value.status === "invalid" ? (
      <Alert severity="warning" data-testid="image-section-invalid">
        This image is unavailable because the stored value is not a supported
        image.
      </Alert>
    ) : src ? (
      <ImagePreview src={src} label={label} />
    ) : onChange ? null : (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );

  if (!onChange) {
    return <Box data-testid="image-section">{preview}</Box>;
  }

  return (
    <Stack
      spacing={1}
      data-testid="image-section"
      sx={{ padding: "0 14px 16px 14px" }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_SECTION_ACCEPT}
        hidden
        data-testid="image-section-file-input"
        onChange={(event) => {
          void acceptFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {value.status === "absent" ? (
        <Box
          data-testid="image-section-dropzone"
          onDragOver={(event) => {
            if (!editable) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (editable) void acceptFile(event.dataTransfer.files?.[0]);
          }}
          sx={{
            border: 1,
            borderStyle: "dashed",
            borderColor: dragging ? "primary.main" : "divider",
            borderRadius: 1,
            p: 3,
            textAlign: "center",
          }}
        >
          <Stack spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Drag a PNG, JPEG, or WebP image here (up to 1 MB)
            </Typography>
            <Button
              variant="outlined"
              size="small"
              disabled={!editable}
              onClick={() => inputRef.current?.click()}
            >
              Upload
            </Button>
          </Stack>
        </Box>
      ) : (
        <>
          {preview}
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              disabled={!editable}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              disabled={!editable}
              onClick={() => {
                setError(undefined);
                onChange("");
              }}
            >
              Remove
            </Button>
          </Stack>
        </>
      )}
      {error && (
        <Alert severity="error" data-testid="image-section-error">
          {error}
        </Alert>
      )}
    </Stack>
  );
};
