import { Box, Stack, Typography } from "@mui/material";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isFileDrop } from "./runtime/hooks/runAttachmentDrop";
interface AttachmentDropZoneProps {
  attachments: { canDrop: boolean; drop: (files: readonly File[]) => void };
  scopeKey: string;
  testId: string;
  children: ReactNode;
}
export function AttachmentDropZone({
  attachments,
  scopeKey,
  testId,
  children,
}: AttachmentDropZoneProps) {
  const [fileDragScope, setFileDragScope] = useState<string | null>(null);
  const fileDragDepth = useRef(0);
  const clearFileDrag = useCallback(() => {
    fileDragDepth.current = 0;
    setFileDragScope(null);
  }, []);
  useEffect(() => {
    clearFileDrag();
  }, [scopeKey, attachments.canDrop, clearFileDrag]);
  const showFileDrop = attachments.canDrop && fileDragScope === scopeKey;
  return (
    <Stack
      spacing={1}
      data-testid={testId}
      sx={{ position: "relative" }}
      onDragEnterCapture={(event) => {
        if (!isFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        fileDragDepth.current += 1;
        if (attachments.canDrop) setFileDragScope(scopeKey);
      }}
      onDragLeaveCapture={(event) => {
        if (!isFileDrop(event.dataTransfer)) return;
        event.stopPropagation();
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
        if (fileDragDepth.current === 0) clearFileDrag();
      }}
      onDragOverCapture={(event) => {
        if (!isFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        if (attachments.canDrop) setFileDragScope(scopeKey);
      }}
      onDropCapture={(event) => {
        if (!isFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        clearFileDrag();
        attachments.drop(Array.from(event.dataTransfer.files));
      }}
    >
      {showFileDrop ? (
        <Box
          data-testid="run-attachment-drop-indicator"
          role="status"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px dashed",
            borderColor: "primary.main",
            borderRadius: 1,
            bgcolor: "background.paper",
            color: "primary.main",
            m: "0 !important",
          }}
        >
          <Typography>Drop files to attach</Typography>
        </Box>
      ) : null}
      {children}
    </Stack>
  );
}
