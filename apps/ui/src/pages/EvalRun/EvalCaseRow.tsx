import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, Collapse, IconButton, Typography } from "@mui/material";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { EvalCaseDetail } from "./EvalCaseDetail";
import type { CaseRow, RowMeasure } from "./evalResultsView";
import { formatElapsed, formatTokenCount } from "./evalRunView";
import { SpaLink } from "./SpaLink";

/** Name, recognition, quality, checks, elapsed, tokens, tool calls. */
export const CASE_GRID_COLUMNS = "32px 3fr 1.3fr .7fr .7fr .8fr .9fr .8fr";

const formatCount = (value: number): string => String(Math.round(value));

const useRowMeasureFormatter = (): ((
  measure: RowMeasure,
  format: (value: number) => string,
) => string) => {
  const { t } = useTranslation();
  return (measure, format) => {
    if (measure.value === null) return t("eval.results.notReported");
    const value = format(measure.value);
    return measure.partial ? t("eval.results.cases.partial", { value }) : value;
  };
};

export interface EvalCaseRowProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempt: EvalAttemptReport;
  row: CaseRow;
  expanded: boolean;
  /** The attempt the page's deep link names. */
  selected: boolean;
  onToggle: (attemptId: string) => void;
}

export const EvalCaseRow: React.FC<EvalCaseRowProps> = ({
  organizationId,
  projectId,
  run,
  attempt,
  row,
  expanded,
  selected,
  onToggle,
}) => {
  const { t } = useTranslation();
  const formatMeasure = useRowMeasureFormatter();
  const containerRef = useRef<HTMLDivElement>(null);
  const notReported = t("eval.results.notReported");
  const title = row.title ?? t("eval.results.cases.unknownCase");

  useEffect(() => {
    if (selected) containerRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const recognitionText =
    row.recognition === "pending"
      ? t("eval.results.recognition.pending")
      : t(`eval.results.recognition.${row.recognition}`);

  return (
    <Box
      ref={containerRef}
      sx={{
        border: 1,
        borderColor: selected ? "primary.main" : "divider",
        borderRadius: 1,
        my: 0.5,
        bgcolor: row.errored ? "error.50" : "background.paper",
      }}
      data-testid={`eval-case-row-${row.attemptId}`}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: CASE_GRID_COLUMNS,
          gap: 1,
          alignItems: "center",
          px: 1,
          py: 0.75,
        }}
      >
        <IconButton
          size="small"
          onClick={() => onToggle(row.attemptId)}
          aria-expanded={expanded}
          aria-label={t(
            expanded
              ? "eval.results.cases.collapse"
              : "eval.results.cases.expand",
            { case: title },
          )}
          data-testid={`eval-case-toggle-${row.attemptId}`}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: expanded ? "none" : "rotate(-90deg)" }}
          />
        </IconButton>
        {row.sessionHref ? (
          <SpaLink
            href={row.sessionHref}
            testId={`eval-case-link-${row.attemptId}`}
            sx={{ fontWeight: 600 }}
          >
            {title}
          </SpaLink>
        ) : (
          <Typography
            variant="body2"
            sx={{ fontWeight: 600 }}
            title={t("eval.results.cases.noSession")}
            data-testid={`eval-case-name-${row.attemptId}`}
          >
            {title}
          </Typography>
        )}
        {row.errored ? (
          <Typography
            variant="body2"
            color="error"
            data-testid={`eval-case-errored-${row.attemptId}`}
          >
            {t("eval.results.cases.errored")}
          </Typography>
        ) : (
          <Typography
            variant="body2"
            data-testid={`eval-case-recognition-${row.attemptId}`}
          >
            {recognitionText}
          </Typography>
        )}
        <Typography
          variant="body2"
          data-testid={`eval-case-quality-${row.attemptId}`}
        >
          {row.errored
            ? "—"
            : row.quality === null
              ? notReported
              : row.quality.toFixed(1)}
        </Typography>
        <Typography
          variant="body2"
          color={
            row.checks !== null && row.checks.passed < row.checks.total
              ? "error"
              : undefined
          }
          data-testid={`eval-case-checks-${row.attemptId}`}
        >
          {row.errored
            ? "—"
            : row.checks === null || row.checks.total === 0
              ? notReported
              : `${row.checks.passed} / ${row.checks.total}`}
        </Typography>
        <Typography
          variant="body2"
          data-testid={`eval-case-elapsed-${row.attemptId}`}
        >
          {formatMeasure(row.elapsedMs, formatElapsed)}
        </Typography>
        <Typography
          variant="body2"
          data-testid={`eval-case-tokens-${row.attemptId}`}
        >
          {formatMeasure(row.tokens, formatTokenCount)}
        </Typography>
        <Typography
          variant="body2"
          data-testid={`eval-case-tool-calls-${row.attemptId}`}
        >
          {formatMeasure(row.toolCalls, formatCount)}
        </Typography>
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ borderTop: 1, borderColor: "divider" }}>
          <EvalCaseDetail
            organizationId={organizationId}
            projectId={projectId}
            run={run}
            attempt={attempt}
            row={row}
          />
        </Box>
      </Collapse>
    </Box>
  );
};
