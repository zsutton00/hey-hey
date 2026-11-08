import {
  EvalAttemptStatus,
  EvalAttemptStopReason,
  EvalMeasurementScope,
  type EvalAutomatedAssessment,
  type EvalCheckDefinition,
  type EvalConfiguration,
  type EvalMeasurement,
  type EvalRecordedChanges,
  type EvalRunCaseInput,
} from "@hey-hey/contracts/api";
import {
  attemptRepeat,
  type EvalAttemptReport,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The attempt's automated assessment, or null until the judge has recorded
 * one. The generated type leaves it as an untyped object.
 */
export const automatedAssessment = (
  attempt: EvalAttemptReport,
): EvalAutomatedAssessment | null => {
  const value: unknown = attempt.payload.automatedAssessment;
  if (
    !isRecord(value) ||
    !Array.isArray(value.checkResults) ||
    !Array.isArray(value.quality) ||
    !isRecord(value.recognition)
  ) {
    return null;
  }
  return value as unknown as EvalAutomatedAssessment;
};

const measurement = (
  attempt: EvalAttemptReport,
  scope: EvalMeasurementScope,
): EvalMeasurement | undefined =>
  attempt.payload.measurements.find((entry) => entry.scope === scope);

/**
 * Fresh input plus output, unavailable unless both halves were measured.
 */
export const measuredTokens = (
  entry: EvalMeasurement | undefined,
): number | undefined => {
  if (!entry) return undefined;
  const { inputTokens, outputTokens } = entry;
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return inputTokens + outputTokens;
};

/**
 * What the agent cost, or null when it is not reported. Costs stored before
 * the available / partial / unavailable shape have no `state` and read as not
 * reported, never as a number.
 */
export const measuredCost = (
  entry: EvalMeasurement | undefined,
): { amount: number; partial: boolean } | null => {
  const cost = entry?.cost;
  if (cost?.state === "available" || cost?.state === "partial") {
    return { amount: cost.amount, partial: cost.state === "partial" };
  }
  return null;
};

/** Only a fully known cost joins an average; a lower bound would skew it. */
const availableCostAmount = (
  entry: EvalMeasurement | undefined,
): number | undefined => {
  const cost = measuredCost(entry);
  return cost && !cost.partial ? cost.amount : undefined;
};

/**
 * An average over the attempts that reported a value. `value` is null when
 * none did, which the page shows as "not reported", never 0.
 */
export interface AveragedMeasure {
  value: number | null;
  reported: number;
  total: number;
}

const average = (values: (number | undefined)[]): AveragedMeasure => {
  const reported = values.filter(
    (value): value is number => value !== undefined,
  );
  return {
    value:
      reported.length === 0
        ? null
        : reported.reduce((sum, value) => sum + value, 0) / reported.length,
    reported: reported.length,
    total: values.length,
  };
};

/** Setup comparisons measure the tested agent only. */
const handlerAverage = (
  attempts: readonly EvalAttemptReport[],
  read: (entry: EvalMeasurement | undefined) => number | undefined,
): AveragedMeasure =>
  average(
    attempts.map((attempt) =>
      read(measurement(attempt, EvalMeasurementScope.TargetHandler)),
    ),
  );

/** Mean of an attempt's scored quality dimensions; null when none was scored. */
export const attemptQuality = (attempt: EvalAttemptReport): number | null => {
  const scores = (automatedAssessment(attempt)?.quality ?? [])
    .map((dimension) => dimension.score)
    .filter((score): score is number => score !== undefined);
  return scores.length === 0
    ? null
    : scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

/** Population standard deviation; null with fewer than two values. */
const spreadOf = (values: number[], mean: number): number | null => {
  if (values.length < 2) {
    return null;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

/** A repeat left out of every average, named with why. */
export interface ExcludedRepeat {
  attemptId: string;
  repeat: number;
  message: string | null;
  stopReason: EvalAttemptStopReason | null;
}

/**
 * What a set of attempts (one case and setup's repeats, or all of a setup's
 * attempts) add up to. Errored and stopped attempts are named and left out of
 * every average and count; measures average the tested agent only, over the
 * attempts that reported each one.
 */
export interface RepeatSummary {
  attempts: number;
  /** Attempts that finished and so count towards the figures. */
  finished: number;
  recognition: { recognized: number; assessed: number };
  /** Mean of per-attempt quality, with its population standard deviation. */
  quality: { mean: number | null; spread: number | null; scored: number };
  checks: { passed: number; total: number };
  elapsedMs: AveragedMeasure;
  tokens: AveragedMeasure;
  toolCalls: AveragedMeasure;
  cost: AveragedMeasure;
  errored: ExcludedRepeat[];
  stopped: ExcludedRepeat[];
}

const excluded = (attempt: EvalAttemptReport): ExcludedRepeat => ({
  attemptId: attempt.id,
  repeat: attemptRepeat(attempt),
  message: errorMessage(attempt),
  stopReason: attempt.payload.stopReason ?? null,
});

export const summariseRepeats = (
  attempts: readonly EvalAttemptReport[],
): RepeatSummary => {
  const ordered = [...attempts].sort(
    (left, right) => attemptRepeat(left) - attemptRepeat(right),
  );
  const finished = ordered.filter(
    (attempt) => attempt.payload.status === EvalAttemptStatus.Completed,
  );
  const assessments = finished
    .map(automatedAssessment)
    .filter((value): value is EvalAutomatedAssessment => value !== null);
  const qualities = finished
    .map(attemptQuality)
    .filter((value): value is number => value !== null);
  const qualityMean =
    qualities.length === 0
      ? null
      : qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  const checkResults = assessments.flatMap(
    (assessment) => assessment.checkResults,
  );

  return {
    attempts: ordered.length,
    finished: finished.length,
    recognition: {
      recognized: assessments.filter(
        (assessment) => assessment.recognition.recognized,
      ).length,
      assessed: assessments.length,
    },
    quality: {
      mean: qualityMean,
      spread: qualityMean === null ? null : spreadOf(qualities, qualityMean),
      scored: qualities.length,
    },
    checks: {
      passed: checkResults.filter((result) => result.passed).length,
      total: checkResults.length,
    },
    elapsedMs: handlerAverage(finished, (entry) => entry?.elapsedMs),
    tokens: handlerAverage(finished, measuredTokens),
    toolCalls: handlerAverage(finished, (entry) => entry?.toolCalls),
    cost: handlerAverage(finished, availableCostAmount),
    errored: ordered
      .filter((attempt) => attempt.payload.status === EvalAttemptStatus.Error)
      .map(excluded),
    stopped: ordered
      .filter((attempt) => attempt.payload.status === EvalAttemptStatus.Stopped)
      .map(excluded),
  };
};

export interface SetupComparison extends RepeatSummary {
  configuration: EvalConfiguration;
}

export const compareSetup = (
  configuration: EvalConfiguration,
  attempts: EvalAttemptReport[],
): SetupComparison => ({
  configuration,
  ...summariseRepeats(
    attempts.filter(
      (attempt) => attempt.payload.configuration.id === configuration.id,
    ),
  ),
});

export const compareSetups = (
  run: EvalRunReport,
  attempts: EvalAttemptReport[],
): SetupComparison[] =>
  run.payload.configurations.map((configuration) =>
    compareSetup(configuration, attempts),
  );

/**
 * The command that resumes a provider session in its own tool, or null when
 * the provider has none (for example OpenCode).
 */
export const resumeCommandFor = (
  provider: string,
  providerSessionId: string,
): string | null => {
  switch (provider) {
    case "claude":
      return `claude --resume ${providerSessionId}`;
    case "codex":
      return `codex resume ${providerSessionId}`;
    default:
      return null;
  }
};

/** Check descriptions recorded on the run for the attempt's case. */
export const checkDescriptions = (
  run: EvalRunReport,
  attempt: EvalAttemptReport,
): Map<string, EvalCheckDefinition> => {
  const caseInput = run.payload.cases.find(
    ({ id }) => id === attempt.payload.caseInputId,
  );
  return new Map(
    (caseInput?.grading.checks ?? []).map((check) => [check.id, check]),
  );
};

/** A case row reports the tested agent only; absent measurements stay absent. */
export interface RowMeasure {
  value: number | null;
  partial: boolean;
}

export const rowMeasure = (
  attempt: EvalAttemptReport,
  read: (entry: EvalMeasurement | undefined) => number | undefined,
): RowMeasure => {
  return {
    value:
      read(measurement(attempt, EvalMeasurementScope.TargetHandler)) ?? null,
    partial: false,
  };
};

export const costRowMeasure = (attempt: EvalAttemptReport): RowMeasure => {
  const cost = measuredCost(
    measurement(attempt, EvalMeasurementScope.TargetHandler),
  );
  return { value: cost?.amount ?? null, partial: cost?.partial ?? false };
};

/** A separately executed research agent and the tested agent, kept apart. */
export interface WorkBreakdownRow {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  scope: EvalMeasurementScope;
  elapsedMs: number | null;
  tokens: number | null;
  toolCalls: number | null;
  cost: number | null;
  costPartial: boolean;
}

const breakdownRow = (
  attempt: EvalAttemptReport,
  scope: EvalMeasurementScope,
): WorkBreakdownRow => {
  const entry = measurement(attempt, scope);
  const cost = measuredCost(entry);
  return {
    scope,
    elapsedMs: entry?.elapsedMs ?? null,
    tokens: measuredTokens(entry) ?? null,
    inputTokens: entry?.inputTokens ?? null,
    outputTokens: entry?.outputTokens ?? null,
    cacheReadInputTokens: entry?.cacheReadInputTokens ?? null,
    cacheCreationInputTokens: entry?.cacheCreationInputTokens ?? null,
    toolCalls: entry?.toolCalls ?? null,
    cost: cost?.amount ?? null,
    costPartial: cost?.partial ?? false,
  };
};

const ATTEMPT_ENDED: ReadonlySet<EvalAttemptStatus> = new Set([
  EvalAttemptStatus.Completed,
  EvalAttemptStatus.Error,
  EvalAttemptStatus.Stopped,
]);

/** What a coding attempt saved before its workspace was removed. */
export interface CodingResults {
  /** Null when the attempt never got as far as saving its changes. */
  changes: EvalRecordedChanges | null;
  /** The attempt has stopped for good, so absent changes will not appear later. */
  ended: boolean;
  /** Where the attempt started: the Service and the pinned commit. */
  startPoint: { serviceId: string; sha: string; shortMessage: string };
}

/** One Mockup checklist item and, once judged, whether the changes hit it. */
export interface ChecklistItemView {
  id: string;
  description: string;
  /** Null until the judge answered. */
  hit: boolean | null;
  explanation: string | null;
}

/** A coding case's Mockup checklist as judged for one attempt. */
export interface ChecklistView {
  kind: "NEW" | "UPDATE";
  items: ChecklistItemView[];
  /** Null until the judge answered. */
  hits: number | null;
  /** What the change broke; null unless the case is an updated Mockup and judged. */
  regressions: string[] | null;
}

export type RecognitionView = "correct" | "missed" | "pending";

export interface CaseRow {
  attemptId: string;
  setupId: string;
  title: string | null;
  /** The attempt stopped on an error; its figures are what was measured first. */
  errored: boolean;
  /** The attempt was stopped by the run or a limit before it finished. */
  stopped: boolean;
  recognition: RecognitionView;
  /** Mean of the attempt's scored quality dimensions; null when none scored. */
  quality: number | null;
  checks: { passed: number; total: number } | null;
  elapsedMs: RowMeasure;
  tokens: RowMeasure;
  toolCalls: RowMeasure;
  cost: RowMeasure;
  breakdown: WorkBreakdownRow[];
  /** The attempt's own read-only session; null when none was recorded. */
  sessionHref: string | null;
  /** The judge's own session, to check by hand how the attempt was judged; null until judged. */
  judgeSessionHref: string | null;
  /** The Eval Case record this attempt ran; null when the run did not name one. */
  evalCaseHref: string | null;
  /** Set for coding attempts; null for every other kind. */
  coding: CodingResults | null;
  /** Set for coding attempts whose case carries a Mockup checklist. */
  checklist: ChecklistView | null;
  /** The attempt's own error message, shown in its cell. */
  errorMessage: string | null;
  /** What the case expected, as recorded on the run. */
  expectation: string | null;
  /** The judge's saved explanation of its recognition result. */
  recognitionExplanation: string | null;
}

/** The generated type leaves the attempt's error as an untyped object. */
const errorMessage = (attempt: EvalAttemptReport): string | null => {
  const error: unknown = attempt.payload.error;

  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : null;
};

const checklistView = (
  checklist: NonNullable<EvalRunCaseInput["coding"]>["mockupChecklist"],
  assessment: EvalAutomatedAssessment | null,
): ChecklistView | null => {
  if (!checklist) {
    return null;
  }

  const results = new Map(
    (assessment?.checklistResults ?? []).map((result) => [
      result.itemId,
      result,
    ]),
  );
  const judged = results.size > 0;
  const items = checklist.items.map((item) => {
    const result = results.get(item.id);

    return {
      id: item.id,
      description: item.description,
      hit: result?.hit ?? null,
      explanation: result?.explanation ?? null,
    };
  });

  return {
    kind: checklist.kind,
    items,
    hits: judged ? items.filter((item) => item.hit).length : null,
    regressions: judged ? (assessment?.regressions ?? null) : null,
  };
};

export const caseRow = (
  projectId: string,
  run: EvalRunReport,
  attempt: EvalAttemptReport,
): CaseRow => {
  const assessment = automatedAssessment(attempt);
  const caseInput = run.payload.cases.find(
    ({ id }) => id === attempt.payload.caseInputId,
  );
  const sessionId = attempt.payload.targetSessionId;
  const expectation = caseInput?.grading.expectations?.trim();
  const codingCase = caseInput?.coding;
  return {
    attemptId: attempt.id,
    setupId: attempt.payload.configuration.id,
    title: caseInput?.title ?? null,
    errored: attempt.payload.status === EvalAttemptStatus.Error,
    stopped: attempt.payload.status === EvalAttemptStatus.Stopped,
    recognition:
      assessment === null
        ? "pending"
        : assessment.recognition.recognized
          ? "correct"
          : "missed",
    quality: attemptQuality(attempt),
    checks: assessment
      ? {
          passed: assessment.checkResults.filter((result) => result.passed)
            .length,
          total: assessment.checkResults.length,
        }
      : null,
    elapsedMs: rowMeasure(attempt, (entry) => entry?.elapsedMs),
    tokens: {
      value:
        measuredTokens(
          measurement(attempt, EvalMeasurementScope.TargetHandler),
        ) ?? null,
      partial: false,
    },
    toolCalls: rowMeasure(attempt, (entry) => entry?.toolCalls),
    cost: costRowMeasure(attempt),
    breakdown: [
      ...(attempt.payload.execution?.projectAssistantPrepares
        ? [breakdownRow(attempt, EvalMeasurementScope.TargetPreparation)]
        : []),
      breakdownRow(attempt, EvalMeasurementScope.TargetHandler),
    ],
    sessionHref: sessionId
      ? WebPathService.agentSession({ projectId, agentSessionId: sessionId })
      : null,
    judgeSessionHref: assessment?.judgeSessionId
      ? WebPathService.agentSession({
          projectId,
          agentSessionId: assessment.judgeSessionId,
        })
      : null,
    evalCaseHref: caseInput?.evalCaseId
      ? WebPathService.task({ projectId, taskId: caseInput.evalCaseId })
      : null,
    coding: codingCase
      ? {
          changes: attempt.payload.recordedChanges ?? null,
          ended: ATTEMPT_ENDED.has(attempt.payload.status),
          startPoint: {
            serviceId: codingCase.serviceId,
            sha: codingCase.pinnedCommit.sha,
            shortMessage: codingCase.pinnedCommit.shortMessage,
          },
        }
      : null,
    checklist: checklistView(codingCase?.mockupChecklist, assessment),
    errorMessage: errorMessage(attempt),
    expectation: expectation ? expectation : null,
    recognitionExplanation: assessment?.recognition.explanation ?? null,
  };
};

export interface SetupCases {
  configuration: EvalConfiguration;
  rows: CaseRow[];
}

/** Each setup in the run's own order with one row per attempt it ran. */
export const groupCasesBySetup = (
  projectId: string,
  run: EvalRunReport,
  attempts: EvalAttemptReport[],
): SetupCases[] =>
  run.payload.configurations.map((configuration) => ({
    configuration,
    rows: attempts
      .filter(
        (attempt) => attempt.payload.configuration.id === configuration.id,
      )
      .map((attempt) => caseRow(projectId, run, attempt)),
  }));

/** One repeat of a case and setup, with whether it stands out as weak. */
export interface RepeatRow {
  repeat: number;
  row: CaseRow;
  /** Missed recognition, errored or stopped, or quality over one spread below the average. */
  weak: boolean;
}

/** One case under one setup in a run with several repeats. */
export interface RepeatedCase {
  caseInputId: string;
  title: string | null;
  summary: RepeatSummary;
  repeats: RepeatRow[];
}

export interface SetupRepeatedCases {
  configuration: EvalConfiguration;
  cases: RepeatedCase[];
}

const isWeak = (
  attempt: EvalAttemptReport,
  row: CaseRow,
  summary: RepeatSummary,
): boolean => {
  if (attempt.payload.status !== EvalAttemptStatus.Completed) {
    return (
      attempt.payload.status === EvalAttemptStatus.Error ||
      attempt.payload.status === EvalAttemptStatus.Stopped
    );
  }
  if (row.recognition === "missed") {
    return true;
  }
  const { mean, spread } = summary.quality;
  return (
    row.quality !== null &&
    mean !== null &&
    spread !== null &&
    spread > 0 &&
    row.quality < mean - spread
  );
};

/**
 * Each setup in the run's order, with one entry per recorded case summarising
 * its repeats and listing each repeat in order.
 */
export const groupRepeatsBySetup = (
  projectId: string,
  run: EvalRunReport,
  attempts: readonly EvalAttemptReport[],
): SetupRepeatedCases[] =>
  run.payload.configurations.map((configuration) => ({
    configuration,
    cases: run.payload.cases.map((caseInput) => {
      const own = attempts
        .filter(
          (attempt) =>
            attempt.payload.configuration.id === configuration.id &&
            attempt.payload.caseInputId === caseInput.id,
        )
        .sort((left, right) => attemptRepeat(left) - attemptRepeat(right));
      const summary = summariseRepeats(own);
      return {
        caseInputId: caseInput.id,
        title: caseInput.title,
        summary,
        repeats: own.map((attempt) => {
          const row = caseRow(projectId, run, attempt);
          return {
            repeat: attemptRepeat(attempt),
            row,
            weak: isWeak(attempt, row, summary),
          };
        }),
      };
    }),
  }));
