import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import { type AveragedMeasure, type SetupComparison } from "./evalResultsView";
import {
  formatCount,
  useMeasureFormatter,
  useQualityFormatter,
  type Format,
} from "./useResultFormatters";
import {
  formatCost,
  formatElapsed,
  formatTokenCount,
  setupLabel,
} from "./evalRunView";

const MeasureCell: React.FC<{
  measures: AveragedMeasure;
  format: Format;
  testId: string;
}> = ({ measures, format, testId }) => {
  const formatMeasure = useMeasureFormatter();
  return (
    <TableCell data-testid={testId}>
      {formatMeasure(measures, format)}
    </TableCell>
  );
};

const ComparisonRow: React.FC<{ comparison: SetupComparison }> = ({
  comparison,
}) => {
  const { t } = useTranslation();
  const formatQuality = useQualityFormatter();
  const notReported = t("eval.results.notReported");
  const { configuration, recognition, quality, checks, errored, stopped } =
    comparison;
  const testId = `eval-results-setup-${configuration.id}`;
  return (
    <TableRow data-testid={testId}>
      <TableCell>{setupLabel(configuration.target)}</TableCell>
      <TableCell data-testid={`${testId}-recognition`}>
        {recognition.assessed === 0
          ? notReported
          : `${recognition.recognized} / ${recognition.assessed}`}
        {errored.length > 0 && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1 }}
            data-testid={`${testId}-errors`}
          >
            {t("eval.results.errors", { count: errored.length })}
          </Typography>
        )}
        {stopped.length > 0 && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1 }}
            data-testid={`${testId}-stopped`}
          >
            {t("eval.results.stopped", { count: stopped.length })}
          </Typography>
        )}
      </TableCell>
      <TableCell data-testid={`${testId}-quality`}>
        {formatQuality(quality)}
      </TableCell>
      <TableCell data-testid={`${testId}-checks`}>
        {checks.total === 0
          ? notReported
          : `${checks.passed} / ${checks.total}`}
      </TableCell>
      <MeasureCell
        measures={comparison.elapsedMs}
        format={formatElapsed}
        testId={`${testId}-elapsed`}
      />
      <MeasureCell
        measures={comparison.tokens}
        format={formatTokenCount}
        testId={`${testId}-tokens`}
      />
      <MeasureCell
        measures={comparison.toolCalls}
        format={formatCount}
        testId={`${testId}-tool-calls`}
      />
      <MeasureCell
        measures={comparison.cost}
        format={formatCost}
        testId={`${testId}-cost`}
      />
    </TableRow>
  );
};

export interface CompareSetupsProps {
  comparisons: readonly SetupComparison[];
}

export const CompareSetups: React.FC<CompareSetupsProps> = ({
  comparisons,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
        {t("eval.results.title")}
      </Typography>
      <Table size="small" data-testid="eval-results-comparison">
        <TableHead>
          <TableRow>
            <TableCell>{t("eval.results.columns.setup")}</TableCell>
            <TableCell>{t("eval.results.columns.recognition")}</TableCell>
            <TableCell>{t("eval.results.columns.quality")}</TableCell>
            <TableCell>{t("eval.results.columns.checks")}</TableCell>
            <TableCell>{t("eval.results.columns.elapsed")}</TableCell>
            <TableCell>{t("eval.results.columns.tokens")}</TableCell>
            <TableCell>{t("eval.results.columns.toolCalls")}</TableCell>
            <TableCell>{t("eval.results.columns.cost")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {comparisons.map((comparison) => (
            <ComparisonRow
              key={comparison.configuration.id}
              comparison={comparison}
            />
          ))}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" component="p">
        {t("eval.results.averagesNote")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        data-testid="eval-results-observation-note"
      >
        {t("eval.results.observationNote")}
      </Typography>
    </>
  );
};
