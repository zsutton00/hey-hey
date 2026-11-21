import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { useEffect, useState } from "react";
import {
  RUN_ATTACHMENT_FORMAT_HELP,
  runAttachmentFormat,
} from "../../utils/run-attachment-format";
import type { RunAttachmentEntry } from "./runtime/hooks/runAttachmentDrop";

const PREVIEW_BYTE_CAP = 256 * 1024;
const PREVIEW_CAP_LABEL = "256 KiB";

type PendingEntry = Exclude<RunAttachmentEntry, { status: "error" }>;

interface AttachmentChipsProps {
  attachments: {
    entries: readonly RunAttachmentEntry[];
    remove: (key: string) => void;
  };
}

/** Object URL tied to the component lifetime; revoked on unmount or file change. */
function useObjectUrl(file: File | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !file) {
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [file, enabled]);
  return url;
}

function TextPreview({ file }: { file: File }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "failed" }
    | { status: "ready"; text: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    file
      .slice(0, PREVIEW_BYTE_CAP)
      .text()
      .then((text) => {
        if (!cancelled) {
          setState({ status: "ready", text });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (state.status === "failed") {
    return <PreviewUnavailable />;
  }
  if (state.status === "loading") {
    return <Typography variant="body2">Loading…</Typography>;
  }

  return (
    <>
      {file.size > PREVIEW_BYTE_CAP ? (
        <Typography variant="caption" color="text.secondary">
          Showing the first {PREVIEW_CAP_LABEL}
        </Typography>
      ) : null}
      <Box
        component="pre"
        data-testid="attachment-preview-text"
        sx={{
          m: 0,
          p: 1.5,
          maxHeight: "70vh",
          overflow: "auto",
          fontFamily: "monospace",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
        }}
      >
        {state.text}
      </Box>
    </>
  );
}

function PreviewUnavailable() {
  return (
    <Typography variant="body2" data-testid="attachment-preview-unavailable">
      Preview unavailable
    </Typography>
  );
}

function ImagePreview({ file, url }: { file: File; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed || !url) {
    return <PreviewUnavailable />;
  }

  return (
    <Box
      component="img"
      src={url}
      alt={file.name}
      data-testid="attachment-preview-image"
      onError={() => setFailed(true)}
      sx={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
    />
  );
}

function AttachmentPreviewDialog({
  fileName,
  file,
  isImage,
  imageUrl,
  onClose,
}: {
  fileName: string;
  file: File;
  isImage: boolean;
  imageUrl: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="attachment-preview-dialog"
    >
      <DialogTitle>{fileName}</DialogTitle>
      <DialogContent>
        {isImage ? (
          <ImagePreview file={file} url={imageUrl} />
        ) : (
          <TextPreview file={file} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="attachment-preview-close">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PendingAttachmentChip({
  entry,
  onRemove,
}: {
  entry: PendingEntry;
  onRemove: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const format = runAttachmentFormat(entry.fileName);
  const isImage = format !== null && format !== "text";
  const file = entry.file;
  const imageUrl = useObjectUrl(entry.file, isImage);
  const showThumbnail = isImage && imageUrl !== null && !thumbFailed;

  const icon = showThumbnail ? (
    <Avatar
      src={imageUrl}
      alt=""
      slotProps={{ img: { onError: () => setThumbFailed(true) } }}
      sx={{ width: 20, height: 20 }}
      data-testid="run-attachment-thumbnail"
    />
  ) : isImage ? (
    <ImageOutlinedIcon fontSize="small" data-testid="run-attachment-icon" />
  ) : (
    <DescriptionOutlinedIcon
      fontSize="small"
      data-testid="run-attachment-icon"
    />
  );

  return (
    <>
      <Chip
        data-testid="run-attachment-chip"
        data-file-name={entry.fileName}
        data-upload-status={entry.status}
        icon={icon}
        {...(file
          ? {
              clickable: true,
              onClick: () => setPreviewOpen(true),
              "aria-label": `Preview ${entry.fileName}`,
            }
          : {})}
        label={
          entry.status === "uploading"
            ? `${entry.fileName} — Uploading…`
            : entry.fileName
        }
        onDelete={onRemove}
        deleteIcon={
          <span
            data-testid="remove-run-attachment"
            aria-label={`Remove ${entry.fileName}`}
          >
            ×
          </span>
        }
      />
      {previewOpen && file ? (
        <AttachmentPreviewDialog
          fileName={entry.fileName}
          file={file}
          isImage={isImage}
          imageUrl={imageUrl}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

export function AttachmentChips({ attachments }: AttachmentChipsProps) {
  if (attachments.entries.length === 0) return null;

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ flexWrap: "wrap" }}
      aria-label={RUN_ATTACHMENT_FORMAT_HELP}
      data-testid="run-attachments"
    >
      {attachments.entries.map((entry) =>
        entry.status === "error" ? (
          <Alert
            key={entry.key}
            severity="error"
            data-testid="run-attachment-error"
            data-file-name={entry.fileName}
            data-error-code={entry.code}
          >
            {entry.fileName}: {entry.code ? `${entry.code}: ` : ""}
            {entry.message}
            <IconButton
              aria-label={`Dismiss ${entry.fileName}`}
              data-testid="remove-run-attachment"
              onClick={() => attachments.remove(entry.key)}
            >
              ×
            </IconButton>
          </Alert>
        ) : (
          <PendingAttachmentChip
            key={entry.key}
            entry={entry}
            onRemove={() => attachments.remove(entry.key)}
          />
        ),
      )}
    </Stack>
  );
}
