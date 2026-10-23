import { describe, expect, it, vi } from 'vitest';
import { dailySessionHandler } from '../daily-session.handler';
import type { LocalDailySessionPromptPayload } from '../../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../../session/types';
import type { AssistantCompleteEvent, MessageStamp } from '../../../run/types';
import type { OnCompleteDeps, PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';

const base64Url = (input: string): string =>
  Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const makeJwt = (payload: Record<string, unknown>): string => {
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
};

const makeRun = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'sess-1',
    provider_conversation_id: null,
    status: 'running',
    conversationId: 'conv-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    events: [],
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'cs-1',
    },
    ...overrides,
  }) as AgenticSession;

const makePayload = (
  overrides?: Partial<LocalDailySessionPromptPayload>,
): LocalDailySessionPromptPayload => ({
  payloadVersion: 1,
  ...overrides,
});

const makeDeps = (fetchData: unknown[] = []): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    fetchImpl: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: fetchData }),
    }),
    auth: createPromptTypeHandlerTestAuth('test-token'),
    apiBaseUrl: 'https://api.example.com/api/v1',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as unknown as PromptTypeHandlerDeps['logger'],
  });

describe('dailySessionHandler', () => {
  it('has the correct promptType', () => {
    expect(dailySessionHandler.promptType).toBe('daily_session');
  });

  it('declares a turn-lived provider session', () => {
    expect(dailySessionHandler.providerSessionLifetime).toBe('turn');
  });

  describe('prepare', () => {
    it('fetches activity and enriches payload', async () => {
      const fetchedRecords = [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          title: 'My Task',
          timestamp: '2026-01-01',
          linkedEntities: [],
          reports: [],
          status: 'IN_PROGRESS',
        },
      ];

      const deps = makeDeps(fetchedRecords);
      const run = makeRun();
      const payload = makePayload({ userMessage: 'What should I work on?' });

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      // The enriched payload carries internal data via _enriched
      const enriched = result.payload as LocalDailySessionPromptPayload & { _enriched?: unknown };
      expect(enriched._enriched).toBeDefined();

      // sessionContext stores the snapshot for next delta
      expect(result.sessionContext).toBeDefined();
      expect(result.sessionContext!['lastUserActivities']).toHaveLength(1);
    });

    it('computes delta against previous snapshot from sessionContext', async () => {
      const previousRecords = [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          title: 'My Task',
          timestamp: '2026-01-01',
          linkedEntities: [],
          reports: [],
          status: 'IN_PROGRESS',
        },
      ];
      const currentRecords = [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          title: 'My Task',
          timestamp: '2026-01-01',
          linkedEntities: [],
          reports: [],
          status: 'COMPLETED',
        },
      ];

      const deps = makeDeps(currentRecords);
      const run = makeRun({
        sessionContext: { lastUserActivities: previousRecords },
      });
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      // Verify via buildPrompt that the delta is present
      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).toContain('IN_PROGRESS');
      expect(prompt).toContain('COMPLETED');
    });

    it('returns original payload when auth fails', async () => {
      const deps = makeDeps();
      deps.auth.getAccessToken = vi.fn().mockRejectedValue(new Error('No token'));
      const run = makeRun();
      const payload = makePayload({ userMessage: 'hello' });

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      expect(result.payload).toBe(payload);
      expect(result.sessionContext).toBeUndefined();
    });

    it('returns original payload when context is missing', async () => {
      const deps = makeDeps();
      const run = makeRun({
        contextMetadata: {} as AgenticSession['contextMetadata'],
      });
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      expect(result.payload).toBe(payload);
    });

    it('fetches user focus from API and includes in prompt', async () => {
      const deps = makeDeps([]);
      let callCount = 0;
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (typeof url === 'string' && url.includes('/messages')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  type: 'USER',
                  data: { comment: 'Focus on auth refactor' },
                  createdAt: '2026-01-01',
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });
      const run = makeRun();
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).toContain('## User Goal');
      expect(prompt).toContain('Focus on auth refactor');
      expect(result.sessionContext!['userFocus']).toBeUndefined();
    });

    it('does not persist userFocus or previousUserFocus across firings', async () => {
      const deps = makeDeps([]);
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/messages')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { type: 'USER', data: { comment: 'New focus: deploy' }, createdAt: '2026-01-01' },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });
      const run = makeRun({
        sessionContext: { userFocus: 'Old focus: auth' },
      });
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).not.toContain('Goal shift detected');
      expect(prompt).not.toContain('Old focus: auth');
      expect(prompt).toContain('New focus: deploy');
      expect(result.sessionContext!['userFocus']).toBeUndefined();
      const enriched = (
        result.payload as LocalDailySessionPromptPayload & {
          _enriched?: { previousUserFocus?: unknown };
        }
      )._enriched;
      expect(enriched?.previousUserFocus).toBeUndefined();
    });

    it('gracefully handles user focus fetch failure', async () => {
      const deps = makeDeps([]);
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/messages')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({}),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });
      const run = makeRun();
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).not.toContain('## User Goal');
    });

    it('fetches active goals when access token yields a userId and threads them onto _enriched', async () => {
      const goal = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Ship the dashboard',
        dueDate: '2026-05-20T00:00:00.000Z',
        audience: 'PROJECT',
      };
      const token = makeJwt({ sub: 'user-1' });
      const deps = makeDeps([]);
      deps.auth.getAccessToken = vi.fn().mockResolvedValue(token);
      const goalsCalls: string[] = [];
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/goals/active')) {
          goalsCalls.push(url);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: { items: [goal], userId: 'user-1', windowDays: 30 },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });

      const run = makeRun();
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      expect(goalsCalls).toHaveLength(1);
      expect(goalsCalls[0]!).toContain('userId=user-1');

      const enriched = (
        result.payload as LocalDailySessionPromptPayload & {
          _enriched?: { activeGoals?: unknown[] };
        }
      )._enriched;
      expect(enriched?.activeGoals).toHaveLength(1);

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).toContain('## Active Goals');
      expect(prompt).toContain('Ship the dashboard');
    });

    it('omits activeGoals when the access token does not yield a userId', async () => {
      const deps = makeDeps([]);
      deps.auth.getAccessToken = vi.fn().mockResolvedValue('not-a-jwt');
      const goalsCalls: string[] = [];
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/goals/active')) {
          goalsCalls.push(url);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });

      const run = makeRun();
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      expect(goalsCalls).toEqual([]);
      const enriched = (
        result.payload as LocalDailySessionPromptPayload & {
          _enriched?: { activeGoals?: unknown };
        }
      )._enriched;
      expect(enriched?.activeGoals).toBeUndefined();

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).not.toContain('## Active Goals');
    });

    it('omits focus when no user messages exist', async () => {
      const deps = makeDeps([]);
      deps.fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/messages')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });
      const run = makeRun();
      const payload = makePayload();

      const result = await dailySessionHandler.prepare!(run, payload, deps);

      const prompt = dailySessionHandler.buildPrompt(result.payload);
      expect(prompt).not.toContain('## User Goal');
      expect(result.sessionContext!['userFocus']).toBeUndefined();
    });
  });

  describe('buildPrompt', () => {
    it('builds a minimal prompt when prepare was skipped', () => {
      const payload = makePayload({ userMessage: 'What should I work on?' });

      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).toContain('start of a new daily session');
      // The user message is appended by the resolver via addUserMessage, not
      // woven into the prompt body.
      expect(prompt).not.toContain('What should I work on?');
    });

    it('never weaves the user message into the prompt body', () => {
      const payload = makePayload({ userMessage: 'What should I work on?' });

      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).not.toContain('User Message');
    });

    it('formats the user message under its heading via addUserMessage, or null when unset', () => {
      expect(
        dailySessionHandler.addUserMessage(makePayload({ userMessage: 'What should I work on?' })),
      ).toBe('\n\n## User Message\n\nWhat should I work on?');
      expect(dailySessionHandler.addUserMessage(makePayload())).toBeNull();
    });

    it('includes available report types in prompt', () => {
      const payload = makePayload();
      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).toContain('GOAL_PROGRESS');
      expect(prompt).toContain('RISK_ALERT');
      expect(prompt).toContain('SESSION_SUMMARY');
    });

    it('includes report priority rules', () => {
      const payload = makePayload();
      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).toContain('Report Priority');
      expect(prompt).toContain('Goal alignment');
      expect(prompt).toContain('Risks');
      expect(prompt).toContain('Session context');
    });

    it('includes responseType instruction', () => {
      const payload = makePayload();
      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).toContain('"responseType": "daily_session_v1"');
    });

    it('includes report output instructions', () => {
      const payload = makePayload();
      const prompt = dailySessionHandler.buildPrompt(payload);

      expect(prompt).toContain('"reports"');
      expect(prompt).toContain('"reportType"');
      expect(prompt).toContain('"text"');
    });
  });

  describe('buildStartingMessage', () => {
    it('returns a starting message', () => {
      const msg = dailySessionHandler.buildStartingMessage!(makePayload());
      expect(msg).toBe('Starting your daily session...');
    });
  });

  describe('onComplete', () => {
    it('navigates named owners directly and preserves the Turn message stamp', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: { id: 'daily-report-1' } }), { status: 201 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: { id: 'child-report-1' } }), { status: 201 }),
        );
      const update = vi.fn().mockResolvedValue(undefined);
      const registerReport = vi.fn();
      const emitDailySessionUpdate = vi.fn();
      const deps: OnCompleteDeps = createOnCompleteTestDeps({
        fetchImpl: fetchImpl as typeof fetch,
        auth: createPromptTypeHandlerTestAuth('test-token'),
        apiBaseUrl: 'https://api.example.com/api/v1',
        logger: makeDeps().logger,
      });
      vi.mocked(deps.poster.update).mockImplementation(update);
      vi.mocked(deps.reportIndex.registerReport).mockImplementation(registerReport);
      vi.mocked(deps.platformWebSocketManager.emitDailySessionUpdate).mockImplementation(
        emitDailySessionUpdate,
      );
      const stamp: MessageStamp = {
        providerSessionId: 'provider-session-1',
        promptHandler: 'daily_session',
      };
      const event = {
        kind: 'assistant_complete',
        runId: 'run-1',
        source: 'provider',
        eventType: 'assistant_complete',
        timestamp: '2026-01-01T00:00:00.000Z',
        sessionId: 'provider-session-1',
        agentId: 'daily_session',
        payload: {},
        summary: JSON.stringify({
          responseType: 'daily_session_v1',
          response: 'Here is your briefing.',
          reports: [{ reportType: 'GOAL_PROGRESS', text: 'The goal is on track.' }],
        }),
      } satisfies AssistantCompleteEvent;

      await dailySessionHandler.onComplete!(
        event,
        {
          runId: 'run-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          messageId: 'message-1',
          stamp,
        },
        deps,
      );

      expect(registerReport).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(
        'org-1',
        'proj-1',
        'message-1',
        expect.objectContaining({
          data: expect.objectContaining({ reportId: 'daily-report-1' }),
        }),
        stamp,
      );
      expect(emitDailySessionUpdate).toHaveBeenCalledWith({
        projectId: 'proj-1',
        sessionId: 'run-1',
        updateType: 'briefing_ready',
      });
    });
  });
});
