import { describe, expect, it } from 'vitest';
import type { AgenticSessionEvent } from '../session/index';
import { validateStartupPlanFromEvents } from './agent-startup-response';

const createEvent = (input: {
  seq: number;
  eventType: AgenticSessionEvent['event_type'];
  payload?: AgenticSessionEvent['payload'];
}): AgenticSessionEvent => ({
  seq: input.seq,
  ts: new Date('2026-02-14T00:00:00.000Z').toISOString(),
  app_session_id: 'cli-session-1',
  run_id: 'run-1',
  actor: 'agent',
  event_type: input.eventType,
  state_version: 1,
  ...(input.payload ? { payload: input.payload } : {}),
});

describe('validateStartupPlanFromEvents', () => {
  it('parses structured startup output and returns summary metrics', () => {
    const events = [
      createEvent({
        seq: 1,
        eventType: 'agent_output',
        payload: {
          messageType: 'assistant',
          summary: JSON.stringify({
            responseType: 'startup_plan_v1',
            sessionTitle: 'Inspect command wiring',
            requiredServiceIds: ['service-cli'],
            primaryImplementations: [
              {
                title: 'Primary implementation',
                content: 'Concrete implementation body.',
                rationale: 'Defines the primary delivered behavior.',
              },
            ],
            executionPlan: [
              {
                stepId: 'step-1',
                title: 'Inspect code',
                description: 'Review current command wiring.',
                phase: 1,
                references: [],
              },
            ],
            discrepancies: [
              {
                sourceRef: {
                  sourceType: 'task',
                  sourceId: 'task-1',
                },
                sourceExcerpt: 'Task says A.',
                reasoning: 'Code does B.',
                discrepancyText: 'Mismatch between task and code.',
                severity: 'medium',
              },
            ],
            clarificationQuestions: [
              {
                question: 'Should we keep legacy command alias?',
              },
            ],
          }),
        },
      }),
    ];

    const result = validateStartupPlanFromEvents({
      events,
      baselineEventCount: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.metrics.steps).toBe(1);
    expect(result.metrics.discrepancies).toBe(1);
    expect(result.metrics.clarificationQuestions).toBe(1);
  });

  it('returns a recoverable error when startup output is not parseable', () => {
    const events = [
      createEvent({
        seq: 1,
        eventType: 'agent_output',
        payload: {
          messageType: 'assistant',
          summary: '{ not valid json',
        },
      }),
    ];

    const result = validateStartupPlanFromEvents({
      events,
      baselineEventCount: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/No JSON object found|Invalid JSON payload/u);
  });

  it('returns a recoverable error when no assistant startup response is present', () => {
    const events = [
      createEvent({
        seq: 1,
        eventType: 'run_started',
      }),
    ];

    const result = validateStartupPlanFromEvents({
      events,
      baselineEventCount: 0,
    });

    expect(result).toEqual({
      ok: false,
      error: 'No assistant response was captured for startup validation.',
    });
  });
});
