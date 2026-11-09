import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "react-router-dom";

import {
  EvalAttemptStatus,
  EvalRunStatus,
  EvalTargetHandlerKey,
} from "@hey-hey/contracts/api";
import {
  evalRunName,
  runRepeats,
  useEvalRun,
  useEvalRunSession,
  type EvalAttemptReport,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";

import { AttemptGrid } from "./AttemptGrid";
import { CompareSetups } from "./CompareSetups";
import { EvalCaseRows } from "./EvalCaseRows";
import { EvalRunLayout } from "./EvalRunLayout";
import { RepeatedCaseRows } from "./RepeatedCaseRows";
import {
  EvalRunMachinePicker,
  useEvalRunMachine,
} from "./EvalRunMachinePicker";
import type { EvalRunNavigationState } from "./EvalRunSetupPage";
import { RunNameHeading } from "./RunNameHeading";
import { compareSetups } from "./evalResultsView";
import {
  formatTimeLimit,
  formatTokenCount,
  isAttemptEnded,
  isProjectAssistantEnabled,
  runHandlerOf,
} from "./evalRunView";

const TICK_MS = 1000;

const isInFlight = (attempt: EvalAttemptReport): boolean =>
  !!attempt.payload.startedAt && !isAttemptEnded(attempt);

/** Re-renders every second while any attempt is running, for elapsed time. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

const SettingsSummary: React.FC<{ run: EvalRunReport }> = ({ run }) => {
  const { t } = useTranslation();
  const { maxConcurrentAttempts, attemptTimeLimitSeconds, attemptTokenLimit } =
    run.payload.settings;
  const none = t("eval.run.page.limitNone");
  const handler = runHandlerOf(run.payload.configurations);
  const repeats = runRepeats(run);
  return (
    <Typography
      variant="body2"
      data-testid="eval-run-settings-summary"
      sx={{
        display: "inline-block",
        bgcolor: "action.hover",
        borderRadius: 1,
        px: 1.25,
        py: 0.5,
        my: 1.5,
      }}
    >
      {t("eval.run.page.settingsSummary", {
        concurrency: t("eval.run.attempts", { count: maxConcurrentAttempts }),
        time:
          attemptTimeLimitSeconds === undefined
            ? none
            : t("eval.run.page.timeLimitValue", {
                value: formatTimeLimit(attemptTimeLimitSeconds),
              }),
        tokens:
          attemptTokenLimit === undefined
            ? none
            : t("eval.run.page.tokenLimitValue", {
                value: formatTokenCount(attemptTokenLimit),
              }),
        handler: handler
          ? t(`eval.run.handler.${handler}`)
          : t("eval.run.settings.handlerCaseOwn"),
        projectAssistant: t(
          handler === EvalTargetHandlerKey.ProjectAssistant
            ? "eval.run.page.projectAssistantAlone"
            : isProjectAssistantEnabled(run.payload.configurations)
              ? "eval.run.page.projectAssistantOn"
              : "eval.run.page.projectAssistantOff",
        ),
      })}
      {repeats > 1 &&
        ` · ${t("eval.run.page.repeatsSummary", { count: repeats })}`}
    </Typography>
  );
};

interface NotStartedPanelProps {
  organizationId: string;
  projectId: string;
  startAccepted: boolean;
  startError: string | null;
  isStarting: boolean;
  onStart: (machineId: string | null) => void;
}

const NotStartedPanel: React.FC<NotStartedPanelProps> = ({
  organizationId,
  projectId,
  startAccepted,
  startError,
  isStarting,
  onStart,
}) => {
  const { t } = useTranslation();
  const machine = useEvalRunMachine(organizationId, projectId);
  return (
    <Box
      data-testid="eval-run-not-started"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }}
    >
      <Typography variant="body2" sx={{ mb: 2 }}>
        {startAccepted
          ? t("eval.run.page.startAccepted")
          : t("eval.run.page.notStarted")}
      </Typography>
      {startError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          data-testid="eval-run-start-error"
        >
          {startError}
        </Alert>
      )}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 2,
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <EvalRunMachinePicker machine={machine} testIdPrefix="eval-run-start" />
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          disabled={isStarting || !machine.machineId}
          onClick={() => onStart(machine.machineId)}
          data-testid="eval-run-start-recorded"
        >
          {t("eval.run.page.start")}
        </Button>
      </Box>
    </Box>
  );
};

interface EvalRunViewProps {
  organizationId: string;
  projectId: string;
  runId: string;
}

const EvalRunView: React.FC<EvalRunViewProps> = ({
  organizationId,
  projectId,
  runId,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [selectedId, setSelectedId] = useQueryState("attempt", parseAsString);
  const navigationState = (location.state ??
    null) as EvalRunNavigationState | null;
  const {
    data: run,
    attempts,
    error,
    isLoading,
    isFetched,
  } = useEvalRun(organizationId, runId);
  const session = useEvalRunSession();
  const [startedHere, setStartedHere] = useState(false);
  const now = useNow(attempts.some(isInFlight));

  const handleStart = useCallback(
    async (machineId: string | null) => {
      const result = await session.start({
        organizationId,
        projectId,
        runId,
        machineId,
      });
      if (result.ok) setStartedHere(true);
    },
    [organizationId, projectId, runId, session],
  );

  const handleStop = useCallback(() => {
    if (run) void session.stop(run);
  }, [run, session]);

  const endedCount = useMemo(
    () => attempts.filter(isAttemptEnded).length,
    [attempts],
  );
  const comparisons = useMemo(
    () => (run ? compareSetups(run, attempts) : []),
    [run, attempts],
  );

  if (error) {
    return (
      <Alert severity="error" data-testid="eval-run-load-error">
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
      <Alert severity="warning" data-testid="eval-run-not-found">
        {t("eval.run.page.notFound")}
      </Alert>
    );
  }

  const { status, cases, configurations } = run.payload;
  const repeats = runRepeats(run);
  const total = cases.length * configurations.length * repeats;
  const isOver =
    status === EvalRunStatus.Finished || status === EvalRunStatus.Stopped;
  const errorCount = attempts.filter(
    (attempt) => attempt.payload.status === EvalAttemptStatus.Error,
  ).length;
  const statusLine = ((): string => {
    if (status === EvalRunStatus.Running) {
      return t("eval.run.page.statusRunning", { ended: endedCount, total });
    }
    if (status === EvalRunStatus.Stopped) {
      return t("eval.run.page.statusStopped");
    }
    if (status === EvalRunStatus.Finished) {
      const finished =
        errorCount > 0
          ? t("eval.run.page.statusFinishedWithErrors", { count: errorCount })
          : t("eval.run.page.statusFinished");
      return repeats > 1
        ? `${finished} · ${t("eval.run.attempts", { count: total })}`
        : finished;
    }
    return t("eval.run.page.progressSummary", {
      cases: t("eval.run.cases", { count: cases.length }),
      configurations: t("eval.run.configurations", {
        count: configurations.length,
      }),
      ended: endedCount,
      total,
    });
  })();
  const startAccepted = startedHere || !!navigationState?.startAccepted;
  const startError =
    session.error ??
    (startedHere ? null : (navigationState?.startError ?? null));

  return (
    <>
      <RunNameHeading
        organizationId={organizationId}
        projectId={projectId}
        run={run}
      />
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 2,
          alignItems: "baseline",
        }}
      >
        <Typography variant="h5" component="h2">
          {t("eval.run.page.attempts")}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ flex: 1 }}
          data-testid="eval-run-progress-summary"
        >
          {statusLine}
        </Typography>
        {!isOver && (
          <Typography
            variant="body2"
            color="primary"
            data-testid="eval-run-background-hint"
          >
            {t("eval.run.page.backgroundHint")}
          </Typography>
        )}
        {status === EvalRunStatus.Running && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<StopIcon />}
            onClick={handleStop}
            disabled={session.isStopping}
            data-testid="eval-run-stop"
          >
            {t("eval.run.page.stop")}
          </Button>
        )}
      </Box>
      <SettingsSummary run={run} />

      {status === EvalRunStatus.Queued ? (
        <NotStartedPanel
          organizationId={organizationId}
          projectId={projectId}
          startAccepted={startAccepted}
          startError={startError}
          isStarting={session.isStarting}
          onStart={handleStart}
        />
      ) : (
        session.error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            data-testid="eval-run-stop-error"
          >
            {t("eval.run.page.stopError", { message: session.error })}
          </Alert>
        )
      )}

      {isOver ? (
        <>
          <CompareSetups comparisons={comparisons} />
          {repeats > 1 ? (
            <RepeatedCaseRows
              organizationId={organizationId}
              projectId={projectId}
              run={run}
              attempts={attempts}
              selectedId={selectedId}
              onSelect={(attemptId) => void setSelectedId(attemptId)}
            />
          ) : (
            <EvalCaseRows
              organizationId={organizationId}
              projectId={projectId}
              run={run}
              attempts={attempts}
              selectedId={selectedId}
              onSelect={(attemptId) => void setSelectedId(attemptId)}
            />
          )}
        </>
      ) : (
        <AttemptGrid
          organizationId={organizationId}
          projectId={projectId}
          run={run}
          attempts={attempts}
          now={now}
        />
      )}
    </>
  );
};

export const EvalRunPage: React.FC = () => {
  const { t } = useTranslation();
  const identity = useUserIdentity();
  const {
    projectId = "",
    evalId = "",
    runId = "",
  } = useParams<{ projectId?: string; evalId?: string; runId?: string }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";
  const { data: run } = useEvalRun(organizationId, runId);

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
      crumbLabel={run ? evalRunName(run, t) : t("eval.page.runs.columns.run")}
      testId="eval-run-page"
    >
      {() => (
        <EvalRunView
          organizationId={organizationId}
          projectId={projectId}
          runId={runId}
        />
      )}
    </EvalRunLayout>
  );
};
