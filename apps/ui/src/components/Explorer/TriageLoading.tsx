import { Box, CircularProgress } from "@mui/material";
import { useTranslation } from "react-i18next";

export function TriageLoading() {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="open-items-triage-loading"
      role="status"
      aria-label={t("triage.opening", "Opening triage…")}
      sx={{ display: "flex", justifyContent: "center", py: 4 }}
    >
      <CircularProgress size={24} />
    </Box>
  );
}
