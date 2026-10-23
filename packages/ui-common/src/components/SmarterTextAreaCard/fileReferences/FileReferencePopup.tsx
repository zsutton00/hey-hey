import type { MouseEvent, RefObject } from "react";
import { Box, CircularProgress, Paper, Typography } from "@mui/material";
import type { FileReferenceCandidatesState } from "../../../data/hooks/useFileReferenceCandidates";
import type { FileTouchReferenceCandidateDto } from "../../../api";
import {
  fileReferenceCandidateKey,
  type FileReferencePopupPosition,
} from "./types";

export const FILE_REFERENCE_POPUP_WIDTH = 640;

export interface FileReferencePopupProps {
  state: FileReferenceCandidatesState;
  position: FileReferencePopupPosition;
  candidates?: readonly FileTouchReferenceCandidateDto[];
  highlightedCandidateKey?: string | null;
  onSelect?: (candidate: FileTouchReferenceCandidateDto) => void;
  popupRef?: RefObject<HTMLDivElement | null>;
  selectable?: boolean;
}

const StatusMessage = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
    {children}
  </Typography>
);

export const FileReferencePopup = ({
  state,
  position,
  candidates = state.candidates,
  highlightedCandidateKey = null,
  onSelect,
  popupRef,
  selectable = false,
}: FileReferencePopupProps) => {
  if (state.status === "disabled") return null;

  return (
    <Paper
      ref={popupRef}
      data-testid="file-reference-popup"
      elevation={8}
      sx={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: `min(${FILE_REFERENCE_POPUP_WIDTH}px, calc(100vw - 8px))`,
        maxWidth: "calc(100vw - 8px)",
        maxHeight: 360,
        overflowY: "auto",
        zIndex: (theme) => theme.zIndex.modal + 1,
      }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", px: 1.5, pt: 1.25 }}
      >
        Touched-file history
      </Typography>

      {state.status === "loading" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading touched files…</Typography>
        </Box>
      )}
      {state.status === "empty" && (
        <StatusMessage>
          No indexed touched-file evidence exists for this scope.
        </StatusMessage>
      )}
      {state.status === "error" && (
        <StatusMessage>Couldn’t load touched-file history.</StatusMessage>
      )}
      {(state.status === "ready" || state.status === "updating") && (
        <Box role="listbox" aria-label="Touched-file history">
          {state.status === "updating" && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", px: 1.5, py: 0.5 }}
            >
              Updating touched-file history…
            </Typography>
          )}
          {candidates.length === 0 && (
            <StatusMessage>No touched files match this query.</StatusMessage>
          )}
          {candidates.map((candidate) => {
            const candidateKey = fileReferenceCandidateKey(candidate);
            const highlighted = candidateKey === highlightedCandidateKey;
            const handleMouseDown = (event: MouseEvent): void => {
              if (selectable) event.preventDefault();
            };

            return (
              <Box
                key={candidateKey}
                role="option"
                aria-selected={highlighted}
                aria-disabled={!selectable}
                data-testid="file-reference-candidate-row"
                data-service-id={candidate.serviceId}
                data-candidate-key={candidateKey}
                onMouseDown={handleMouseDown}
                onClick={
                  selectable && onSelect
                    ? () => onSelect(candidate)
                    : undefined
                }
                sx={{
                  px: 1.5,
                  py: 1,
                  borderTop: 1,
                  borderColor: "divider",
                  cursor: selectable ? "pointer" : "default",
                  bgcolor: highlighted ? "action.selected" : undefined,
                  "&:hover": selectable
                    ? { bgcolor: "action.hover" }
                    : undefined,
                }}
              >
                <Typography variant="body2" fontWeight={500}>
                  {candidate.normalizedPath}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {candidate.serviceName}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
};
