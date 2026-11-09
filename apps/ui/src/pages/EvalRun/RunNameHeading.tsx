import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  evalRunName,
  useRenameEvalRun,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";

export interface RunNameHeadingProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
}

/** A run's name as the page title, renamable while the run is going and after it ended. */
export const RunNameHeading: React.FC<RunNameHeadingProps> = ({
  organizationId,
  projectId,
  run,
}) => {
  const { t } = useTranslation();
  const rename = useRenameEvalRun();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = evalRunName(run, t);

  const handleSave = async () => {
    if (draft === null) return;
    setError(null);
    try {
      await rename.mutate({ organizationId, projectId, run, name: draft });
      setDraft(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleCancel = () => {
    setDraft(null);
    setError(null);
  };

  if (draft === null) {
    return (
      <Box
        sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 1 }}
        data-testid="eval-run-name"
      >
        <Typography variant="h4" component="h1" data-testid="eval-run-title">
          {name}
        </Typography>
        <Button
          size="small"
          onClick={() => setDraft(run.payload.name ?? "")}
          data-testid="eval-run-rename"
        >
          {t("eval.run.rename.action")}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 1 }} data-testid="eval-run-name">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <TextField
          size="small"
          autoFocus
          label={t("eval.run.rename.label")}
          placeholder={name}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={rename.isPending}
          slotProps={{ htmlInput: { "data-testid": "eval-run-rename-input" } }}
          sx={{ minWidth: 360 }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => void handleSave()}
          disabled={rename.isPending}
          data-testid="eval-run-rename-save"
        >
          {t("eval.run.rename.save")}
        </Button>
        <Button
          size="small"
          onClick={handleCancel}
          disabled={rename.isPending}
          data-testid="eval-run-rename-cancel"
        >
          {t("eval.run.rename.cancel")}
        </Button>
      </Box>
      {error && (
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          data-testid="eval-run-rename-error"
        >
          {t("eval.run.rename.error", { message: error })}
        </Alert>
      )}
    </Box>
  );
};
