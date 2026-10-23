/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import { createTestRunStore } from '../../run/run.test-support';
import type { AgenticSession, AgenticSessionContextMetadata } from '../../session';
import { NOOP_LOGGER } from '../logger';
import { ProjectSessionCostsService } from './project-session-costs.service';

const organizationId = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000002';
const otherProjectId = '30000000-0000-4000-8000-000000000003';
const requestId = '40000000-0000-4000-8000-000000000004';
const agentSessionId = '50000000-0000-4000-8000-000000000005';

const createSession = (
  agentSessionId: string,
  overrides: Partial<AgenticSession> = {},
): AgenticSession => ({
  entity: null,
  agentic_session_id: agentSessionId,
  services: [],
  provider: 'codex',
  provider_session_id: '',
  provider_conversation_id: null,
  provider_session_history: [],
  status: 'idle',
  conversationId: agentSessionId,
  contextMetadata: {
    capturedAt: '2026-07-27T00:00:00.000Z',
    organizationId,
    projectId,
    agentSessionId,
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  } as AgenticSessionContextMetadata,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  events: [],
  ...overrides,
});

const createSubject = (
  runs: AgenticSession[],
  readCcusageSessionJson: (providerId: 'claude' | 'codex') => Promise<string>,
) => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'listRuns').mockResolvedValue(runs);
  return new ProjectSessionCostsService({
    runStore,
    logger: NOOP_LOGGER,
    readCcusageSessionJson,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
  });
};

describe('ProjectSessionCostsService', () => {
  it('aggregates Run-owned members once per provider and preserves partial and empty history', async () => {
    const partialRun = createSession('50000000-0000-4000-8000-000000000005', {
      provider_session_history: [
        {
          providerSessionId: 'provider-session-a',
          providerConversationId: 'conversation-a',
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-26T10:00:00.000Z',
        },
        {
          providerSessionId: 'provider-session-b',
          providerConversationId: null,
          providerSessionAgentId: 'coding_freeform',
          observedAt: '2026-07-26T11:00:00.000Z',
        },
      ],
    });
    const emptyRun = createSession('60000000-0000-4000-8000-000000000006', {
      updatedAt: '2026-07-26T00:00:00.000Z',
    });
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [{ sessionId: 'provider-session-a', costUSD: 4.25 }],
        }),
      ),
    );

    const result = await createSubject([partialRun, emptyRun], readCcusageSessionJson).list(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      organizationId,
    );

    expect(readCcusageSessionJson).toHaveBeenCalledTimes(1);
    expect(readCcusageSessionJson).toHaveBeenCalledWith(
      'codex',
      undefined,
      expect.objectContaining({ sessionIds: ['provider-session-a', 'provider-session-b'] }),
    );
    expect(result.sourceAvailability).toBe('available');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      agentSessionId: partialRun.agentic_session_id,
      knownCostUsd: 4.25,
      completeness: 'partial',
      providerSessions: [
        { providerSessionId: 'provider-session-a', cost: { state: 'available', amountUsd: 4.25 } },
        { providerSessionId: 'provider-session-b', cost: { state: 'unavailable' } },
      ],
    });
    expect(result.items[1]).toMatchObject({
      agentSessionId: emptyRun.agentic_session_id,
      knownCostUsd: null,
      completeness: 'unavailable',
      providerSessions: [],
    });
  });

  it('includes subagent session members in the agent session total', async () => {
    const run = createSession(agentSessionId, {
      provider_session_history: [
        {
          providerSessionId: 'implementer-session',
          providerConversationId: null,
          providerSessionAgentId: 'coding_freeform',
          observedAt: '2026-07-26T10:00:00.000Z',
        },
        {
          providerSessionId: 'reviewer-session',
          providerConversationId: null,
          providerSessionAgentId: 'code_review',
          observedAt: '2026-07-26T11:00:00.000Z',
        },
      ],
    });
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [
            { sessionId: 'implementer-session', costUSD: 3 },
            { sessionId: 'reviewer-session', costUSD: 0.5 },
          ],
        }),
      ),
    );

    const result = await createSubject([run], readCcusageSessionJson).list(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      organizationId,
    );

    expect(result.items[0]).toMatchObject({
      agentSessionId,
      knownCostUsd: 3.5,
      completeness: 'complete',
      providerSessions: [
        { providerSessionId: 'implementer-session', cost: { amountUsd: 3 } },
        { providerSessionId: 'reviewer-session', cost: { amountUsd: 0.5 } },
      ],
    });
  });

  it('filters before stable equal-activity pagination and rejects a cursor under changed filters', async () => {
    const lowId = '70000000-0000-4000-8000-000000000007';
    const highId = '80000000-0000-4000-8000-000000000008';
    const excludedId = '90000000-0000-4000-8000-000000000009';
    const makeCostRun = (agentSessionId: string, providerSessionId: string, updatedAt: string) =>
      createSession(agentSessionId, {
        updatedAt,
        provider_session_history: [
          {
            providerSessionId,
            providerConversationId: null,
            providerSessionAgentId: 'implement',
            observedAt: updatedAt,
          },
        ],
      });
    const runs = [
      makeCostRun(lowId, 'session-low', '2026-07-26T10:00:00.000Z'),
      makeCostRun(highId, 'session-high', '2026-07-26T10:00:00.000Z'),
      makeCostRun(excludedId, 'session-excluded', '2026-07-25T10:00:00.000Z'),
      createSession('a0000000-0000-4000-8000-00000000000a', {
        contextMetadata: {
          ...createSession(lowId).contextMetadata,
          projectId: otherProjectId,
        },
      }),
    ];
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [
            { sessionId: 'session-low', costUSD: 2 },
            { sessionId: 'session-high', costUSD: 3 },
            { sessionId: 'session-excluded', costUSD: 5 },
          ],
        }),
      ),
    );
    const subject = createSubject(runs, readCcusageSessionJson);
    const request = {
      requestId,
      agentSessionId,
      operation: 'project.session_costs.list' as const,
      projectId,
      activityFrom: '2026-07-26T00:00:00.000Z',
      minKnownCostUsd: 2,
      limit: 1,
    };

    const first = await subject.list(request, organizationId);
    expect(first.items.map(({ agentSessionId }) => agentSessionId)).toEqual([highId]);
    expect(first.nextCursor).not.toBeNull();
    const second = await subject.list({ ...request, cursor: first.nextCursor }, organizationId);
    expect(second.items.map(({ agentSessionId }) => agentSessionId)).toEqual([lowId]);
    expect(second.nextCursor).toBeNull();

    await expect(
      subject.list(
        {
          ...request,
          minKnownCostUsd: 3,
          cursor: first.nextCursor,
        },
        organizationId,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('scopes provider-session history inclusively before aggregation and pagination', async () => {
    const longLivedRun = createSession('e0000000-0000-4000-8000-00000000000e', {
      updatedAt: '2026-08-15T00:00:00.000Z',
      provider_session_history: [
        {
          providerSessionId: 'period-lower-bound',
          providerConversationId: 'conversation-lower-bound',
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          providerSessionId: 'period-legacy-member',
          providerConversationId: null,
          providerSessionAgentId: null,
          observedAt: '2026-07-15T12:00:00.000Z',
        },
        {
          providerSessionId: 'period-upper-bound',
          providerConversationId: 'conversation-upper-bound',
          providerSessionAgentId: 'coding_freeform',
          observedAt: '2026-07-31T23:59:59.999Z',
        },
        {
          providerSessionId: 'outside-before-period',
          providerConversationId: 'conversation-before',
          providerSessionAgentId: 'implement',
          observedAt: '2026-06-30T23:59:59.999Z',
        },
        {
          providerSessionId: 'outside-after-period',
          providerConversationId: 'conversation-after',
          providerSessionAgentId: 'implement',
          observedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    const nextRun = createSession('f0000000-0000-4000-8000-00000000000f', {
      updatedAt: '2026-07-30T10:00:00.000Z',
      provider_session_history: [
        {
          providerSessionId: 'period-next',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-30T10:00:00.000Z',
        },
      ],
    });
    const belowMinimumRun = createSession('a1000000-0000-4000-8000-00000000000a', {
      updatedAt: '2026-07-29T10:00:00.000Z',
      provider_session_history: [
        {
          providerSessionId: 'period-below-minimum',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-29T10:00:00.000Z',
        },
      ],
    });
    const outsideOnlyRun = createSession('b1000000-0000-4000-8000-00000000000b', {
      updatedAt: '2026-07-28T10:00:00.000Z',
      provider_session_history: [
        {
          providerSessionId: 'outside-only',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-06-30T10:00:00.000Z',
        },
      ],
    });
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [
            { sessionId: 'period-lower-bound', costUSD: 2 },
            { sessionId: 'period-legacy-member', costUSD: 3 },
            { sessionId: 'period-upper-bound', costUSD: 4 },
            { sessionId: 'outside-before-period', costUSD: 100 },
            { sessionId: 'outside-after-period', costUSD: 200 },
            { sessionId: 'period-next', costUSD: 6 },
            { sessionId: 'period-below-minimum', costUSD: 1 },
            { sessionId: 'outside-only', costUSD: 50 },
          ],
        }),
      ),
    );
    const subject = createSubject(
      [longLivedRun, nextRun, belowMinimumRun, outsideOnlyRun],
      readCcusageSessionJson,
    );
    const request = {
      requestId,
      agentSessionId,
      operation: 'project.session_costs.list' as const,
      projectId,
      activityFrom: '2026-07-01',
      activityTo: '2026-07-31T23:59:59.999Z',
      minKnownCostUsd: 5,
      limit: 1,
    };

    const first = await subject.list(request, organizationId);
    expect(first.items.map(({ agentSessionId }) => agentSessionId)).toEqual([
      longLivedRun.agentic_session_id,
    ]);
    expect(first.items[0]).toMatchObject({
      knownCostUsd: 9,
      completeness: 'complete',
      latestActivityAt: '2026-07-31T23:59:59.999Z',
      providerSessions: [
        {
          providerSessionId: 'period-lower-bound',
          observedAt: '2026-07-01T00:00:00.000Z',
          cost: { state: 'available', amountUsd: 2 },
        },
        {
          providerSessionId: 'period-legacy-member',
          providerSessionAgentId: null,
          cost: { state: 'available', amountUsd: 3 },
        },
        {
          providerSessionId: 'period-upper-bound',
          observedAt: '2026-07-31T23:59:59.999Z',
          cost: { state: 'available', amountUsd: 4 },
        },
      ],
    });
    expect(first.items[0]?.providerSessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerSessionId: 'outside-before-period' }),
        expect.objectContaining({ providerSessionId: 'outside-after-period' }),
      ]),
    );
    expect(first.nextCursor).not.toBeNull();

    const second = await subject.list({ ...request, cursor: first.nextCursor }, organizationId);
    expect(second.items.map(({ agentSessionId }) => agentSessionId)).toEqual([
      nextRun.agentic_session_id,
    ]);
    expect(second.items[0]).toMatchObject({ knownCostUsd: 6, latestActivityAt: nextRun.updatedAt });
    expect(second.nextCursor).toBeNull();
    // Pagination reuses the same validated provider report inside its freshness window.
    expect(readCcusageSessionJson).toHaveBeenCalledTimes(1);
  });

  it('keeps a whole provider-source failure distinct from an empty project', async () => {
    const run = createSession('b0000000-0000-4000-8000-00000000000b', {
      provider_session_history: [
        {
          providerSessionId: 'provider-session-failed',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-26T10:00:00.000Z',
        },
      ],
    });
    const readCcusageSessionJson = vi.fn(() => Promise.reject(new Error('ccusage unavailable')));

    const result = await createSubject([run], readCcusageSessionJson).list(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      organizationId,
    );

    expect(result).toMatchObject({
      sourceAvailability: 'unavailable',
      items: [
        {
          agentSessionId: run.agentic_session_id,
          knownCostUsd: null,
          completeness: 'unavailable',
          providerSessions: [{ cost: { state: 'unavailable', reason: 'cost_source_unavailable' } }],
        },
      ],
    });
  });

  it('reports partial source availability while retaining complete supported-provider rows', async () => {
    const codexRun = createSession('c0000000-0000-4000-8000-00000000000c', {
      provider: 'codex',
      provider_session_history: [
        {
          providerSessionId: 'codex-session',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-26T10:00:00.000Z',
        },
      ],
    });
    const claudeRun = createSession('d0000000-0000-4000-8000-00000000000d', {
      provider: 'claude',
      provider_session_history: [
        {
          providerSessionId: 'claude-session',
          providerConversationId: null,
          providerSessionAgentId: 'implement',
          observedAt: '2026-07-26T09:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-26T09:00:00.000Z',
    });
    const readCcusageSessionJson = vi.fn((providerId: 'claude' | 'codex') =>
      providerId === 'codex'
        ? Promise.resolve(
            JSON.stringify({ sessions: [{ sessionId: 'codex-session', costUSD: 2.75 }] }),
          )
        : Promise.reject(new Error('Claude source unavailable')),
    );

    const result = await createSubject([codexRun, claudeRun], readCcusageSessionJson).list(
      {
        requestId,
        agentSessionId,
        operation: 'project.session_costs.list',
        projectId,
        limit: 25,
      },
      organizationId,
    );

    expect(result.sourceAvailability).toBe('partial');
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentSessionId: codexRun.agentic_session_id,
          knownCostUsd: 2.75,
          completeness: 'complete',
        }),
        expect.objectContaining({
          agentSessionId: claudeRun.agentic_session_id,
          knownCostUsd: null,
          completeness: 'unavailable',
        }),
      ]),
    );
  });
});
