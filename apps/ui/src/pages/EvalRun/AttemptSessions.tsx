import { Box, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport } from "@hey-hey/ui-common/data";
export const AttemptSessions: React.FC<{
  attempt: EvalAttemptReport;
}> = ({ attempt }) => {
  const { t } = useTranslation();
  const { judgedOutput, judgeProviderSessionId } = attempt.payload;
  const attemptIds = (attempt.payload.attemptProviderSessionIds ?? []).filter(
    (id) => !id.startsWith("pending_"),
  );
  const judgeId =
    judgeProviderSessionId && !judgeProviderSessionId.startsWith("pending_")
      ? judgeProviderSessionId
      : null;

  return (
    <Box sx={{ mb: 2 }} data-testid="eval-attempt-sessions">
      <Typography variant="subtitle2">
        {t("eval.results.sessions.info")}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        data-testid="eval-attempt-provider-ids"
      >
        <b>{t("eval.results.sessions.attemptProvider")}:</b>{" "}
        {attemptIds.length
          ? attemptIds.map((id) => (
              <Box
                component="code"
                key={id}
                sx={{ display: "block", userSelect: "all" }}
              >
                {id}
              </Box>
            ))
          : t("eval.results.notReported")}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        data-testid="eval-judge-provider-id"
      >
        <b>{t("eval.results.sessions.judgeProvider")}:</b>{" "}
        {judgeId ? (
          <Box component="code" sx={{ userSelect: "all" }}>
            {judgeId}
          </Box>
        ) : (
          t("eval.results.notReported")
        )}
      </Typography>
      {judgedOutput ? (
        <Box
          component="details"
          sx={{ mt: 0.5 }}
          data-testid="eval-attempt-judged-output"
        >
          <Typography variant="body2" component="summary">
            {t("eval.results.sessions.judged", { count: judgedOutput.length })}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              mt: 0.5,
              p: 1,
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              bgcolor: "action.hover",
              borderRadius: 1,
              fontSize: "0.8rem",
            }}
          >
            {judgedOutput}
          </Box>
        </Box>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5 }}
          data-testid="eval-attempt-judged-none"
        >
          {t("eval.results.sessions.judgedNone")}
        </Typography>
      )}
    </Box>
  );
};
