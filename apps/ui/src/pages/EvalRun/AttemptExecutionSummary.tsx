import { Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import { EvalTargetHandlerKey } from "@hey-hey/ui-common/api";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

/**
 * What the attempt actually ran and which output was assessed, as recorded at
 * launch. Attempts recorded before run-level handler selection show nothing.
 */
export const AttemptExecutionSummary: React.FC<{
  attempt: EvalAttemptReport;
}> = ({ attempt }) => {
  const { t } = useTranslation();
  const { execution } = attempt.payload;
  if (!execution) return null;

  const projectAssistant =
    execution.handler === EvalTargetHandlerKey.ProjectAssistant
      ? "eval.results.attempt.projectAssistantAlone"
      : execution.projectAssistantPrepares
        ? "eval.results.attempt.projectAssistantPrepared"
        : "eval.results.attempt.projectAssistantNotUsed";

  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ mb: 2 }}
      data-testid="eval-attempt-execution"
    >
      {t("eval.results.attempt.ran", {
        handler: t(`eval.run.handler.${execution.handler}`),
        projectAssistant: t(projectAssistant),
        output: t(`eval.results.attempt.assessed.${execution.assessedOutput}`),
      })}
    </Typography>
  );
};
