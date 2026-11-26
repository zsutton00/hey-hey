import { useLayoutEffect, useState, type KeyboardEvent } from "react";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Button, Stack, TextField } from "@mui/material";
import {
  useSuggestedBranchName,
  type SuggestBranchName,
} from "./runtime/hooks/useBranchNameSuggester";
import type { RegisterOpenNameField } from "./useOpenNameFields";

export interface NewBranchNameRowProps {
  /** The main folder's branch the new one starts from; null while detached. */
  startingBranch: string | null;
  suggestBranchName: SuggestBranchName | null;
  /** Every Service the accepted name will apply to. */
  serviceIds: readonly string[];
  registerOpenNameField: RegisterOpenNameField;
  disabled: boolean;
  width: number;
  onAccept: (branch: string) => void;
  onCancel: () => void;
}

/** Below this row width the two buttons show icons, keeping the name readable. */
const NARROW_ROW = "@container (max-width: 419.95px)";

const buttonSx = {
  height: 40,
  flexShrink: 0,
  whiteSpace: "nowrap",
  [NARROW_ROW]: { width: 40, minWidth: 40, px: 0 },
} as const;

const textSx = { [NARROW_ROW]: { display: "none" } } as const;

const iconSx = {
  display: "none",
  [NARROW_ROW]: { display: "block" },
} as const;

/** Names a new worktree's branch on the same row as the field it replaces. */
export const NewBranchNameRow = ({
  startingBranch,
  suggestBranchName,
  serviceIds,
  registerOpenNameField,
  disabled,
  width,
  onAccept,
  onCancel,
}: NewBranchNameRowProps) => {
  // Null until the user edits, so a late suggestion never replaces typing.
  const [typed, setTyped] = useState<string | null>(null);
  const suggestion = useSuggestedBranchName(suggestBranchName, serviceIds);
  const name = typed ?? suggestion.name;
  const branch = name.trim();
  const canAccept = !disabled && branch !== "";

  // Before paint, so nothing can be started between opening and holding.
  useLayoutEffect(() => registerOpenNameField(), [registerOpenNameField]);

  const accept = (): void => {
    if (canAccept) {
      onAccept(branch);
    }
  };

  const handleRowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) {
      return;
    }
    // Escape leaves the name only, not a surrounding dialog.
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  const handleNameKeyDown = (event: KeyboardEvent): void => {
    const isModified =
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    if (event.key !== "Enter" || isModified || event.nativeEvent.isComposing) {
      return;
    }
    // Also stops the key from pressing the button that takes focus next.
    event.preventDefault();
    accept();
  };

  return (
    <Box
      data-testid="work-in-new"
      onKeyDown={handleRowKeyDown}
      sx={{ containerType: "inline-size", width: "100%" }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          size="small"
          autoFocus
          disabled={disabled}
          label={`New branch from ${startingBranch ?? "current commit"}`}
          placeholder={suggestion.checking ? "Checking names…" : undefined}
          value={name}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={handleNameKeyDown}
          slotProps={{
            // The label stays above an empty field.
            inputLabel: { shrink: true },
            input: { notched: true },
            htmlInput: { "data-testid": "work-in-new-input" },
          }}
          sx={{ width, minWidth: 0 }}
        />
        <Button
          variant="outlined"
          aria-label="Cancel"
          onClick={onCancel}
          data-testid="work-in-new-cancel"
          sx={buttonSx}
        >
          <Box component="span" sx={textSx}>
            Cancel
          </Box>
          <CloseIcon fontSize="small" sx={iconSx} />
        </Button>
        <Button
          variant="contained"
          aria-label="Accept"
          disabled={!canAccept}
          onClick={accept}
          data-testid="work-in-new-accept"
          sx={buttonSx}
        >
          <Box component="span" sx={textSx}>
            Accept
          </Box>
          <CheckIcon fontSize="small" sx={iconSx} />
        </Button>
      </Stack>
    </Box>
  );
};
