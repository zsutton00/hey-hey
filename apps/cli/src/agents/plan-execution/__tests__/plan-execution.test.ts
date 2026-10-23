import { describe, expect, it, vi } from 'vitest';
import { buildPlanExecutionPrompt } from '../../prompts/plan-execution';
import type { LocalPlanExecutionPromptPayload } from '../../../shared/agent-bridge-contract/index';
import type { AgenticSession } from '../../../session/types';
import type { AssistantCompleteEvent } from '../../../run/types';
import {
  createOnCompleteTestDeps,
  createOnCompleteTestMessagePoster,
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestRunStore,
} from '../../prompt-type-handler.test-support';
import { planExecutionHandler } from '../plan-execution.handler';

const minimalPayload = (): LocalPlanExecutionPromptPayload => ({
  plan: {
    responseType: 'startup_plan_v1',
    sessionTitle: 'Add widget to dashboard',
    requiredServiceIds: ['svc-1'] as unknown as Set<string>,
    primaryImplementations: [
      {
        title: 'Dashboard widget',
        content: 'export const DashboardWidget = () => <Widget />;',
        language: 'TypeScript',
        location: 'src/components/dashboard-widget.tsx',
        rationale: 'The widget component is the primary delivered behavior.',
      },
    ],
    executionPlan: [
      {
        stepId: 'step-1',
        title: 'Read existing component',
        description: 'Understand current structure',
        phase: 1,
        references: [],
      },
      {
        stepId: 'step-2',
        title: 'Implement widget',
        description: 'Add the widget code',
        phase: 2,
        references: [],
      },
    ],
    discrepancies: [],
    clarificationQuestions: [],
  },
  review: {
    responseType: 'startup_plan_review_v1',
    questionAnswers: [],
    discrepancyDispositions: [],
  },
});

describe('buildPlanExecutionPrompt', () => {
  it('includes the session title', () => {
    const prompt = buildPlanExecutionPrompt(minimalPayload());
    expect(prompt).toContain('Add widget to dashboard');
  });

  it('includes each execution step', () => {
    const prompt = buildPlanExecutionPrompt(minimalPayload());
    expect(prompt).toContain('step-1');
    expect(prompt).toContain('Read existing component');
    expect(prompt).toContain('step-2');
    expect(prompt).toContain('Implement widget');
  });

  it('instructs the agent to execute without re-planning', () => {
    const prompt = buildPlanExecutionPrompt(minimalPayload());
    expect(prompt).toContain('do not re-plan');
    expect(prompt).toContain('Begin executing immediately');
  });

  it('includes question answers when present', () => {
    const payload = minimalPayload();
    payload.review.questionAnswers = [{ question: 'Which dashboard?', answer: 'The main one' }];
    const prompt = buildPlanExecutionPrompt(payload);
    expect(prompt).toContain('Which dashboard?');
    expect(prompt).toContain('The main one');
  });

  it('includes discrepancy dispositions when present', () => {
    const payload = minimalPayload();
    payload.review.discrepancyDispositions = [
      { discrepancyIndex: 0, disposition: 'acknowledged', note: 'We are aware' },
    ];
    const prompt = buildPlanExecutionPrompt(payload);
    expect(prompt).toContain('Discrepancy [0]');
    expect(prompt).toContain('acknowledged');
    expect(prompt).toContain('We are aware');
  });

  it('includes discrepancies from the plan when present', () => {
    const payload = minimalPayload();
    payload.plan.discrepancies = [
      {
        severity: 'low',
        discrepancyText: 'Missing import',
        reasoning: 'Will add import in step 1',
        sourceRef: { sourceType: 'task', sourceId: 'task-1' },
        sourceField: 'description',
        sourceExcerpt: 'Some excerpt',
      },
    ];
    const prompt = buildPlanExecutionPrompt(payload);
    expect(prompt).toContain('Missing import');
    expect(prompt).toContain('Will add import in step 1');
  });

  it('includes clarification questions from the plan when present', () => {
    const payload = minimalPayload();
    payload.plan.clarificationQuestions = [
      { question: 'Does this need a test?', reason: 'Unclear from spec' },
    ];
    const prompt = buildPlanExecutionPrompt(payload);
    expect(prompt).toContain('Does this need a test?');
  });

  it('includes user feedback when provided', () => {
    const payload = minimalPayload();
    payload.feedback = 'Please focus on step 2 first';
    const prompt = buildPlanExecutionPrompt(payload);
    expect(prompt).toContain('Please focus on step 2 first');
  });

  it('handles empty discrepancies and questions gracefully', () => {
    const prompt = buildPlanExecutionPrompt(minimalPayload());
    // Empty plan-body sections are omitted entirely; review fallback remains.
    expect(prompt).not.toContain('## Discrepancies');
    expect(prompt).not.toContain('## Clarification Questions');
    expect(prompt).toContain('(no additional review notes)');
  });
});

describe('planExecutionHandler lifecycle', () => {
  it('stashes the approved execution order for completion reporting', async () => {
    const logger = {
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    const payload = minimalPayload();
    const run = { agentic_session_id: 'run-1' } as AgenticSession;

    const result = await planExecutionHandler.prepare!(
      run,
      payload,
      createPromptTypeHandlerTestDeps({ logger }),
    );

    expect(result.payload).toBe(payload);
    expect(result.sessionContext).toEqual({
      'planExecution.approvedExecutionPlan': [
        { stepId: 'step-1', title: 'Read existing component' },
        { stepId: 'step-2', title: 'Implement widget' },
      ],
    });
  });

  it('appends the ordered smoke-plan summary to the completed response', async () => {
    const runStore = createPromptTypeHandlerTestRunStore();
    vi.mocked(runStore.getRun).mockResolvedValue({
      sessionContext: {
        'planExecution.approvedExecutionPlan': [
          { stepId: 'step-1', title: 'Read existing component' },
          { stepId: 'step-2', title: 'Implement widget' },
        ],
      },
    } as unknown as AgenticSession);
    const poster = createOnCompleteTestMessagePoster();
    const deps = createOnCompleteTestDeps({ runStore, poster });
    const event = { summary: 'The approved work is complete.' } as AssistantCompleteEvent;

    await planExecutionHandler.onComplete!(
      event,
      {
        runId: 'run-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        stamp: null,
      },
      deps,
    );

    expect(poster.update).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'message-1',
      {
        data: {
          response: expect.stringContaining(
            '1. Completed "Read existing component" (step-1) — runner completed; behavioral validation not performed.',
          ),
        },
      },
      null,
    );
    const response = vi.mocked(poster.update).mock.calls[0]?.[3].data as { response: string };
    expect(response.response).toContain('The approved work is complete.');
    expect(response.response.split('\n\n')[1]?.split('\n')).toEqual([
      '1. Completed "Read existing component" (step-1) — runner completed; behavioral validation not performed.',
      '2. Completed "Implement widget" (step-2) — runner completed; behavioral validation not performed.',
      'Smoke plan completed: the runner completed all approved execution steps. Behavioral validation, assertions, behavioral coverage, and test-runner execution are not claimed.',
    ]);
  });

  it('does not update the message when approved execution context is missing', async () => {
    const runStore = createPromptTypeHandlerTestRunStore();
    const poster = createOnCompleteTestMessagePoster();
    const logger = {
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    const deps = createOnCompleteTestDeps({ runStore, poster, logger });

    await planExecutionHandler.onComplete!(
      { summary: 'The runner returned.' } as AssistantCompleteEvent,
      {
        runId: 'run-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        stamp: null,
      },
      deps,
    );

    expect(poster.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('plan_execution.on_complete.missing_approved_plan', {
      runId: 'run-1',
      messageId: 'message-1',
    });
  });

  it('does not invent completion output when approved execution context is malformed', async () => {
    const runStore = createPromptTypeHandlerTestRunStore();
    vi.mocked(runStore.getRun).mockResolvedValue({
      sessionContext: {
        'planExecution.approvedExecutionPlan': [{ title: 'Missing the required step identifier' }],
      },
    } as unknown as AgenticSession);
    const poster = createOnCompleteTestMessagePoster();
    const logger = {
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    const deps = createOnCompleteTestDeps({ runStore, poster, logger });

    await planExecutionHandler.onComplete!(
      { summary: 'The runner returned.' } as AssistantCompleteEvent,
      {
        runId: 'run-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        stamp: null,
      },
      deps,
    );

    expect(poster.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('plan_execution.on_complete.missing_approved_plan', {
      runId: 'run-1',
      messageId: 'message-1',
    });
  });
});
