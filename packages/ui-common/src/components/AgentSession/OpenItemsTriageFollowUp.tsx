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
      spacing={1}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label={t("triage.followUp", "Follow-up message")}
        placeholder={t(
          "triage.followUpPlaceholder",
          "Ask a question or describe what you want to keep…"
        )}
        multiline
        minRows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled || pending}
        slotProps={{ htmlInput: { "data-testid": "triage-follow-up" } }}
      />
      <Button
        type="submit"
        data-testid="triage-send"
        disabled={disabled || pending || !draft.trim()}
        sx={{ alignSelf: "flex-end" }}
      >
        {t("common.send", "Send")}
      </Button>
    </Stack>
  );
}
