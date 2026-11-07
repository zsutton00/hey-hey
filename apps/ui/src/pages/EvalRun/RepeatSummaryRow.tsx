import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, Collapse, IconButton, Typography } from "@mui/material";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { CASE_GRID_COLUMNS } from "./EvalCaseRow";
import { EvalCaseDetail } from "./EvalCaseDetail";
import type { ExcludedRepeat, RepeatedCase } from "./evalResultsView";
import { formatCost, formatElapsed, formatTokenCount } from "./evalRunView";
import { RepeatList } from "./RepeatList";
import { SpaLink } from "./SpaLink";
import {
  formatCount,
  useMeasureFormatter,
  useQualityFormatter,
} from "./useResultFormatters";

export interface RepeatSummaryRowProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  setupId: string;
  repeatedCase: RepeatedCase;
  attemptsById: ReadonlyMap<string, EvalAttemptReport>;
  expanded: boolean;
  /** The repeat the page's deep link names, when it belongs to this case and setup. */
  selectedAttemptId: string | null;
  onToggle: () => void;
  onSelect: (attemptId: string) => void;
}

/** One case under one setup, summarised over its repeats, expanding to each repeat. */
export const RepeatSummaryRow: React.FC<RepeatSummaryRowProps> = ({
  organizationId,
  projectId,
  run,
  setupId,
  repeatedCase,
  attemptsById,
  expanded,
  selectedAttemptId,
  onToggle,
  onSelect,
}) => {
  const { t } = useTranslation();
  const formatMeasure = useMeasureFormatter();
  const formatQuality = useQualityFormatter();
  const containerRef = useRef<HTMLDivElement>(null);
  const { summary, repeats } = repeatedCase;
  const notReported = t("eval.results.notReported");
  const title = repeatedCase.title ?? t("eval.results.cases.unknownCase");
  const testId = `eval-repeat-case-${setupId}-${repeatedCase.caseInputId}`;
  const selected = repeats.find(
    ({ row }) => row.attemptId === selectedAttemptId,
  );
  const selectedAttempt = selected
    ? attemptsById.get(selected.row.attemptId)
    : undefined;
  const firstRow = repeats[0]?.row;
  const excludedNames = [
    ...summary.errored.map((entry: ExcludedRepeat) =>
      entry.message
        ? t("eval.results.repeats.excludedError", {
            repeat: entry.repeat,
            message: entry.message,
          })
        : t("eval.results.repeats.excludedErrorNoMessage", {
            repeat: entry.repeat,
          }),
    ),
    ...summary.stopped.map((entry: ExcludedRepeat) =>
      t("eval.results.repeats.excludedStopped", {
        repeat: entry.repeat,
        reason: t(
          `eval.results.repeats.stopReason.${entry.stopReason ?? "USER"}`,
        ),
      }),
    ),
  ];

  useEffect(() => {
    if (selected) containerRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  return (
    <Box
      ref={containerRef}
      sx={{
        border: 1,
        borderColor: selected ? "primary.main" : "divider",
        borderRadius: 1,
        my: 0.5,
        bgcolor: "background.paper",
      }}
      data-testid={testId}
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
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={t(
            expanded
              ? "eval.results.cases.collapse"
              : "eval.results.cases.expand",
            { case: title },
          )}
          data-testid={`${testId}-toggle`}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: expanded ? "none" : "rotate(-90deg)" }}
          />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-recognition`}>
          {summary.recognition.assessed === 0
            ? notReported
            : t("eval.results.repeats.correct", summary.recognition)}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-quality`}>
          {formatQuality(summary.quality)}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-checks`}>
          {summary.checks.total === 0
            ? notReported
            : `${summary.checks.passed} / ${summary.checks.total}`}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-elapsed`}>
          {formatMeasure(summary.elapsedMs, formatElapsed)}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-tokens`}>
          {formatMeasure(summary.tokens, formatTokenCount)}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-tool-calls`}>
          {formatMeasure(summary.toolCalls, formatCount)}
        </Typography>
        <Typography variant="body2" data-testid={`${testId}-cost`}>
          {formatMeasure(summary.cost, formatCost)}
        </Typography>
      </Box>
      {excludedNames.length > 0 && (
        <Typography
          variant="caption"
          color="error"
          component="p"
          sx={{ px: 1, pb: 0.75, pl: 6 }}
          data-testid={`${testId}-excluded`}
        >
          {`${excludedNames.join(" · ")} · ${t("eval.results.repeats.leftOut")}`}
        </Typography>
      )}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ borderTop: 1, borderColor: "divider", p: 2 }}>
          {firstRow && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                <b>{t("eval.results.detail.expected")}:</b>{" "}
                {firstRow.expectation ?? t("eval.results.detail.noExpectation")}
              </Typography>
              {firstRow.evalCaseHref && (
                <Box sx={{ mt: 0.5 }}>
                  <SpaLink
                    href={firstRow.evalCaseHref}
                    testId={`${testId}-open-case`}
                  >
                    {t("eval.results.detail.openEvalCase")}
                  </SpaLink>
                </Box>
              )}
            </Box>
          )}
          <RepeatList
            repeats={repeats}
            selectedAttemptId={selected?.row.attemptId ?? null}
            onSelect={onSelect}
          />
          {selected && selectedAttempt && (
            <Box sx={{ mt: 2, borderTop: 1, borderColor: "divider" }}>
              <EvalCaseDetail
                organizationId={organizationId}
                projectId={projectId}
                run={run}
                attempt={selectedAttempt}
                row={selected.row}
                repeat={selected.repeat}
              />
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};
