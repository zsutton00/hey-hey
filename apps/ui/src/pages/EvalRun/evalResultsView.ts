import {
  EvalAttemptStatus,
  EvalMeasurementScope,
  type EvalAutomatedAssessment,
  type EvalCheckDefinition,
  type EvalConfiguration,
  type EvalMeasurement,
} from "@hey-hey/ui-common/api";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

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

export const caseTitle = (
  run: EvalRunReport,
  attempt: EvalAttemptReport,
): string | null =>
  run.payload.cases.find(({ id }) => id === attempt.payload.caseInputId)
    ?.title ?? null;
