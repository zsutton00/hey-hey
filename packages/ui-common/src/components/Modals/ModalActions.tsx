import type { ReactNode } from "react";
import { Box, DialogActions, type DialogActionsProps } from "@mui/material";

export interface ModalActionsProps extends DialogActionsProps {
  contextualActions?: ReactNode;
}

/** Consumer actions keep complete labels as the footer reflows on narrow screens. */
export function ModalActions({
  children,
  contextualActions,
  sx,
  ...props
}: ModalActionsProps) {
  return (
    <DialogActions
      {...props}
      sx={[
        {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
          px: 3,
          py: 2,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {contextualActions && (
        <Box
          data-testid="modal-contextual-actions"
          sx={{ display: "flex", gap: 1, alignItems: "center", mr: "auto" }}
        >
          {contextualActions}
        </Box>
      )}
      <Box
        data-testid="modal-primary-actions"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 1,
          ml: "auto",
          "& .MuiButton-root": { whiteSpace: "nowrap", flexShrink: 0 },
        }}
      >
        {children}
      </Box>
    </DialogActions>
  );
}
