import { useState } from "react";
import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { OpenItemsTriageMode } from "@hey-hey/ui-common/api";

export const TRIAGE_HELP_DESCRIPTION_ID = "open-items-triage-help-description";

/**
 * The start screen every opening shows; nothing runs until a mode button is
 * pressed. It holds only the guidance being typed — the review owner keeps the
 * mode and guidance a review starts with.
 */
export function OpenItemsTriageHelp({
  onRun,
}: {
  onRun: (mode: OpenItemsTriageMode, guidance: string) => void;
}) {
  const { t } = useTranslation();
  const [guidance, setGuidance] = useState("");
  return (
    <Stack
      data-testid="open-items-triage-help"
      alignItems="center"
      spacing={2}
      sx={{ maxWidth: 440, width: "100%", mx: "auto", py: 3 }}
    >
      <Typography
        aria-hidden
        sx={{ fontSize: 28, lineHeight: 1, color: "text.secondary" }}
      >
        ✦
      </Typography>
      <Box id={TRIAGE_HELP_DESCRIPTION_ID} sx={{ width: "100%" }}>
        <Typography sx={{ fontWeight: 600, textAlign: "center", mb: 1.5 }}>
          {t("triage.help.lead", "Run an agent to tidy up your Open Items.")}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3, color: "text.secondary" }}>
          <li>
            {t("triage.help.removes", "Removes items you no longer need")}
          </li>
          <li>{t("triage.help.groups", "Groups related items together")}</li>
          <li>{t("triage.help.tracks", "Tracks ongoing work on a Goal")}</li>
        </Box>
      </Box>
      <TextField
        multiline
        minRows={3}
        fullWidth
        value={guidance}
        onChange={(event) => setGuidance(event.target.value)}
        label={t("triage.help.guidanceLabel", "Guidance (optional)")}
        placeholder={t(
          "triage.help.guidancePlaceholder",
          "Tell the agent what to focus on",
        )}
        slotProps={{
          htmlInput: { "data-testid": "triage-start-guidance-input" },
        }}
      />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        justifyContent="center"
        sx={{ width: "100%" }}
      >
        <Button
          data-testid="triage-start-tidy-up"
          variant="contained"
          onClick={() => onRun(OpenItemsTriageMode.TidyUp, guidance)}
        >
          {t("triage.help.tidyUp", "Tidy up")}
        </Button>
        <Button
          data-testid="triage-start-spring-cleaning"
          variant="outlined"
          onClick={() => onRun(OpenItemsTriageMode.SpringCleaning, guidance)}
        >
          {t("triage.help.springCleaning", "Spring cleaning")}
        </Button>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: "center" }}
        data-testid="triage-start-mode-hint"
      >
        {t(
          "triage.help.springCleaningHint",
          "Spring cleaning is a more aggressive pass that suggests closing items you have not viewed in a while.",
        )}
      </Typography>
    </Stack>
  );
}
