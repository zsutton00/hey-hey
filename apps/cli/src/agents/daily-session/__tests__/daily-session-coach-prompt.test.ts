import { describe, expect, it } from 'vitest';
import { buildDailySessionCoachPrompt } from '../daily-session-coach-prompt';
import type { DailySessionCoachPromptInput } from '../types';

const makeInput = (
  overrides: Partial<DailySessionCoachPromptInput> = {},
): DailySessionCoachPromptInput => ({
  activitySnapshot: [],
  computedDelta: {
    statusChanges: [],
    itemCompletions: [],
    newSignals: [],
    computedAt: '2026-01-02T12:00:00.000Z',
  },
  attentionEvidence: [],
  ...overrides,
});

describe('buildDailySessionCoachPrompt', () => {
  it('keeps focus, work-item evidence, snapshot, and attention in separate sections', () => {
    const prompt = buildDailySessionCoachPrompt(
      makeInput({
        userFocus: 'Ship the dashboard',
        computedDelta: {
          statusChanges: [
            {
              entityId: 'task-1',
              entityType: 'TASK',
              title: 'Build the dashboard',
              previousStatus: 'BACKLOG',
              currentStatus: 'ACTIVE',
              changedAt: '2026-01-02T11:00:00.000Z',
            },
          ],
          itemCompletions: [],
          newSignals: [],
          computedAt: '2026-01-02T12:00:00.000Z',
        },
        activitySnapshot: [
          {
            entityId: 'task-1',
            entityType: 'TASK',
            title: 'Build the dashboard',
            timestamp: '2026-01-02T11:00:00.000Z',
            linkedEntities: [],
            reports: [],
          } as never,
        ],
        attentionEvidence: [
          {
            entityType: 'TASK',
            entityId: 'task-2',
            entityName: 'Review metrics',
            focusStart: '2026-01-02T10:00:00.000Z',
            focusEnd: '2026-01-02T10:05:00.000Z',
            durationMs: 300000,
          },
        ],
      }),
    );

    expect(prompt).toContain('## Declared Focus\n\nShip the dashboard');
    expect(prompt).toContain('## Recent Work-Item Changes');
    expect(prompt).toContain('## Current Work-Item Snapshot');
    expect(prompt).toContain('## Observed Attention Evidence');
    expect(prompt.indexOf('## Declared Focus')).toBeLessThan(
      prompt.indexOf('## Recent Work-Item Changes'),
    );
    expect(prompt.indexOf('## Recent Work-Item Changes')).toBeLessThan(
      prompt.indexOf('## Current Work-Item Snapshot'),
    );
    expect(prompt.indexOf('## Current Work-Item Snapshot')).toBeLessThan(
      prompt.indexOf('## Observed Attention Evidence'),
    );
  });

  it('frames attention as observation rather than intent or completion', () => {
    const prompt = buildDailySessionCoachPrompt(makeInput());

    expect(prompt).toContain('behavioral evidence');
    expect(prompt).toContain(
      'Never treat attention, duration, a viewed page, or a heartbeat as proof',
    );
    expect(prompt).toContain('without proving it');
    expect(prompt).toContain('Do not invent a focus, completion, or mismatch');
  });

  it('omits an absent focus and keeps the output contract conversational', () => {
    const prompt = buildDailySessionCoachPrompt(makeInput({ userMessage: 'What next?' }));

    expect(prompt).not.toContain('## Declared Focus');
    expect(prompt).not.toContain('What next?');
    expect(prompt).toContain('exactly one concise, conversational assistant message');
    expect(prompt).toContain('return the message text only');
    expect(prompt).not.toContain('responseType": "daily_session_v1');
  });
});
