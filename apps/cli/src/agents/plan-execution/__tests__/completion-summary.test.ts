import { describe, expect, it } from 'vitest';

import { formatPlanExecutionCompletionSummary } from '../completion-summary';

describe('formatPlanExecutionCompletionSummary', () => {
  it('formats one completion line per step in approved sequence order', () => {
    const summary = formatPlanExecutionCompletionSummary({
      executionPlan: [
        { stepId: 'step-3', title: 'Run the smoke command' },
        { stepId: 'step-1', title: 'Read the existing component' },
        { stepId: 'step-2', title: 'Implement the widget' },
      ],
    });

    expect(summary.split('\n')).toEqual([
      '1. Completed "Run the smoke command" (step-3) — runner completed; behavioral validation not performed.',
      '2. Completed "Read the existing component" (step-1) — runner completed; behavioral validation not performed.',
      '3. Completed "Implement the widget" (step-2) — runner completed; behavioral validation not performed.',
      'Smoke plan completed: the runner completed all approved execution steps. Behavioral validation, assertions, behavioral coverage, and test-runner execution are not claimed.',
    ]);
  });

  it('keeps the report bounded to runner completion and preserves the non-validation language', () => {
    const summary = formatPlanExecutionCompletionSummary({
      executionPlan: [{ stepId: 'step-1', title: 'Implement the widget' }],
    });

    expect(summary).toContain('runner completed; behavioral validation not performed.');
    expect(summary).toContain(
      'Behavioral validation, assertions, behavioral coverage, and test-runner execution are not claimed.',
    );
    expect(summary).not.toMatch(/assertions (?:passed|performed)/i);
    expect(summary).not.toMatch(/behavioral coverage (?:verified|established)/i);
    expect(summary).not.toMatch(/test-runner execution (?:completed|performed)/i);
  });

  it('still emits the overall completion statement for an empty plan', () => {
    const summary = formatPlanExecutionCompletionSummary({ executionPlan: [] });

    expect(summary).toBe(
      'Smoke plan completed: the runner completed all approved execution steps. Behavioral validation, assertions, behavioral coverage, and test-runner execution are not claimed.',
    );
  });
});
