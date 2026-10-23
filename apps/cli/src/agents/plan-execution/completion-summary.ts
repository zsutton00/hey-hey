/**
 * The subset of an approved execution-plan step needed for completion
 * reporting. The formatter intentionally does not accept runner or validation
 * results: its only claim is that the approved runner work completed.
 */
export interface PlanExecutionCompletionStep {
  stepId: string;
  title: string;
}

export interface PlanExecutionCompletionSummaryInput {
  executionPlan: readonly PlanExecutionCompletionStep[];
}

const formatStepCompletion = (step: PlanExecutionCompletionStep, index: number): string =>
  `${String(index + 1)}. Completed "${step.title}" (${step.stepId}) — runner completed; behavioral validation not performed.`;

/**
 * Formats the deterministic completion report for an approved smoke plan.
 *
 * The input order is the approved execution order. This function only builds
 * text; it does not inspect product behavior, execute commands, invoke a
 * test runner, or claim assertions or coverage.
 */
export const formatPlanExecutionCompletionSummary = (
  input: PlanExecutionCompletionSummaryInput,
): string => {
  const stepLines = input.executionPlan.map(formatStepCompletion);
  const overallLine =
    'Smoke plan completed: the runner completed all approved execution steps. Behavioral validation, assertions, behavioral coverage, and test-runner execution are not claimed.';

  return [...stepLines, overallLine].join('\n');
};
