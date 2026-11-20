import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogContent,
  DialogTitle,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { FunctionalDialog } from "@hey-hey/ui-common/components";
import {
  useProviderSessionTranscript,
  type ProviderSessionTranscriptTarget,
} from "@hey-hey/ui-common/data";

import { formatClaudeSession } from "./claudeSessionText";

const PROVIDER_IDS = ["claude", "codex", "opencode"] as const;

/** The provider recorded on the setup, when it is one the CLI can address. */
export const asTranscriptProviderId = (
  provider: string,
): ProviderSessionTranscriptTarget["providerId"] | null =>
  PROVIDER_IDS.find((id) => id === provider) ?? null;

/**
 * Opens a provider session's raw text on demand. The text is fetched each time
 * the dialog opens and is held only in this component's state.
 */
export const ReadSessionButton: React.FC<{
  target: ProviderSessionTranscriptTarget;
  testId: string;
}> = ({ target, testId }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { state, read, reset } = useProviderSessionTranscript();
  const [view, setView] = useState<"readable" | "raw">("readable");

  // Only Claude sessions can be read today, so the readable view is Claude's.
  const shown = (raw: string) =>
    view === "readable" ? formatClaudeSession(raw) : raw;

  const close = () => {
    setOpen(false);
    setView("readable");
    reset();
  };

  return (
    <>
      <Button
        size="small"
        data-testid={testId}
        onClick={() => {
          setOpen(true);
          void read(target);
        }}
      >
        {t("eval.results.sessions.readSession")}
      </Button>
      <FunctionalDialog
        open={open}
        onClose={close}
        fullScreen
        data-testid="eval-session-transcript-modal"
        closeControl={
          <IconButton onClick={close} size="small" aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        <DialogTitle>{t("eval.results.sessions.transcriptTitle")}</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          {(state.status === "idle" || state.status === "loading") && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={16} />
              {t("eval.results.sessions.transcriptLoading")}
            </Box>
          )}
          {state.status === "unavailable" && (
            <Alert
              severity="info"
              data-testid="eval-session-transcript-unavailable"
            >
              {t(`eval.results.sessions.unavailable.${state.reason}`)}
            </Alert>
          )}
          {state.status === "available" && (
            <>
              {state.truncated && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {t("eval.results.sessions.transcriptTruncated")}
                </Alert>
              )}
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={view}
                  onChange={(_event, next: "readable" | "raw" | null) => {
                    if (next) {
                      setView(next);
                    }
                  }}
                >
                  <ToggleButton
                    value="readable"
                    data-testid="eval-session-view-readable"
                  >
                    {t("eval.results.sessions.viewReadable")}
                  </ToggleButton>
                  <ToggleButton value="raw" data-testid="eval-session-view-raw">
                    {t("eval.results.sessions.viewRaw")}
                  </ToggleButton>
                </ToggleButtonGroup>
                <IconButton
                  size="small"
                  aria-label={t("eval.results.sessions.transcriptCopy")}
                  onClick={() =>
                    void navigator.clipboard.writeText(shown(state.text))
                  }
                >
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </Box>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                }}
                data-testid="eval-session-transcript-content"
              >
                {shown(state.text)}
              </Box>
            </>
          )}
        </DialogContent>
      </FunctionalDialog>
    </>
  );
};
