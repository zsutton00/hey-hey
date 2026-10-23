import { Box, Typography } from "@mui/material";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { progressEntries, setupLabel, type ProgressEntry } from "./evalRunView";

const formatClock = (at: string): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export interface ProgressListProps {
  run: EvalRunReport;
  attempts: readonly EvalAttemptReport[];
}

/**
 * Logs each attempt starting and ending. The runner is a fixed procedure that
 * writes no narration, so the attempts' own state changes are the record.
 */
export const ProgressList: React.FC<ProgressListProps> = ({
  run,
  attempts,
}) => {
  const { t } = useTranslation();
  const { cases, settings } = run.payload;
  const entries = useMemo(
    () => progressEntries(attempts, settings),
    [attempts, settings],
  );
  const caseTitles = useMemo(
    () => new Map(cases.map((caseInput) => [caseInput.id, caseInput.title])),
    [cases],
  );

  const describe = (entry: ProgressEntry): string => {
    const values = {
      setup: setupLabel(entry.attempt.payload.configuration.target),
      case:
        caseTitles.get(entry.attempt.payload.caseInputId) ??
        entry.attempt.payload.caseInputId,
    };
    switch (entry.kind) {
      case "started":
        return t("eval.run.progress.started", values);
      case "finished":
        return t("eval.run.progress.finished", values);
      case "error":
        return entry.message
          ? t("eval.run.progress.error", { ...values, message: entry.message })
          : t("eval.run.progress.errorNoMessage", values);
      case "stopped":
        return t(`eval.run.progress.stopped.${entry.stop.reason}`, {
          ...values,
          limit: entry.stop.limit ?? t("eval.run.cell.recordedLimit"),
        });
    }
  };

  return (
    <Box
      data-testid="eval-run-progress"
      sx={{ mt: 3, borderLeft: 3, borderColor: "divider", pl: 2 }}
    >
      <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
        {t("eval.run.progress.title")}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("eval.run.progress.empty")}
        </Typography>
      ) : (
        <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {entries.map((entry) => (
            <Box
              component="li"
              key={`${entry.attempt.id}-${entry.kind === "started" ? "start" : "end"}`}
              data-testid={`eval-run-progress-${entry.kind}-${entry.attempt.id}`}
              sx={{ py: 0.25 }}
            >
              <Typography variant="body2">
                <Box
                  component="time"
                  dateTime={entry.at}
                  sx={{ color: "text.secondary", mr: 1 }}
                >
                  {formatClock(entry.at)}
                </Box>
                {describe(entry)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
