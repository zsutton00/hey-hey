import { describe, expect, it } from 'vitest';
import { validationWalkthroughHandler } from '../validation.handler';
import {
  LocalPromptType,
  LocalValidationWalkthroughPromptPayloadScopeEnum,
} from '../../../shared/agent-bridge-contract/generated/api';
import { ReportAudience, ReportType } from '../../../shared/api/index';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_TASK_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_STAGE_ID = '33333333-3333-4333-8333-333333333333';

describe('validationWalkthroughHandler', () => {
  it('registers under the validation_walkthrough prompt type', () => {
    expect(validationWalkthroughHandler.promptType).toBe(LocalPromptType.ValidationWalkthrough);
  });

  it('runs on the persisted provider session', () => {
    expect(validationWalkthroughHandler.runnerKind).toBe('provider_session');
    expect(validationWalkthroughHandler.subagentConfig).toBeUndefined();
  });

  it('declares a required VALIDATION_WALKTHROUGH EXTERNAL report', () => {
    expect(validationWalkthroughHandler.reports).toEqual([
      {
        reportType: ReportType.ValidationWalkthrough,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
    ]);
  });

  it('declares no submission tools — the turn terminates after the run-scoped create_report wrapper fires', () => {
    expect(validationWalkthroughHandler.submissionTools).toBeUndefined();
  });

  it('exposes the read-only platform MCP tools the prompt depends on, without the platform create_report', () => {
    const tools = validationWalkthroughHandler.additionalAllowedTools ?? [];
    expect(tools).toEqual(
      expect.arrayContaining([
        'list_reports_by_entity',
        'get_report_body',
        'get_report_schema',
        'get_context',
        'get_full_entity',
      ]),
    );
    // create_report is provided by the run-scoped submission tool wrapper, not
    // the platform MCP tool.
    expect(tools).not.toContain('create_report');
  });

  it('exposes a starting message naming the validation framing', () => {
    expect(
      validationWalkthroughHandler.buildStartingMessage?.({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      }),
    ).toMatch(/validate/i);
  });

  describe('buildPrompt', () => {
    it('returns the task-scope section for a single-task launch', () => {
      const prompt = validationWalkthroughHandler.buildPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toMatch(/Launch context: single task/);
      expect(prompt).toContain(TASK_ID);
    });

    it('returns the parent-task-scope section for a parent-task launch', () => {
      const prompt = validationWalkthroughHandler.buildPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.ParentTask,
        entityId: PARENT_TASK_ID,
      });
      expect(prompt).toMatch(/Launch context: parent task with split children/);
      expect(prompt).toContain(PARENT_TASK_ID);
    });

    it('returns the plan-stage-scope section for a plan-stage launch', () => {
      const prompt = validationWalkthroughHandler.buildPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.PlanStage,
        entityId: PLAN_STAGE_ID,
      });
      expect(prompt).toMatch(/Launch context: plan stage/);
      expect(prompt).toContain(PLAN_STAGE_ID);
    });
  });
});

describe('validation_walkthrough registry wiring', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers the handler under its promptType key', async () => {
    expect(registry.get(LocalPromptType.ValidationWalkthrough)?.promptType).toBe(
      LocalPromptType.ValidationWalkthrough,
    );
  });

  it('does not resolve typo or sibling-shaped promptTypes to the validation handler', async () => {
    expect(registry.get('VALIDATION_WALKTHROUGH')).toBeUndefined();
    expect(registry.get('validation')).toBeUndefined();
  });
});
