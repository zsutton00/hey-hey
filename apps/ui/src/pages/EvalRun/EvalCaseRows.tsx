import { Box, Typography } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { CASE_GRID_COLUMNS, EvalCaseRow } from "./EvalCaseRow";
import { groupCasesBySetup } from "./evalResultsView";
import { setupLabel } from "./evalRunView";

export interface EvalCaseRowsProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempts: EvalAttemptReport[];
  /** The attempt the page's deep link names, if any. */
  selectedId: string | null;
  onSelect: (attemptId: string | null) => void;
}

/** Each setup's cases, one expandable row per case attempt. */
export const EvalCaseRows: React.FC<EvalCaseRowsProps> = ({
  organizationId,
  projectId,
  run,
  attempts,
  selectedId,
  onSelect,
}) => {
  const { t } = useTranslation();
  const setups = useMemo(
    () => groupCasesBySetup(projectId, run, attempts),
    [projectId, run, attempts],
  );
  const attemptsById = useMemo(
    () => new Map(attempts.map((attempt) => [attempt.id, attempt])),
    [attempts],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(selectedId ? [selectedId] : []),
  );

  // A deep link or a later change to the selection opens that attempt's row.
  useEffect(() => {
    if (!selectedId) return;
    setOpen((current) =>
      current.has(selectedId) ? current : new Set(current).add(selectedId),
    );
  }, [selectedId]);

  const handleToggle = (attemptId: string): void => {
    if (open.has(attemptId)) {
      setOpen((current) => {
        const next = new Set(current);
        next.delete(attemptId);
        return next;
      });
      if (selectedId === attemptId) onSelect(null);
      return;
    }
    setOpen((current) => new Set(current).add(attemptId));
    onSelect(attemptId);
  };

  const headings = [
    "case",
    "recognition",
    "quality",
    "checks",
    "elapsed",
    "tokens",
    "toolCalls",
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
        {t("eval.results.cases.help")}
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
      {setups.map(({ configuration, rows }) => (
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
          {rows.map((row) => {
            const attempt = attemptsById.get(row.attemptId);
            if (!attempt) return null;
            return (
              <EvalCaseRow
                key={row.attemptId}
                organizationId={organizationId}
                projectId={projectId}
                run={run}
                attempt={attempt}
                row={row}
                expanded={open.has(row.attemptId)}
                selected={row.attemptId === selectedId}
                onToggle={handleToggle}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
};
