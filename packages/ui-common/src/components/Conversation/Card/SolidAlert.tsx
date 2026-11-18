import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Box } from "@mui/material";
import React from "react";

export interface SolidAlertProps {
  severity: "warning" | "error";
  children: React.ReactNode;
  /** Optional trailing control, for example a Retry button. */
  action?: React.ReactNode;
  "data-testid"?: string;
}

/**
 * Compact solid-fill bar for in-message warnings and errors. Cards are
 * outlined and alerts are filled so the two never read as the same thing.
 */
export const SolidAlert: React.FC<SolidAlertProps> = ({
  severity,
  children,
  action,
  "data-testid": dataTestId,
}) => {
  const Icon = severity === "error" ? ErrorOutlineIcon : WarningAmberIcon;

  return (
    <Box
      role={severity === "error" ? "alert" : "status"}
      data-testid={dataTestId ?? "solid-alert"}
      data-severity={severity}
      sx={(theme) => {
        const tone = theme.palette.conversationAlert[severity];

        return {
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 1.5,
          py: 1,
          borderRadius: 1.5,
          backgroundColor: tone.main,
          color: tone.contrastText,
          "& a": { color: "inherit" },
          "& p": { m: 0 },
        };
      }}
    >
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "1.5px solid currentColor",
        }}
      >
        <Icon sx={{ fontSize: 14 }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, fontSize: "0.875rem" }}>{children}</Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Box>
  );
};
