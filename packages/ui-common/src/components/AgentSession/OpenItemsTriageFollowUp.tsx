import { Button, Stack, TextField } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface OpenItemsTriageFollowUpProps {
  pending: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
}
export function OpenItemsTriageFollowUp({
  pending,
  disabled,
  onSend,
}: OpenItemsTriageFollowUpProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const submit = async () => {
    const text = draft.trim();
    if (!text || pending || disabled) return;
    try {
      await onSend(text);
      setDraft((current) => (current === draft ? "" : current));
    } catch {
      // The runtime owns the error; keep the user's input for retry.
    }
  };
  return (
    <Stack
      component="form"
      direction="row"
      spacing={1}
      alignItems="flex-start"
      sx={{ flexShrink: 0 }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label={t("triage.followUp", "Follow-up message")}
        placeholder={t(
          "triage.followUpPlaceholder",
          "Ask a question or describe what you want to keep…",
        )}
        multiline
        size="small"
        fullWidth
        minRows={1}
        maxRows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled || pending}
        slotProps={{ htmlInput: { "data-testid": "triage-follow-up" } }}
      />
      <Button
        type="submit"
        data-testid="triage-send"
        disabled={disabled || pending || !draft.trim()}
        sx={{ mt: 0.25 }}
      >
        {t("common.send", "Send")}
      </Button>
    </Stack>
  );
}
