import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated';
import type { LocalDailySessionPromptPayload } from '../../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../../session/types';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestAuth,
} from '../../prompt-type-handler.test-support';
import { dailySessionCoachHandler } from '../daily-session-coach.handler';
import type { DailySessionCoachPromptInput, DailySessionEnrichedPayload } from '../types';

const makeRun = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'session-1',
    provider_conversation_id: null,
    status: 'running',
    conversationId: 'conversation-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    events: [],
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: 'agent-session-1',
    },
    ...overrides,
  }) as AgenticSession;

const makePayload = (
  overrides: Partial<LocalDailySessionPromptPayload> = {},
): LocalDailySessionPromptPayload => ({ payloadVersion: 1, ...overrides });

describe('dailySessionCoachHandler', () => {
  it('uses the Daily Session route with a fresh provider turn and no report contract', () => {
    expect(dailySessionCoachHandler.id).toBe('daily_session_coach');
    expect(dailySessionCoachHandler.promptType).toBe(LocalPromptType.DailySession);
    expect(dailySessionCoachHandler.providerSessionLifetime).toBe('turn');
    expect(dailySessionCoachHandler.expectedResponseTypes).toEqual([]);
    expect(dailySessionCoachHandler.reports).toEqual([]);
  });

  it('assembles focus, work-item activity, and project-scoped attention once', async () => {
    const activity = {
      entityId: 'task-1',
      entityType: 'TASK',
      title: 'Build the dashboard',
      timestamp: '2026-01-02T11:00:00.000Z',
      linkedEntities: [],
      reports: [],
      status: 'ACTIVE',
    };
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/activity-correlations')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [activity] }), { status: 200 }));
      }
      if (url.includes('/messages')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: [{ type: 'USER', data: { comment: 'Ship the dashboard' } }] }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('/analytics/attention')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                events: [
                  {
                    id: 'attention-1',
                    entityType: 'TASK',
                    entityId: 'task-2',
                    entityName: 'Review metrics',
                    focusStart: '2026-01-02T10:00:00.000Z',
                    focusEnd: '2026-01-02T10:05:00.000Z',
                    durationMs: 300000,
                  },
                ],
                pagination: { total: 1 },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    const deps = createPromptTypeHandlerTestDeps({
      fetchImpl,
      auth: createPromptTypeHandlerTestAuth('test-token'),
      apiBaseUrl: 'https://api.example.com/api/v1',
    });

    const result = await dailySessionCoachHandler.prepare!(makeRun(), makePayload(), deps);
    const enriched = (result.payload as DailySessionEnrichedPayload<DailySessionCoachPromptInput>)
      ._enriched;

    expect(enriched?.userFocus).toBe('Ship the dashboard');
    expect(enriched?.activitySnapshot).toHaveLength(1);
    expect(enriched?.attentionEvidence).toEqual([
      {
        entityType: 'TASK',
        entityId: 'task-2',
        entityName: 'Review metrics',
        focusStart: '2026-01-02T10:00:00.000Z',
        focusEnd: '2026-01-02T10:05:00.000Z',
        durationMs: 300000,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain('projectId=project-1');
    expect(result.sessionContext?.['lastUserActivities']).toHaveLength(1);
  });

  it('keeps the coach prompt usable when attention is unavailable', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/activity-correlations')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      }
      if (url.includes('/messages')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 503 }));
    });
    const deps = createPromptTypeHandlerTestDeps({
      fetchImpl,
      auth: createPromptTypeHandlerTestAuth('test-token'),
    });

    const result = await dailySessionCoachHandler.prepare!(makeRun(), makePayload(), deps);
    const enriched = (result.payload as DailySessionEnrichedPayload<DailySessionCoachPromptInput>)
      ._enriched;

    expect(enriched?.attentionEvidence).toEqual([]);
    expect(dailySessionCoachHandler.buildPrompt(result.payload)).toContain(
      '## Observed Attention Evidence',
    );
  });

  it('posts follow-up text under the existing Daily Session user-message boundary', () => {
    expect(
      dailySessionCoachHandler.addUserMessage(
        makePayload({ userMessage: 'What should I do next?' }),
      ),
    ).toBe('\n\n## User Message\n\nWhat should I do next?');
    expect(dailySessionCoachHandler.addUserMessage(makePayload())).toBeNull();
  });
});
