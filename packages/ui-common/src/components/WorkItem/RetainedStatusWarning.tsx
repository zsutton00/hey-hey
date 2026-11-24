import WarningAmber from "@mui/icons-material/WarningAmber";
import { Box, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Sits directly under the normal Status field when the item's saved status
 * was removed from its type. The item keeps that status until someone picks a
 * new one in the field itself.
 */
export const RetainedStatusWarning: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box
      data-testid="retained-status-warning"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        mt: 0.5,
        color: "warning.main",
      }}
    >
      <WarningAmber fontSize="small" />
      <Typography variant="caption" color="inherit">
        {t("retainedStatus.needsNewStatus", "Needs a new status")}
      </Typography>
    </Box>
  );
};
