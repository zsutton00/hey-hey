import { Box, Typography } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { CASE_GRID_COLUMNS } from "./EvalCaseRow";
import { groupRepeatsBySetup } from "./evalResultsView";
import { setupLabel } from "./evalRunView";
import { RepeatSummaryRow } from "./RepeatSummaryRow";

export interface RepeatedCaseRowsProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempts: EvalAttemptReport[];
  /** The repeat the page's deep link names, if any. */
  selectedId: string | null;
  onSelect: (attemptId: string | null) => void;
}

const rowKey = (setupId: string, caseInputId: string): string =>
  `${setupId}|${caseInputId}`;

/** Each setup's cases, one row per case summarising its repeats. */
export const RepeatedCaseRows: React.FC<RepeatedCaseRowsProps> = ({
  organizationId,
  projectId,
  run,
  attempts,
  selectedId,
  onSelect,
}) => {
  const { t } = useTranslation();
  const setups = useMemo(
    () => groupRepeatsBySetup(projectId, run, attempts),
    [projectId, run, attempts],
  );
  const attemptsById = useMemo(
    () => new Map(attempts.map((attempt) => [attempt.id, attempt])),
    [attempts],
  );
  const selectedAttempt = selectedId ? attemptsById.get(selectedId) : undefined;
  const selectedKey = selectedAttempt
    ? rowKey(
        selectedAttempt.payload.configuration.id,
        selectedAttempt.payload.caseInputId,
      )
    : null;
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(selectedKey ? [selectedKey] : []),
  );

  // A deep link or a later selection opens the row its repeat belongs to.
  useEffect(() => {
    if (!selectedKey) return;
    setOpen((current) =>
      current.has(selectedKey) ? current : new Set(current).add(selectedKey),
    );
  }, [selectedKey]);

  const handleToggle = (key: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (open.has(key) && selectedKey === key) onSelect(null);
  };

  const headings = [
    "case",
    "recognition",
    "quality",
    "checks",
    "elapsed",
    "tokens",
    "toolCalls",
    "cost",
  ] as const;

  return (
    <Box data-testid="eval-results-cases">
      <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 0.5 }}>
        {t("eval.results.cases.title")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mb: 1 }}
        data-testid="eval-results-cases-help"
      >
        {t("eval.results.repeats.help")}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: CASE_GRID_COLUMNS,
          gap: 1,
          px: 1,
          pb: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {headings.map((heading, index) => (
          <Typography
            key={heading}
            variant="caption"
            color="text.secondary"
            sx={{ gridColumn: index + 2 }}
          >
            {t(`eval.results.cases.col.${heading}`)}
          </Typography>
        ))}
      </Box>
      {setups.map(({ configuration, cases }) => (
        <Box
          key={configuration.id}
          data-testid={`eval-results-cases-setup-${configuration.id}`}
        >
          <Typography
            variant="subtitle2"
            component="h3"
            sx={{ mt: 2, mb: 0.5 }}
          >
            {setupLabel(configuration.target)}
          </Typography>
          {cases.map((repeatedCase) => {
            const key = rowKey(configuration.id, repeatedCase.caseInputId);
            return (
              <RepeatSummaryRow
                key={key}
                organizationId={organizationId}
                projectId={projectId}
                run={run}
                setupId={configuration.id}
                repeatedCase={repeatedCase}
                attemptsById={attemptsById}
                expanded={open.has(key)}
                selectedAttemptId={selectedKey === key ? selectedId : null}
                onToggle={() => handleToggle(key)}
                onSelect={onSelect}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
};
