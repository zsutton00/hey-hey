import { cloneElement, type ReactElement } from "react";
import {
  Box,
  IconButton,
  type DialogProps,
  type IconButtonProps,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RemoveIcon from "@mui/icons-material/Remove";

export interface ModalWindowControlsProps {
  title: string;
  minimize: (() => void) | null;
  onClose: DialogProps["onClose"];
  closeControl: ReactElement<IconButtonProps> | undefined;
}

export function ModalWindowControls({
  title,
  minimize,
  onClose,
  closeControl,
}: ModalWindowControlsProps) {
  return (
    <Box
      data-testid="modal-window-controls"
      sx={{
        position: "absolute",
        right: 8,
        top: 8,
        display: "flex",
        zIndex: 2,
        bgcolor: "background.paper",
        borderRadius: 1,
        "& > .MuiIconButton-root": {
          position: "static",
          minWidth: 44,
          minHeight: 44,
        },
      }}
    >
      {minimize && (
        <IconButton
          data-testid="modal-minimize"
          aria-label={`Minimize ${title}`}
          onClick={minimize}
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          <RemoveIcon />
        </IconButton>
      )}
      {closeControl ? (
        cloneElement(closeControl, {
          "aria-label": closeControl.props["aria-label"] ?? `Close ${title}`,
        })
      ) : (
        <IconButton
          data-testid="modal-close"
          aria-label={`Close ${title}`}
          disabled={!onClose}
          onClick={(event) => onClose?.(event, "escapeKeyDown")}
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          <CloseIcon />
        </IconButton>
      )}
    </Box>
  );
}
