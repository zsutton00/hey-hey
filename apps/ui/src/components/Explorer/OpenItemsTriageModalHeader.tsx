import { useModalShell } from "@hey-hey/ui-common/components/Modals";
import { IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";

export const TRIAGE_TITLE_ID = "open-items-triage-title";

/**
 * Header for the modal states outside the triage page, matching the page's
 * own header so the dialog keeps its title and close control throughout.
 */
export function OpenItemsTriageModalHeader({
  onClose,
}: {
  onClose: () => void;
}) {
  const inModalShell = useModalShell();
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      spacing={1.5}
      sx={{
        pr: inModalShell ? 13 : 0,
        minHeight: 48,
        pb: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="h5" id={TRIAGE_TITLE_ID}>
        {t("triage.title", "Open Items triage")}
      </Typography>
      {!inModalShell && (
        <IconButton
          aria-label={t("triage.close", "Close triage")}
          data-testid="open-items-triage-close"
          onClick={onClose}
          size="small"
          sx={{ color: "text.secondary" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Stack>
  );
}
