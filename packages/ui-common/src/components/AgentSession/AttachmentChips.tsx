import { Alert, Chip, IconButton, Stack } from "@mui/material";
import { RUN_ATTACHMENT_FORMAT_HELP } from "../../utils/run-attachment-format";
import type { RunAttachmentEntry } from "./runtime/hooks/runAttachmentDrop";
interface AttachmentChipsProps {
  attachments: {
    entries: readonly RunAttachmentEntry[];
    remove: (key: string) => void;
  };
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
          <Chip
            key={entry.key}
            data-testid="run-attachment-chip"
            data-file-name={entry.fileName}
            data-upload-status={entry.status}
            label={
              entry.status === "uploading"
                ? `${entry.fileName} — Uploading…`
                : entry.fileName
            }
            onDelete={() => attachments.remove(entry.key)}
            deleteIcon={
              <span
                data-testid="remove-run-attachment"
                aria-label={`Remove ${entry.fileName}`}
              >
                ×
              </span>
            }
          />
        ),
      )}
    </Stack>
  );
}
