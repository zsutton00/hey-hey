import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { EvalRunStatus } from "@hey-hey/ui-common/api";
import {
  useEvalRun,
  type EvalAttemptReport,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";

import { EvalAttemptDetail } from "./EvalAttemptDetail";
import { EvalRunLayout } from "./EvalRunLayout";
import {
  automatedAssessment,
  caseTitle,
  compareSetups,
  runOverhead,
  type AveragedMeasure,
  type OverheadMeasures,
  type ScopedMeasures,
  type SetupComparison,
  type SummedMeasure,
} from "./evalResultsView";
import { formatElapsed, formatTokenCount, setupLabel } from "./evalRunView";

type Format = (value: number) => string;

const formatCount: Format = (value) => String(Math.round(value));

/** Formats a measure; anything nobody reported reads "not reported". */
const useMeasureFormatter = (): ((
  measure: AveragedMeasure | SummedMeasure,
  format: Format,
) => string) => {
  const { t } = useTranslation();
  return (measure, format) => {
    if (measure.value === null) return t("eval.results.notReported");
    const value = format(measure.value);
    return measure.reported < measure.total
      ? t("eval.results.partial", {
          value,
          reported: measure.reported,
          total: measure.total,
        })
      : value;
  };
};

const ScopedCell: React.FC<{
  measures: ScopedMeasures;
  format: Format;
  testId: string;
}> = ({ measures, format, testId }) => {
  const formatMeasure = useMeasureFormatter();
  return (
    <TableCell data-testid={testId}>
      {`${formatMeasure(measures.preparation, format)} / ${formatMeasure(
        measures.handler,
        format,
      )}`}
    </TableCell>
  );
};

const ComparisonRow: React.FC<{ comparison: SetupComparison }> = ({
  comparison,
}) => {
  const { t } = useTranslation();
  const notReported = t("eval.results.notReported");
  const { configuration, recognition, quality, checks, errors } = comparison;
  const testId = `eval-results-setup-${configuration.id}`;
  return (
    <TableRow data-testid={testId}>
      <TableCell>{setupLabel(configuration.target)}</TableCell>
      <TableCell data-testid={`${testId}-recognition`}>
        {recognition.assessed === 0
          ? notReported
          : `${recognition.recognized} / ${recognition.assessed}`}
        {errors > 0 && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1 }}
          >
            {t("eval.results.errors", { count: errors })}
          </Typography>
        )}
      </TableCell>
      <TableCell data-testid={`${testId}-quality`}>
        {quality === null ? notReported : quality.toFixed(1)}
      </TableCell>
      <TableCell data-testid={`${testId}-checks`}>
        {checks.total === 0
          ? notReported
          : `${checks.passed} / ${checks.total}`}
      </TableCell>
      <ScopedCell
        measures={comparison.elapsedMs}
        format={formatElapsed}
        testId={`${testId}-elapsed`}
      />
      <ScopedCell
        measures={comparison.tokens}
        format={formatTokenCount}
        testId={`${testId}-tokens`}
      />
      <ScopedCell
        measures={comparison.toolCalls}
        format={formatCount}
        testId={`${testId}-tool-calls`}
      />
    </TableRow>
  );
};

const OverheadLine: React.FC<{
  run: EvalRunReport;
  attempts: EvalAttemptReport[];
}> = ({ run, attempts }) => {
  const { t } = useTranslation();
  const formatMeasure = useMeasureFormatter();
  const overhead = runOverhead(run, attempts);
  const describe = (measures: OverheadMeasures): string =>
    t("eval.results.overheadMeasures", {
      elapsed: formatMeasure(measures.elapsedMs, formatElapsed),
      tokens: formatMeasure(measures.tokens, formatTokenCount),
      toolCalls: formatMeasure(measures.toolCalls, formatCount),
    });
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ mt: 1 }}
      data-testid="eval-results-overhead"
    >
      {t("eval.results.overhead", {
        judge: describe(overhead.judge),
        coordinator: describe(overhead.coordinator),
      })}
    </Typography>
  );
};

const AttemptList: React.FC<{
  run: EvalRunReport;
  attempts: EvalAttemptReport[];
  selectedId: string | null;
  onSelect: (attemptId: string) => void;
}> = ({ run, attempts, selectedId, onSelect }) => {
  const { t } = useTranslation();
  const notReported = t("eval.results.notReported");
  return (
    <Table size="small" data-testid="eval-results-attempts">
      <TableHead>
        <TableRow>
          <TableCell>{t("eval.results.attempts.case")}</TableCell>
          <TableCell>{t("eval.results.attempts.setup")}</TableCell>
          <TableCell>{t("eval.results.attempts.status")}</TableCell>
          <TableCell>{t("eval.results.columns.recognition")}</TableCell>
          <TableCell />
        </TableRow>
      </TableHead>
      <TableBody>
        {attempts.map((attempt) => {
          const assessment = automatedAssessment(attempt);
          return (
            <TableRow
              key={attempt.id}
              selected={attempt.id === selectedId}
              data-testid={`eval-results-attempt-${attempt.id}`}
            >
              <TableCell>
                {caseTitle(run, attempt) ??
                  t("eval.results.attempt.unknownCase")}
              </TableCell>
              <TableCell>
                {setupLabel(attempt.payload.configuration.target)}
              </TableCell>
              <TableCell>
                {t(`eval.results.attempts.status.${attempt.payload.status}`)}
              </TableCell>
              <TableCell>
                {assessment === null
                  ? notReported
                  : assessment.recognition.recognized
                    ? t("eval.results.assessment.recognized")
                    : t("eval.results.assessment.notRecognized")}
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={() => onSelect(attempt.id)}
                  data-testid={`eval-results-open-attempt-${attempt.id}`}
                >
                  {t("eval.results.attempts.open")}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

interface EvalResultsViewProps {
  organizationId: string;
  projectId: string;
  evalId: string;
  runId: string;
}

const EvalResultsView: React.FC<EvalResultsViewProps> = ({
  organizationId,
  projectId,
  evalId,
  runId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useQueryState("attempt", parseAsString);
  const {
    data: run,
    attempts,
    error,
    isLoading,
    isFetched,
  } = useEvalRun(organizationId, runId);
  const comparisons = useMemo(
    () => (run ? compareSetups(run, attempts) : []),
    [run, attempts],
  );
  const selected = attempts.find(({ id }) => id === selectedId) ?? null;

  if (error) {
    return (
      <Alert severity="error" data-testid="eval-results-load-error">
        {t("eval.run.page.loadError", { message: error.message })}
      </Alert>
    );
  }
  if (isLoading || !isFetched) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!run) {
    return (
      <Alert severity="warning" data-testid="eval-results-not-found">
        {t("eval.run.page.notFound")}
      </Alert>
    );
  }

  const isOver =
    run.payload.status === EvalRunStatus.Finished ||
    run.payload.status === EvalRunStatus.Stopped;
  if (!isOver) {
    const runHref = WebPathService.evalRun({ projectId, evalId, runId });
    return (
      <Alert
        severity="info"
        data-testid="eval-results-not-finished"
        action={
          <Button
            size="small"
            href={runHref}
            onClick={(event: React.MouseEvent) => {
              if (event.ctrlKey || event.metaKey || event.shiftKey) return;
              event.preventDefault();
              navigate(runHref);
            }}
          >
            {t("eval.results.backToRun")}
          </Button>
        }
      >
        {t("eval.results.notFinished")}
      </Alert>
    );
  }

  return (
    <>
      <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
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
      <OverheadLine run={run} attempts={attempts} />
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

      <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1 }}>
        {t("eval.results.attempts.title")}
      </Typography>
      <AttemptList
        run={run}
        attempts={attempts}
        selectedId={selected?.id ?? null}
        onSelect={(attemptId) => void setSelectedId(attemptId)}
      />
      {selected && (
        // Keyed so a review draft never carries over to another attempt.
        <EvalAttemptDetail
          key={selected.id}
          organizationId={organizationId}
          projectId={projectId}
          run={run}
          attempt={selected}
        />
      )}
    </>
  );
};

export const EvalResultsPage: React.FC = () => {
  const { t } = useTranslation();
  const identity = useUserIdentity();
  const {
    projectId = "",
    evalId = "",
    runId = "",
  } = useParams<{ projectId?: string; evalId?: string; runId?: string }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";

  if (!organizationId || !projectId || !evalId || !runId) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {t("eval.run.missingContext")}
      </Alert>
    );
  }

  return (
    <EvalRunLayout
      organizationId={organizationId}
      projectId={projectId}
      evalId={evalId}
      crumbLabel={t("eval.results.crumb")}
      testId="eval-results-page"
    >
      {() => (
        <EvalResultsView
          organizationId={organizationId}
          projectId={projectId}
          evalId={evalId}
          runId={runId}
        />
      )}
    </EvalRunLayout>
  );
};
