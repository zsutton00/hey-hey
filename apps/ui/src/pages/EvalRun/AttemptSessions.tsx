import { Box, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import { SpaLink } from "./SpaLink";

const SessionLink: React.FC<{
  projectId: string;
  agentSessionId: string;
  testId: string;
}> = ({ projectId, agentSessionId, testId }) => (
  <SpaLink
    href={WebPathService.agentSession({ projectId, agentSessionId })}
    testId={testId}
  >
    <code>{agentSessionId}</code>
  </SpaLink>
);

/**
 * Where to see what an attempt actually did: its own session, the run session
 * the judge ran inside, and the exact text the judge was given.
 */
export const AttemptSessions: React.FC<{
  projectId: string;
  run: EvalRunReport;
  attempt: EvalAttemptReport;
}> = ({ projectId, run, attempt }) => {
  const { t } = useTranslation();
  const { targetSessionId, judgedOutput } = attempt.payload;
  const { coordinatorAgentSessionId } = run.payload;

  return (
    <Box sx={{ mb: 2 }} data-testid="eval-attempt-sessions">
      <Typography variant="body2" component="div">
        <b>{t("eval.results.sessions.target")}:</b>{" "}
        {targetSessionId ? (
          <SessionLink
            projectId={projectId}
            agentSessionId={targetSessionId}
            testId="eval-attempt-session-target"
          />
        ) : (
          t("eval.results.sessions.noTarget")
        )}
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
        <b>{t("eval.results.sessions.judge")}:</b>{" "}
        {t("eval.results.sessions.judgeNote")}{" "}
        {coordinatorAgentSessionId && (
          <SessionLink
            projectId={projectId}
            agentSessionId={coordinatorAgentSessionId}
            testId="eval-attempt-session-run"
          />
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
