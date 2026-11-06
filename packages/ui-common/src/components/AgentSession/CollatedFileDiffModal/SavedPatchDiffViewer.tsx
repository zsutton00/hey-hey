import {
  Box,
  FormControlLabel,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import React from "react";
import {
  DIFF_PRESENTATION_MODES,
  FullFileSplitView,
  type DiffPresentationMode,
} from "./FullFileSplitView";

const PRESENTATION_MODE_STORAGE_KEY = "diffViewer.presentationMode";
const HIDE_COMMENTS_STORAGE_KEY = "diffViewer.hideComments";

const isPresentationMode = (value: unknown): value is DiffPresentationMode =>
  value === DIFF_PRESENTATION_MODES.sideBySide ||
  value === DIFF_PRESENTATION_MODES.vertical;

const readPresentationMode = (): DiffPresentationMode => {
  try {
    const value = window.localStorage.getItem(PRESENTATION_MODE_STORAGE_KEY);
    return isPresentationMode(value)
      ? value
      : DIFF_PRESENTATION_MODES.sideBySide;
  } catch {
    return DIFF_PRESENTATION_MODES.sideBySide;
  }
};

const readHideComments = (): boolean => {
  try {
    return window.localStorage.getItem(HIDE_COMMENTS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export interface SavedPatchDiffViewerProps {
  filePath: string;
  patch: string;
  testId?: string;
}

/** Shared syntax-highlighted viewer for unified patches saved without a workspace. */
export const SavedPatchDiffViewer: React.FC<SavedPatchDiffViewerProps> = ({
  filePath,
  patch,
  testId = "saved-patch-diff-viewer",
}) => {
  const [presentationMode, setPresentationMode] =
    React.useState(readPresentationMode);
  const [hideComments, setHideComments] = React.useState(readHideComments);

  const handlePresentationModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    nextMode: DiffPresentationMode | null,
  ): void => {
    if (!isPresentationMode(nextMode)) return;
    setPresentationMode(nextMode);
    try {
      window.localStorage.setItem(PRESENTATION_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Keep the in-memory setting when storage is unavailable.
    }
  };

  const handleHideCommentsChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    setHideComments(event.target.checked);
    try {
      window.localStorage.setItem(
        HIDE_COMMENTS_STORAGE_KEY,
        String(event.target.checked),
      );
    } catch {
      // Keep the in-memory setting when storage is unavailable.
    }
  };

  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: 400,
        minHeight: 240,
        mt: 0.75,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="caption" color="text.secondary" noWrap>
          {filePath}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={presentationMode}
            onChange={handlePresentationModeChange}
            aria-label="Diff presentation"
            data-testid={`${testId}-presentation-selector`}
          >
            <ToggleButton
              value={DIFF_PRESENTATION_MODES.vertical}
              aria-label="Inline"
            >
              Inline
            </ToggleButton>
            <ToggleButton
              value={DIFF_PRESENTATION_MODES.sideBySide}
              aria-label="Side-by-side"
            >
              Side-by-side
            </ToggleButton>
          </ToggleButtonGroup>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Switch
                size="small"
                checked={hideComments}
                onChange={handleHideCommentsChange}
                data-testid={`${testId}-hide-comments-toggle`}
              />
            }
            label={<Typography variant="body2">Hide comments</Typography>}
          />
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
        <FullFileSplitView
          preContent={null}
          postContent={null}
          patch={patch}
          filePath={filePath}
          presentationMode={presentationMode}
          hideComments={hideComments}
        />
      </Box>
    </Box>
  );
};
