import { Box, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import { WebPathService } from "@hey-hey/ui-common/services";

import { SpaLink } from "./SpaLink";
import { formatElapsed, type RepeatCellView } from "./evalRunView";

export interface RepeatCellContentProps {
  projectId: string;
  /** The cell's own test id, so each line is findable within it. */
  cellTestId: string;
  view: RepeatCellView;
}

/** One case and setup's progress through its repeats while the run is going. */
export const RepeatCellContent: React.FC<RepeatCellContentProps> = ({
  projectId,
  cellTestId,
  view,
}) => {
  const { t } = useTranslation();
  const unavailable = t("eval.run.cell.elapsedUnavailable");

  if (view.ended === 0 && view.running.length === 0) {
    return <>{t("eval.run.cell.repeatsQueued", { count: view.total })}</>;
  }

  const progress = [
    t("eval.run.cell.repeatsEnded", { ended: view.ended, total: view.total }),
    view.running.length > 0
      ? t("eval.run.cell.repeatsRunning", { count: view.running.length })
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <>
      <Box data-testid={`${cellTestId}-progress`}>{progress}</Box>
      {view.running.map((running) => {
        const status = t("eval.run.cell.running", {
          elapsed:
            running.elapsedMs === null
              ? unavailable
              : formatElapsed(running.elapsedMs),
        });
        return (
          <Typography
            key={running.repeat}
            variant="caption"
            component="div"
            color="text.secondary"
          >
            {t("eval.run.cell.repeatRunning", {
              repeat: running.repeat,
              status: running.phase
                ? `${status} · ${t(`eval.run.cell.phase.${running.phase}`)}`
                : status,
            })}
          </Typography>
        );
      })}
      {view.assessed > 0 && (
        <Typography
          variant="caption"
          component="div"
          data-testid={`${cellTestId}-correct`}
        >
          {t("eval.run.cell.correctSoFar", {
            correct: view.correct,
            assessed: view.assessed,
          })}
        </Typography>
      )}
      {view.stopped.map((stopped) => (
        <Typography
          key={stopped.repeat}
          variant="caption"
          component="div"
          color="warning.main"
        >
          {t("eval.run.cell.repeatDetail", {
            repeat: stopped.repeat,
            detail: t(`eval.run.cell.stopped.${stopped.stop.reason}`, {
              limit: stopped.stop.limit ?? t("eval.run.cell.recordedLimit"),
            }),
          })}
        </Typography>
      ))}
      {view.errored.map((errored) => (
        <Typography
          key={errored.repeat}
          variant="caption"
          component="div"
          color="error"
        >
          {t("eval.run.cell.repeatDetail", {
            repeat: errored.repeat,
            detail: errored.message
              ? t("eval.run.cell.error", { message: errored.message })
              : t("eval.run.cell.errorNoMessage"),
          })}
          {errored.sessionId && (
            <Box>
              <SpaLink
                href={WebPathService.agentSession({
                  projectId,
                  agentSessionId: errored.sessionId,
                })}
                testId={`${cellTestId}-open-session-${errored.repeat}`}
              >
                {t("eval.run.cell.openSession")}
              </SpaLink>
            </Box>
          )}
        </Typography>
      ))}
    </>
  );
};
