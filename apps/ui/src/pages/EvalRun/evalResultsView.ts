import {
  EvalAttemptStatus,
  EvalMeasurementScope,
  type EvalAutomatedAssessment,
  type EvalCheckDefinition,
  type EvalConfiguration,
  type EvalMeasurement,
} from "@hey-hey/ui-common/api";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";
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
 * Tokens one scope used, or undefined when the provider reported neither
 * input nor output. A missing half is not read as 0 for the other half.
 */
export const measuredTokens = (
  entry: EvalMeasurement | undefined,
): number | undefined => {
  if (!entry) return undefined;
  const { inputTokens, outputTokens } = entry;
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return (inputTokens ?? 0) + (outputTokens ?? 0);
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

/** Preparation and handler work, kept apart and never summed together. */
export interface ScopedMeasures {
  preparation: AveragedMeasure;
  handler: AveragedMeasure;
}

const scoped = (
  attempts: EvalAttemptReport[],
  read: (entry: EvalMeasurement | undefined) => number | undefined,
): ScopedMeasures => ({
  preparation: average(
    attempts.map((attempt) =>
      read(measurement(attempt, EvalMeasurementScope.TargetPreparation)),
    ),
  ),
  handler: average(
    attempts.map((attempt) =>
      read(measurement(attempt, EvalMeasurementScope.TargetHandler)),
    ),
  ),
});

export interface SetupComparison {
  configuration: EvalConfiguration;
  attempts: number;
  errors: number;
  /** Assessed attempts that recognised the need, out of those assessed. */
  recognition: { recognized: number; assessed: number };
  /** Mean of every scored quality dimension; null when none was scored. */
  quality: number | null;
  checks: { passed: number; total: number };
  elapsedMs: ScopedMeasures;
  tokens: ScopedMeasures;
  toolCalls: ScopedMeasures;
}

export const compareSetup = (
  configuration: EvalConfiguration,
  attempts: EvalAttemptReport[],
): SetupComparison => {
  const own = attempts.filter(
    (attempt) => attempt.payload.configuration.id === configuration.id,
  );
  const assessments = own
    .map(automatedAssessment)
    .filter((value): value is EvalAutomatedAssessment => value !== null);
  const scores = assessments.flatMap((assessment) =>
    assessment.quality
      .map((dimension) => dimension.score)
      .filter((score): score is number => score !== undefined),
  );
  const checkResults = assessments.flatMap(
    (assessment) => assessment.checkResults,
  );
  return {
    configuration,
    attempts: own.length,
    errors: own.filter(
      (attempt) => attempt.payload.status === EvalAttemptStatus.Error,
    ).length,
    recognition: {
      recognized: assessments.filter(
        (assessment) => assessment.recognition.recognized,
      ).length,
      assessed: assessments.length,
    },
    quality:
      scores.length === 0
        ? null
        : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    checks: {
      passed: checkResults.filter((result) => result.passed).length,
      total: checkResults.length,
    },
    elapsedMs: scoped(own, (entry) => entry?.elapsedMs),
    tokens: scoped(own, measuredTokens),
    toolCalls: scoped(own, (entry) => entry?.toolCalls),
  };
};

export const compareSetups = (
  run: EvalRunReport,
  attempts: EvalAttemptReport[],
): SetupComparison[] =>
  run.payload.configurations.map((configuration) =>
    compareSetup(configuration, attempts),
  );

/** A total over whatever reported; null when nothing did. */
export interface SummedMeasure {
  value: number | null;
  reported: number;
  total: number;
}

const sum = (values: (number | undefined)[]): SummedMeasure => {
  const reported = values.filter(
    (value): value is number => value !== undefined,
  );
  return {
    value:
      reported.length === 0
        ? null
        : reported.reduce((total, value) => total + value, 0),
    reported: reported.length,
    total: values.length,
  };
};

export interface OverheadMeasures {
  elapsedMs: SummedMeasure;
  tokens: SummedMeasure;
  toolCalls: SummedMeasure;
}

const overheadOf = (
  entries: (EvalMeasurement | undefined)[],
): OverheadMeasures => ({
  elapsedMs: sum(entries.map((entry) => entry?.elapsedMs)),
  tokens: sum(entries.map(measuredTokens)),
  toolCalls: sum(entries.map((entry) => entry?.toolCalls)),
});

/**
 * Judge work across every attempt and the run's coordinator, each on its own
 * and outside every setup's figures.
 */
export const runOverhead = (
  run: EvalRunReport,
  attempts: EvalAttemptReport[],
): { judge: OverheadMeasures; coordinator: OverheadMeasures } => ({
  judge: overheadOf(
    attempts.map((attempt) => measurement(attempt, EvalMeasurementScope.Judge)),
  ),
  coordinator: overheadOf([run.payload.coordinatorMeasurement]),
});

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

/**
 * One figure for a case row: the preparation and handler work that produced
 * the tested result. `partial` marks a total built from only one scope that
 * reported; `value` is null when neither did, which shows as "not reported".
 * This is the one place a row's total is defined.
 */
export interface RowMeasure {
  value: number | null;
  partial: boolean;
}

export const rowMeasure = (
  attempt: EvalAttemptReport,
  read: (entry: EvalMeasurement | undefined) => number | undefined,
): RowMeasure => {
  const parts = [
    read(measurement(attempt, EvalMeasurementScope.TargetPreparation)),
    read(measurement(attempt, EvalMeasurementScope.TargetHandler)),
  ].filter((value): value is number => value !== undefined);
  return {
    value: parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0),
    partial: parts.length === 1,
  };
};

/** Preparing context and the handler's own work for one attempt, apart. */
export interface WorkBreakdownRow {
  scope: EvalMeasurementScope;
  elapsedMs: number | null;
  tokens: number | null;
  toolCalls: number | null;
}

const breakdownRow = (
  attempt: EvalAttemptReport,
  scope: EvalMeasurementScope,
): WorkBreakdownRow => {
  const entry = measurement(attempt, scope);
  return {
    scope,
    elapsedMs: entry?.elapsedMs ?? null,
    tokens: measuredTokens(entry) ?? null,
    toolCalls: entry?.toolCalls ?? null,
  };
};

export type RecognitionView = "correct" | "missed" | "pending";

export interface CaseRow {
  attemptId: string;
  setupId: string;
  title: string | null;
  /** The attempt stopped on an error; its figures are what was measured first. */
  errored: boolean;
  recognition: RecognitionView;
  /** Mean of the attempt's scored quality dimensions; null when none scored. */
  quality: number | null;
  checks: { passed: number; total: number } | null;
  elapsedMs: RowMeasure;
  tokens: RowMeasure;
  toolCalls: RowMeasure;
  breakdown: WorkBreakdownRow[];
  /** The attempt's own read-only session; null when none was recorded. */
  sessionHref: string | null;
  /** The Eval Case record this attempt ran; null when the run did not name one. */
  evalCaseHref: string | null;
  /** What the case expected, as recorded on the run. */
  expectation: string | null;
  /** The judge's saved explanation of its recognition result. */
  recognitionExplanation: string | null;
}

export const caseRow = (
  projectId: string,
  run: EvalRunReport,
  attempt: EvalAttemptReport,
): CaseRow => {
  const assessment = automatedAssessment(attempt);
  const caseInput = run.payload.cases.find(
    ({ id }) => id === attempt.payload.caseInputId,
  );
  const scores = (assessment?.quality ?? [])
    .map((dimension) => dimension.score)
    .filter((score): score is number => score !== undefined);
  const sessionId = attempt.payload.targetSessionId;
  const expectation = caseInput?.grading.expectations?.trim();
  return {
    attemptId: attempt.id,
    setupId: attempt.payload.configuration.id,
    title: caseInput?.title ?? null,
    errored: attempt.payload.status === EvalAttemptStatus.Error,
    recognition:
      assessment === null
        ? "pending"
        : assessment.recognition.recognized
          ? "correct"
          : "missed",
    quality:
      scores.length === 0
        ? null
        : scores.reduce((total, score) => total + score, 0) / scores.length,
    checks: assessment
      ? {
          passed: assessment.checkResults.filter((result) => result.passed)
            .length,
          total: assessment.checkResults.length,
        }
      : null,
    elapsedMs: rowMeasure(attempt, (entry) => entry?.elapsedMs),
    tokens: rowMeasure(attempt, measuredTokens),
    toolCalls: rowMeasure(attempt, (entry) => entry?.toolCalls),
    breakdown: [
      breakdownRow(attempt, EvalMeasurementScope.TargetPreparation),
      breakdownRow(attempt, EvalMeasurementScope.TargetHandler),
    ],
    sessionHref: sessionId
      ? WebPathService.agentSession({ projectId, agentSessionId: sessionId })
      : null,
    evalCaseHref: caseInput?.evalCaseId
      ? WebPathService.task({ projectId, taskId: caseInput.evalCaseId })
      : null,
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
