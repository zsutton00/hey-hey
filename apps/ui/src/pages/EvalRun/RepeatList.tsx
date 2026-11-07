import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { RepeatRow, RowMeasure } from "./evalResultsView";
import { formatCost, formatElapsed, formatTokenCount } from "./evalRunView";
import { SpaLink } from "./SpaLink";
import { formatCount, type Format } from "./useResultFormatters";

export interface RepeatListProps {
  repeats: readonly RepeatRow[];
  selectedAttemptId: string | null;
  onSelect: (attemptId: string) => void;
}

/** Every repeat of one case and setup on its own line; selecting one opens its specifics. */
export const RepeatList: React.FC<RepeatListProps> = ({
  repeats,
  selectedAttemptId,
  onSelect,
}) => {
  const { t } = useTranslation();
  const notReported = t("eval.results.notReported");
  const formatMeasure = (measure: RowMeasure, format: Format): string => {
    if (measure.value === null) return notReported;
    const value = format(measure.value);
    return measure.partial ? t("eval.results.cases.partial", { value }) : value;
  };
  const columns = [
    t("eval.results.repeats.col.repeat"),
    t("eval.results.cases.col.recognition"),
    t("eval.results.cases.col.quality"),
    t("eval.results.cases.col.checks"),
    t("eval.results.cases.col.elapsed"),
    t("eval.results.cases.col.tokens"),
    t("eval.results.cases.col.toolCalls"),
    t("eval.results.cases.col.cost"),
    t("eval.results.repeats.col.session"),
  ];

  return (
    <Table size="small" data-testid="eval-repeat-list">
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableCell key={column}>{column}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {repeats.map(({ repeat, row, weak }) => {
          const selected = row.attemptId === selectedAttemptId;
          const ended = row.errored || row.stopped;
          const recognition = row.errored
            ? t("eval.results.cases.errored")
            : row.stopped
              ? t("eval.results.repeats.stopped")
              : t(`eval.results.recognition.${row.recognition}`);
          return (
            <TableRow
              key={row.attemptId}
              hover
              selected={selected}
              onClick={() => onSelect(row.attemptId)}
              aria-label={t("eval.results.repeats.select", { repeat })}
              title={weak ? t("eval.results.repeats.weak") : undefined}
              data-testid={`eval-repeat-row-${row.attemptId}`}
              data-weak={weak}
              sx={{
                cursor: "pointer",
                bgcolor: weak ? "warning.50" : undefined,
              }}
            >
              <TableCell>
                {t("eval.results.repeats.label", { repeat })}
              </TableCell>
              <TableCell>{recognition}</TableCell>
              <TableCell>
                {ended || row.quality === null
                  ? ended
                    ? "—"
                    : notReported
                  : row.quality.toFixed(1)}
              </TableCell>
              <TableCell>
                {ended
                  ? "—"
                  : row.checks === null || row.checks.total === 0
                    ? notReported
                    : `${row.checks.passed} / ${row.checks.total}`}
              </TableCell>
              <TableCell>
                {formatMeasure(row.elapsedMs, formatElapsed)}
              </TableCell>
              <TableCell>
                {formatMeasure(row.tokens, formatTokenCount)}
              </TableCell>
              <TableCell>{formatMeasure(row.toolCalls, formatCount)}</TableCell>
              <TableCell>{formatMeasure(row.cost, formatCost)}</TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                {row.sessionHref ? (
                  <SpaLink
                    href={row.sessionHref}
                    testId={`eval-repeat-open-session-${row.attemptId}`}
                  >
                    {t("eval.results.repeats.openSession")}
                  </SpaLink>
                ) : (
                  t("eval.results.cases.noSession")
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
