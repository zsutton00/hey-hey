import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import React, { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { RepeatRow, RowMeasure } from "./evalResultsView";
import { formatCost, formatElapsed, formatTokenCount } from "./evalRunView";
import { SpaLink } from "./SpaLink";
import { formatCount, type Format } from "./useResultFormatters";

export interface RepeatListProps {
  repeats: readonly RepeatRow[];
  selectedAttemptId: string | null;
  /** Selects a repeat, or null to collapse the selected one. */
  onSelect: (attemptId: string | null) => void;
  /** The specifics shown inside the selected repeat's collapsible section. */
  renderDetail: (repeat: RepeatRow) => ReactNode;
}

/** Every repeat of one case and setup as a collapsible section that opens to its specifics. */
export const RepeatList: React.FC<RepeatListProps> = ({
  repeats,
  selectedAttemptId,
  onSelect,
  renderDetail,
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
          <TableCell padding="checkbox" />
          {columns.map((column) => (
            <TableCell key={column}>{column}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {repeats.map((entry) => {
          const { repeat, row, weak } = entry;
          const selected = row.attemptId === selectedAttemptId;
          const ended = row.errored || row.stopped;
          const recognition = row.errored
            ? t("eval.results.cases.errored")
            : row.stopped
              ? t("eval.results.repeats.stopped")
              : t(`eval.results.recognition.${row.recognition}`);
          const handleToggle = (): void =>
            onSelect(selected ? null : row.attemptId);
          return (
            <Fragment key={row.attemptId}>
              <TableRow
                hover
                selected={selected}
                onClick={handleToggle}
                title={weak ? t("eval.results.repeats.weak") : undefined}
                data-testid={`eval-repeat-row-${row.attemptId}`}
                data-weak={weak}
                sx={{
                  cursor: "pointer",
                  bgcolor: weak ? "warning.50" : undefined,
                }}
              >
                <TableCell padding="checkbox">
                  <IconButton
                    size="small"
                    aria-expanded={selected}
                    aria-label={t(
                      selected
                        ? "eval.results.repeats.collapse"
                        : "eval.results.repeats.expand",
                      { repeat },
                    )}
                    data-testid={`eval-repeat-toggle-${row.attemptId}`}
                  >
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: selected ? "none" : "rotate(-90deg)" }}
                    />
                  </IconButton>
                </TableCell>
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
                <TableCell>
                  {formatMeasure(row.toolCalls, formatCount)}
                </TableCell>
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
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  sx={{ p: 0, borderBottom: selected ? undefined : 0 }}
                >
                  <Collapse in={selected} timeout="auto" unmountOnExit>
                    {renderDetail(entry)}
                  </Collapse>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
};
