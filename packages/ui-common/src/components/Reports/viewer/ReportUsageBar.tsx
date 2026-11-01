import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import React, { useId, useState } from "react";
import {
  ReportUsageCacheAvailability,
  ReportUsageCoverage,
  type ReportUsageFigures,
  type ReportUsageMeasurement,
} from "../../../api";

const UNAVAILABLE = "unavailable";

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatFigure = (value: number | null): string =>
  value === null ? UNAVAILABLE : compactFormatter.format(value);

const cachedTokens = (figures: ReportUsageFigures): number | null => {
  const { cacheReadInputTokens, cacheCreationInputTokens } = figures;

  if (cacheReadInputTokens === null) {
    return cacheCreationInputTokens;
  }

  if (cacheCreationInputTokens === null) {
    return cacheReadInputTokens;
  }

  return cacheReadInputTokens + cacheCreationInputTokens;
};

const describeInput = (figures: ReportUsageFigures): string => {
  const input = `In ${formatFigure(figures.inputTokens)}`;

  if (figures.cacheAvailability === ReportUsageCacheAvailability.Unreported) {
    return `${input} (cached ${UNAVAILABLE})`;
  }

  return `${input} (incl. ${formatFigure(cachedTokens(figures))} cached)`;
};

const describeToolCalls = (toolCalls: number | null): string =>
  toolCalls === null
    ? `Tool calls ${UNAVAILABLE}`
    : `${compactFormatter.format(toolCalls)} tool calls`;

const describeUsage = (usage: ReportUsageMeasurement): string =>
  [
    describeInput(usage),
    `Out ${formatFigure(usage.outputTokens)}`,
    describeToolCalls(usage.toolCalls),
  ].join(" · ");

export interface ReportUsageBarProps {
  usage: ReportUsageMeasurement | null;
}

export const ReportUsageBar: React.FC<ReportUsageBarProps> = ({ usage }) => {
  const [expanded, setExpanded] = useState(false);
  const breakdownId = useId();

  if (usage === null) {
    return (
      <Typography
        color="text.secondary"
        data-coverage={ReportUsageCoverage.Unavailable}
        data-testid="report-usage-bar"
        variant="caption"
      >
        Usage unavailable
      </Typography>
    );
  }

  const hasBreakdown = usage.breakdown.length > 0;

  return (
    <Box
      data-coverage={usage.coverage}
      data-testid="report-usage-bar"
      title="Usage available at report creation. Reports from the same execution are cumulative snapshots and must not be summed."
    >
      <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1}>
        <Typography color="text.secondary" variant="caption">
          At report creation: {describeUsage(usage)}
        </Typography>

        {usage.coverage === ReportUsageCoverage.Partial && (
          <Chip label="Partial" size="small" variant="outlined" />
        )}

        {hasBreakdown && (
          <Button
            aria-controls={breakdownId}
            aria-expanded={expanded}
            data-testid="report-usage-breakdown-toggle"
            onClick={() => setExpanded((current) => !current)}
            size="small"
            variant="text"
          >
            {expanded ? "Hide breakdown" : "Show breakdown"}
          </Button>
        )}
      </Stack>

      {hasBreakdown && expanded && (
        <Table
          data-testid="report-usage-breakdown"
          id={breakdownId}
          size="small"
        >
          <TableHead>
            <TableRow>
              <TableCell>Agent</TableCell>
              <TableCell align="right">Fresh input</TableCell>
              <TableCell align="right">Cache reads</TableCell>
              <TableCell align="right">Cache creation</TableCell>
              <TableCell align="right">Output</TableCell>
              <TableCell align="right">Tool calls</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {usage.breakdown.map((entry, index) => (
              <TableRow
                data-coverage={entry.coverage}
                data-role={entry.role}
                key={`${entry.role}-${entry.label}-${index}`}
              >
                <TableCell>
                  {entry.label}
                  <Typography
                    variant="caption"
                    display="block"
                    color="text.secondary"
                  >
                    {[entry.role, entry.provider, entry.model, entry.effort]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {entry.coverage !== ReportUsageCoverage.Complete && (
                    <Typography variant="caption" display="block">
                      {entry.coverage === ReportUsageCoverage.Partial
                        ? "Partial"
                        : "Usage unavailable"}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  {formatFigure(entry.freshInputTokens)}
                </TableCell>
                <TableCell align="right">
                  {formatFigure(entry.cacheReadInputTokens)}
                </TableCell>
                <TableCell align="right">
                  {formatFigure(entry.cacheCreationInputTokens)}
                </TableCell>
                <TableCell align="right">
                  {formatFigure(entry.outputTokens)}
                </TableCell>
                <TableCell align="right">
                  {formatFigure(entry.toolCalls)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};
