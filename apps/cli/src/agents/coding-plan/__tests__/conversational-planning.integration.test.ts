import { describe, expect, it } from 'vitest';
import { codingPlanHandler } from '../coding-plan.handler';

describe('conversational planning approval boundary', () => {
  it('leaves approval to the user and requires no PLAN report', () => {
    expect(codingPlanHandler.reports ?? []).toEqual([]);
    expect(codingPlanHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'emit_coding_plan_discrepancy',
      'ask_coding_plan_question',
      'emit_coding_plan',
    ]);
    expect(codingPlanHandler.submissionTools?.every((tool) => tool.kind === 'pass_through')).toBe(
      true,
    );
  });
});
