import {
  EvalAttemptStatus,
  EvalMeasurementScope,
  type EvalAutomatedAssessment,
  type EvalCheckDefinition,
  type EvalConfiguration,
  type EvalMeasurement,
  type EvalRecordedChanges,
  type EvalTestCheck,
} from "@hey-hey/contracts/api";
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
  attempts: EvalAttemptReport[],
  read: (entry: EvalMeasurement | undefined) => number | undefined,
): AveragedMeasure =>
  average(
    attempts.map((attempt) =>
      read(measurement(attempt, EvalMeasurementScope.TargetHandler)),
    ),
  );

export interface SetupComparison {
  configuration: EvalConfiguration;
  attempts: number;
  errors: number;
  /** Assessed attempts that recognised the need, out of those assessed. */
  recognition: { recognized: number; assessed: number };
  /** Mean of every scored quality dimension; null when none was scored. */
  quality: number | null;
  checks: { passed: number; total: number };
  elapsedMs: AveragedMeasure;
  tokens: AveragedMeasure;
  toolCalls: AveragedMeasure;
  cost: AveragedMeasure;
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
    elapsedMs: handlerAverage(own, (entry) => entry?.elapsedMs),
    tokens: handlerAverage(own, measuredTokens),
    toolCalls: handlerAverage(own, (entry) => entry?.toolCalls),
    cost: handlerAverage(own, availableCostAmount),
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
 * The run's coordinator, outside every setup's figures. The judge is not part
 * of the measured evaluation, so nothing stored for it is ever read.
 */
export const runOverhead = (
  run: EvalRunReport,
): { coordinator: OverheadMeasures } => ({
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

/** What a coding attempt saved before its workspace was removed. */
export interface CodingResults {
  /** Null when the attempt never got as far as saving its changes. */
  changes: EvalRecordedChanges | null;
  /** Null until the named commands ran; empty when the case names none. */
  testChecks: EvalTestCheck[] | null;
  /** Where the attempt started: the Service and the pinned commit. */
  startPoint: { serviceId: string; sha: string; shortMessage: string };
}

/** Passed over total test checks, or null when no tests ran. */
export const testCount = (
  checks: readonly EvalTestCheck[] | null,
): { passed: number; total: number } | null =>
  checks && checks.length > 0
    ? {
        passed: checks.filter((check) => check.passed).length,
        total: checks.length,
      }
    : null;

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
  const codingCase = caseInput?.coding;
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
          testChecks: attempt.payload.testChecks ?? null,
          startPoint: {
            serviceId: codingCase.serviceId,
            sha: codingCase.pinnedCommit.sha,
            shortMessage: codingCase.pinnedCommit.shortMessage,
          },
        }
      : null,
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
