import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptTurn } from "@hey-hey/contracts/api";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

import { formatCost, formatElapsed, formatTokenCount } from "./evalRunView";

const measurementText = (
  turn: EvalAttemptTurn,
  t: (key: string) => string,
): string => {
  const measurement = turn.measurement;
  if (!measurement) {
    return t("eval.results.turns.unavailable");
  }
  const parts: string[] = [];
  if (measurement.elapsedMs !== undefined) {
    parts.push(formatElapsed(measurement.elapsedMs));
  }
  if (
    measurement.inputTokens !== undefined &&
    measurement.outputTokens !== undefined
  ) {
    parts.push(
      `${formatTokenCount(measurement.inputTokens)} / ${formatTokenCount(measurement.outputTokens)}`,
    );
  }
  if (measurement.cost && measurement.cost.state !== "unavailable") {
    parts.push(formatCost(measurement.cost.amount));
  }
  const text =
    parts.length > 0 ? parts.join(" · ") : t("eval.results.turns.unavailable");

  return turn.measurementPartial
    ? `${text} ${t("eval.results.turns.partial")}`
    : text;
};

/**
 * How far a scripted conversation ran: the messages planned against the ones
 * started and finished, each message's own measurements, and which one was
 * judged. Attempts recorded without turns ran only their final message and
 * show nothing here.
 */
export const AttemptTurns: React.FC<{
  attempt: EvalAttemptReport;
  /** How many messages the case's frozen inputs hold. */
  plannedMessages: number;
}> = ({ attempt, plannedMessages }) => {
  const { t } = useTranslation();
  const { turns, judgedTurnIndex } = attempt.payload;
  if (!turns || turns.length === 0) {
    return null;
  }
  const completed = turns.filter((turn) => turn.state === "COMPLETED").length;

  return (
    <Box sx={{ mb: 2 }} data-testid="eval-attempt-turns">
      <Typography variant="subtitle2">
        {t("eval.results.turns.title")}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="eval-attempt-turns-progress"
      >
        {t("eval.results.turns.progress", {
          started: turns.length,
          completed,
          planned: plannedMessages,
        })}{" "}
        {judgedTurnIndex !== undefined
          ? t("eval.results.turns.judged", { message: judgedTurnIndex + 1 })
          : t("eval.results.turns.notJudged")}
      </Typography>
      <Table size="small">
        <TableBody>
          {turns.map((turn) => (
            <TableRow
              key={turn.index}
              data-testid={`eval-attempt-turn-${turn.index}`}
            >
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {t("eval.results.turns.message", { message: turn.index + 1 })}
                {turn.index === judgedTurnIndex && (
                  <Chip
                    size="small"
                    sx={{ ml: 1 }}
                    label={t("eval.case.inputs.judged")}
                  />
                )}
              </TableCell>
              <TableCell>
                {t(`eval.results.turns.state.${turn.state}`)}
              </TableCell>
              <TableCell>{measurementText(turn, t)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};
