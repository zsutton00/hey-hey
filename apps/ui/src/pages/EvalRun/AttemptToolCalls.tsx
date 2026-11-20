import { Box, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

/** The tool calls the tested agent made, kept with the attempt. Results are never kept. */
export const AttemptToolCalls: React.FC<{ attempt: EvalAttemptReport }> = ({
  attempt,
}) => {
  const { t } = useTranslation();
  const recorded = attempt.payload.recordedToolCalls;
  // Attempts recorded before tool calls were kept have nothing to show.
  if (!recorded) {
    return null;
  }

  return (
    <Box sx={{ mb: 2 }} data-testid="eval-attempt-tool-calls">
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {t("eval.results.toolCalls.title")}
      </Typography>
      {recorded.state === "UNAVAILABLE" ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="eval-tool-calls-unavailable"
        >
          {t("eval.results.toolCalls.unavailable")}
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {recorded.calls.map((call, index) => (
            <Box
              key={index}
              component="details"
              data-testid="eval-tool-call"
              sx={{ typography: "body2" }}
            >
              <summary>
                {index + 1}. {call.toolName}
                {call.truncated &&
                  ` (${t("eval.results.toolCalls.truncated")})`}
              </summary>
              <Box
                component="pre"
                data-testid="eval-tool-call-arguments"
                sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {call.arguments ?? ""}
              </Box>
            </Box>
          ))}
          {recorded.omittedCalls !== undefined && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="eval-tool-calls-omitted"
            >
              {t("eval.results.toolCalls.omitted", {
                count: recorded.omittedCalls,
              })}
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
};
