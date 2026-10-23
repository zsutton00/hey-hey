import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AgenticSession } from '../../session/types';
import type { AssistantCompleteEvent } from '../../run/types';
import type { OpenItemsTriagePromptPayload } from '../../shared/agent-bridge-contract/generated';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../prompt-type-handler.test-support';
import { EntityType } from '../../shared/api/generated/api';
import { dispatchResponseType } from '../response-dispatch';
import { NOOP_LOGGER } from '../../server/logger';
import {
  attentionSessionSchema,
  DAY_MS,
  itemKey,
  reduceAttention,
  TRIAGE_CAPS,
  type AttentionSession,
} from './attention';
import { TRIAGE_INPUT_BUDGET_BYTES, TriageInputOwner } from './input-owner';
import { trackedSchema } from './input-schemas';
import { OpenItemsTriageHandler } from './open-items-triage.handler';
import { buildTriagePrompt } from './prompts/triage-prompt';
import { reduceConnections } from './relationships';
import { mapTriageResponse } from './response-mapping';
import { parseTriageResponse } from './schemas';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-13T12:00:00Z');
const item = (n = 1) => ({ entityType: 'TASK' as const, entityId: id(n), title: `Item ${n}` });
const openItem = (n = 1) => ({
  ...item(n),
  presentation: { label: `Item ${n}` },
  note: null,
  pinned: false,
  position: 'a',
  groupId: null,
  memberPosition: null,
  revision: 1,
  lineage: [],
  removedAt: null,
  updatedAt: new Date(now).toISOString(),
  goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
  goalCollapsed: true,
});
const session = (
  n: number,
  entity: number,
  start: number,
  duration = 30_000,
): AttentionSession => ({
  id: id(1000 + n),
  entityType: EntityType.Task,
  entityId: id(entity),
  entityName: `Item ${entity}`,
  focusStart: new Date(start).toISOString(),
  focusEnd: new Date(start + duration).toISOString(),
  durationMs: duration,
});
const response = (data: object) => new Response(JSON.stringify({ data }), { status: 200 });
const token = `e30.${Buffer.from(JSON.stringify({ sub: id(99) })).toString('base64url')}.x`;
const run = {
  entity: { entityType: 'PROJECT', entityId: id(92) },
  agentic_session_id: id(90),
  contextMetadata: { organizationId: id(91), projectId: id(92) },
} as AgenticSession;
const openCounters = (result: ReturnType<typeof reduceAttention>, n = 1) =>
  result.openCounters.get(itemKey(item(n)));
const event = (summary: string) => ({ summary }) as AssistantCompleteEvent;
const reply = {
  responseType: 'open_items_triage_v1',
  summary: 'Keep the useful work.',
  suggestions: [],
};
const base = {
  suggestionId: 'one',
  rationale: 'Observed evidence.',
  evidence: [{ kind: 'attention', summary: 'Viewed recently.' }],
};
const fetchFixture = () =>
  vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/open-items'))
      return response({ state: 'PRESENT', revision: 3, items: [openItem()], groups: [] });
    if (url.pathname.endsWith('/attention'))
      return response({
        events: [session(1, 1, now - 60_000)],
        pagination: { limit: 50, offset: 0, total: 1 },
      });
    if (url.pathname.endsWith('/goals/active'))
      return response({ items: [], userId: id(99), windowDays: 30 });
    if (url.pathname.endsWith('/context'))
      return response({
        entityId: url.pathname.split('/').at(-2),
        entityType: 'TASK',
        relatedEntities: [],
        featureHierarchy: [],
      });
    throw new Error('Unexpected request');
  });
const deps = (fetchImpl = fetchFixture()) =>
  createPromptTypeHandlerTestDeps({ fetchImpl, auth: createPromptTypeHandlerTestAuth(token) });
afterEach(() => vi.useRealTimers());

describe('attention reducers', () => {
  it('counts distinct focus-session starts rather than duration ticks, deduplicating returned rows', () => {
    const longSession = session(1, 1, now - 120_000, 90_000);
    const nextSession = session(2, 1, now - 20_000, 10_000);
    const result = reduceAttention([longSession, longSession, nextSession], [item()], now, true);
    expect(openCounters(result)).toMatchObject({
      viewsToday: 2,
      viewsSevenDays: 2,
      focusMsSevenDays: 100_000,
      lastViewed: nextSession.focusStart,
    });
    expect(result.timeline[0]).toMatchObject({ views: 2, focusMs: 100_000 });
  });
  it('accepts an attention record exactly as the API sends it and rejects retired lowercase types', () => {
    const wire = {
      id: id(1),
      entityType: 'DESIGN_DOC',
      entityId: id(2),
      entityName: 'Design',
      tab: null,
      focusStart: new Date(now - 60_000).toISOString(),
      focusEnd: new Date(now).toISOString(),
      durationMs: 60_000,
    };
    expect(attentionSessionSchema.safeParse(wire).success).toBe(true);
    expect(attentionSessionSchema.safeParse({ ...wire, entityType: 'design_doc' }).success).toBe(
      false,
    );
    expect(attentionSessionSchema.safeParse({ ...wire, entityType: 'PLAN' }).success).toBe(false);
  });
  it('computes UTC day/rolling-window aggregates, merges spans, and finds reopen/co-attention leads deterministically', () => {
    const events = [
      session(1, 1, now - DAY_MS),
      session(2, 1, now - DAY_MS + 60_000),
      session(3, 2, now - DAY_MS + 120_000),
      session(4, 1, now - DAY_MS + 180_000),
      session(5, 1, now - 60_000),
    ];
    const result = reduceAttention(events, [item(), item(3)], now, true);
    expect(openCounters(result)).toMatchObject({
      viewsToday: 1,
      viewsSevenDays: 4,
      focusMsSevenDays: 120_000,
      lastViewed: events[4]!.focusStart,
    });
    expect(result.totalsComplete).toBe(true);
    expect(openCounters(result, 3)).toMatchObject({ viewsToday: 0, lastViewed: null });
    expect(result.timeline[0]).toMatchObject({ views: 2, focusMs: 60_000 });
    expect(result.reopenCandidates.map((a) => a.item.entityId)).toEqual([id(2)]);
    expect(result.coAttention[0]?.occurrences).toBe(2);
    expect(reduceAttention([...events].reverse(), [item(), item(3)], now, true)).toEqual(result);
  });
  it('clips focus at the seven-day boundary and ignores future sessions, duplicate pages and invalid intervals', () => {
    const s = session(1, 1, now - 7 * DAY_MS - 10_000, 30_000);
    const result = reduceAttention([s, s, session(2, 1, now + 1)], [item()], now, false);
    expect(openCounters(result)).toMatchObject({
      lastViewed: s.focusStart,
      viewsSevenDays: 0,
      focusMsSevenDays: 20_000,
    });
    expect(result.totalsComplete).toBe(false);
    expect(attentionSessionSchema.safeParse({ ...s, focusEnd: 'invalid' }).success).toBe(false);
    expect(attentionSessionSchema.safeParse({ ...s, durationMs: 99_000 }).success).toBe(false);
  });
  it('caps timeline and reopen lists and discloses cuts', () => {
    const result = reduceAttention(
      Array.from({ length: 120 }, (_, n) => session(n, n + 1, now - 120_000 + n * 1000, 500)),
      [],
      now,
      true,
    );
    expect(result.timeline).toHaveLength(TRIAGE_CAPS.timeline);
    expect(result.reopenCandidates).toHaveLength(TRIAGE_CAPS.reopen);
    expect(result.truncated).toMatchObject({ timeline: true, reopen: true });
  });
});

describe('triage input and handler', () => {
  it('excludes open identities beyond the collection cap before capping reopen leads', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: Array.from({ length: TRIAGE_CAPS.items + 50 }, (_, n) => openItem(n + 1)),
          groups: [],
        });
      if (url.pathname.endsWith('/attention')) {
        const events = [
          ...Array.from({ length: 50 }, (_, n) =>
            session(n, TRIAGE_CAPS.items + n + 1, now - 60_000 + n * 500, 100),
          ),
          session(51, 999, now - 120_000, 100),
        ];
        const offset = Number(url.searchParams.get('offset'));
        return response({
          events: events.slice(offset, offset + 50),
          pagination: { limit: 50, offset, total: events.length },
        });
      }
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.attention.reopenCandidates.map((candidate) => candidate.item.entityId)).toEqual([
      id(999),
    ]);
    expect(input.attention.truncated.reopen).toBe(false);
  });

  it('excludes archived records from collection, attention and relationships', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: [openItem(), openItem(2)],
          groups: [],
        });
      if (path.endsWith('/context')) {
        const entityId = path.split('/').at(-2)!;
        return response({
          entityId,
          entityType: 'TASK',
          content: { status: entityId === id(1) ? 'ARCHIVED' : 'ACTIVE' },
          relatedEntities: [
            {
              entityId: id(1),
              entityType: 'TASK',
              displayName: 'Old work',
              relationship: 'derives-from',
              status: 'ARCHIVED',
            },
          ],
          featureHierarchy: [],
        });
      }
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items.map((item) => item.key)).toEqual([`TASK:${id(2)}`]);
    expect(input.attention.timeline).toEqual([]);
    expect(input.connections).toEqual([]);
  });

  it('gives each open item one compact keyed record with its attention counters', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 3,
          items: [
            { ...openItem(), groupId: id(5), pinned: true, note: 'x'.repeat(250) },
            openItem(2),
          ],
          groups: [
            {
              groupId: id(5),
              name: 'Later',
              position: 'a',
              collapsed: false,
              revision: 1,
              updatedAt: new Date(now).toISOString(),
            },
          ],
        });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items).toEqual([
      {
        key: `TASK:${id(1)}`,
        title: 'Item 1',
        group: id(5),
        pinned: true,
        note: 'x'.repeat(200),
        lastViewed: new Date(now - 60_000).toISOString(),
        viewsToday: 1,
        viewsSevenDays: 1,
        focusMsSevenDays: 30_000,
      },
      {
        key: `TASK:${id(2)}`,
        title: 'Item 2',
        group: null,
        pinned: false,
        note: null,
        lastViewed: null,
        viewsToday: 0,
        viewsSevenDays: 0,
        focusMsSevenDays: 0,
      },
    ]);
    expect(input.attention.totalsComplete).toBe(true);
  });

  it('preserves nullable and absent tracked statuses alongside other healthy tracked evidence', async () => {
    const tracked = (n: number) => ({
      targetEntityId: id(n),
      targetEntityType: 'TASK',
      title: `Item ${n}`,
    });
    expect(trackedSchema.parse({ ...tracked(2), status: null }).status).toBeNull();
    expect(trackedSchema.parse(tracked(4))).not.toHaveProperty('status');
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/goals/active'))
        return response({
          items: [{ id: id(700), name: 'Outcome', dueDate: null }],
          userId: id(99),
          windowDays: 30,
        });
      if (path.endsWith(`/work-items/${id(700)}`))
        return response({
          id: id(700),
          type: 'GOAL',
          trackedEntities: [
            { ...tracked(2), status: null },
            { ...tracked(3), status: 'ACTIVE' },
            tracked(4),
            { ...tracked(5), status: 'ARCHIVED' },
            { ...tracked(6), status: 123 },
          ],
        });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.goals[0]?.trackedItems).toEqual([
      { ...item(2), status: null },
      { ...item(3), status: 'ACTIVE' },
      item(4),
    ]);
    expect(input.limits.find((limit) => limit.scope === `goal:${id(700)}:tracked`)).toMatchObject({
      invalidRecords: 1,
      unavailable: false,
      truncated: false,
    });
    for (const n of [2, 3, 4])
      expect(
        fetchImpl.mock.calls.some(([url]) => String(url).includes(`/TASK/${id(n)}/context?`)),
      ).toBe(true);
    expect(input.collection.items[0]?.viewsSevenDays).toBe(1);
  });

  it('preserves earlier attention when a later page fails', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/attention')) {
        if (url.searchParams.get('offset') !== '0') return new Response('', { status: 503 });
        return response({
          events: Array.from({ length: 50 }, (_, n) =>
            session(n, 1, now - 100_000 + n * 1000, 500),
          ),
          pagination: { limit: 50, offset: 0, total: 51 },
        });
      }
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items[0]).toMatchObject({ viewsSevenDays: 50 });
    expect(input.attention.totalsComplete).toBe(false);
    expect(input.limits.find((l) => l.scope === 'attention')?.unavailable).toBe(true);
  });
  it('caps collection, groups, Goals, tracked snapshots and graph connections with explicit limits', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input)),
        path = url.pathname;
      if (path.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: Array.from({ length: 205 }, (_, n) => openItem(n + 1)),
          groups: Array.from({ length: 55 }, (_, n) => ({
            groupId: id(500 + n),
            name: `Group ${n}`,
            position: 'a',
            collapsed: true,
            revision: 1,
            updatedAt: new Date(now).toISOString(),
          })),
        });
      if (path.endsWith('/goals/active'))
        return response({
          items: Array.from({ length: 21 }, (_, n) => ({
            id: id(700 + n),
            name: `Goal ${n}`,
            dueDate: null,
          })),
          userId: id(99),
          windowDays: 30,
        });
      if (path.includes('/work-items/'))
        return response({
          id: path.split('/').at(-1),
          type: 'GOAL',
          trackedEntities: Array.from({ length: 101 }, (_, n) => ({
            targetEntityId: id(200 + n),
            targetEntityType: 'TASK',
            title: `Tracked ${n}`,
          })),
        });
      if (path.endsWith('/context'))
        return response({
          entityId: path.split('/').at(-2),
          entityType: 'TASK',
          relatedEntities: Array.from({ length: 51 }, (_, n) => ({
            entityId: id(n + 1),
            entityType: 'TASK',
            displayName: `Item ${n + 1}`,
            relationship: 'derives-from',
          })),
          featureHierarchy: [],
        });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items).toHaveLength(TRIAGE_CAPS.items);
    expect(input.collection.groups).toHaveLength(TRIAGE_CAPS.groups);
    expect(input.goals).toHaveLength(TRIAGE_CAPS.goals);
    expect(
      input.goals.every((goal) => goal.trackedItems.length === TRIAGE_CAPS.trackedPerGoal),
    ).toBe(true);
    expect(input.connections).toHaveLength(TRIAGE_CAPS.connections);
    expect(input.truncated).toBe(true);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/context?'))).toHaveLength(
      TRIAGE_CAPS.connectionSeeds,
    );
    for (const scope of [
      'collection',
      'groups',
      'goals',
      'connectionSeeds',
      `goal:${id(700)}:tracked`,
      `connections:TASK:${id(1)}`,
    ])
      expect(input.limits.find((limit) => limit.scope === scope)?.truncated).toBe(true);
  });

  const maximumFetch = (titleLength: number) => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    const title = (n: number) => `Item ${n} ${'x'.repeat(titleLength)}`;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input)),
        path = url.pathname;
      if (path.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: Array.from({ length: TRIAGE_CAPS.items }, (_, n) => ({
            ...openItem(n + 1),
            presentation: { label: title(n + 1) },
            groupId: id(500 + (n % TRIAGE_CAPS.groups)),
            note: 'n'.repeat(250),
          })),
          groups: Array.from({ length: TRIAGE_CAPS.groups }, (_, n) => ({
            groupId: id(500 + n),
            name: `Group ${n}`,
            position: 'a',
            collapsed: true,
            revision: 1,
            updatedAt: new Date(now).toISOString(),
          })),
        });
      if (path.endsWith('/attention')) {
        const offset = Number(url.searchParams.get('offset'));
        const events = Array.from({ length: 50 }, (_, n) => ({
          ...session(
            offset + n,
            ((offset + n) % TRIAGE_CAPS.items) + 1,
            now - DAY_MS + (offset + n) * 300_000,
            500,
          ),
          entityName: title(((offset + n) % TRIAGE_CAPS.items) + 1),
        }));
        return response({
          events,
          pagination: { limit: 50, offset, total: TRIAGE_CAPS.attentionPages * 50 },
        });
      }
      if (path.endsWith('/goals/active'))
        return response({
          items: Array.from({ length: TRIAGE_CAPS.goals }, (_, n) => ({
            id: id(700 + n),
            name: `Goal ${n}`,
            dueDate: null,
          })),
          userId: id(99),
          windowDays: 30,
        });
      if (path.includes('/work-items/'))
        return response({
          id: path.split('/').at(-1),
          type: 'GOAL',
          trackedEntities: Array.from({ length: TRIAGE_CAPS.trackedPerGoal }, (_, n) => ({
            targetEntityId: id(2000 + n),
            targetEntityType: 'TASK',
            title: title(2000 + n),
            status: 'ACTIVE',
          })),
        });
      if (path.endsWith('/context')) {
        const source = Number(path.split('/').at(-2)!.slice(-12));
        return response({
          entityId: path.split('/').at(-2),
          entityType: 'TASK',
          relatedEntities: Array.from({ length: 16 }, (_, n) => ({
            entityId: id(((source + n) % TRIAGE_CAPS.items) + 1),
            entityType: 'TASK',
            displayName: title(((source + n) % TRIAGE_CAPS.items) + 1),
            relationship: 'derives-from',
          })),
          featureHierarchy: [],
        });
      }
      return original(input, init);
    });
    return fetchImpl;
  };

  it('keeps a maximum-size prompt well under the durable prompt limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const prepared = await new OpenItemsTriageHandler().prepare(
      run,
      { projectId: id(92), requestKind: 'freshPass', mode: 'tidyUp' },
      deps(maximumFetch(60)),
    );
    expect(prepared.payload.triageInput.collection.items).toHaveLength(TRIAGE_CAPS.items);
    expect(Buffer.byteLength(buildTriagePrompt(prepared.payload), 'utf8')).toBeLessThan(200 * 1024);
  });

  it('trims timeline then connections to fit the input budget and discloses each trim', async () => {
    const dependencies = deps(maximumFetch(400));
    const info = vi.spyOn(dependencies.logger, 'info');
    const input = await new TriageInputOwner(
      dependencies,
      id(91),
      id(92),
      token,
      now,
    ).build();
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    expect(bytes).toBeLessThanOrEqual(TRIAGE_INPUT_BUDGET_BYTES);
    expect(input.attention.timeline).toEqual([]);
    expect(input.attention.truncated.timeline).toBe(true);
    expect(input.connections.length).toBeLessThan(TRIAGE_CAPS.connections);
    expect(input.truncated).toBe(true);
    for (const scope of ['budget:timeline', 'budget:connections'])
      expect(input.limits.find((limit) => limit.scope === scope)?.truncated).toBe(true);
    expect(info).toHaveBeenCalledWith(
      'open_items_triage.input.ready',
      expect.objectContaining({ bytes }),
    );
  });

  it('reads and reduces shared source conversations and preserves lineage when a source lookup fails', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    let failSource = false;
    fetchImpl.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: [openItem(), openItem(2)],
          groups: [],
        });
      if (path.endsWith('/context')) {
        const entityId = path.split('/').at(-2)!;
        return response({
          entityId,
          entityType: 'TASK',
          creatingProposalId: entityId,
          relatedEntities: [
            {
              entityId: id(2),
              entityType: 'TASK',
              displayName: 'Item 2',
              relationship: 'derives-from',
            },
            null,
          ],
          featureHierarchy: [
            {
              id: id(4),
              name: 'Parent',
              relationshipType: 'structural',
              relationship: 'ancestor',
              distance: 1,
            },
          ],
        });
      }
      if (path.includes('/proposals/')) {
        const entityId = path.split('/').at(-1)!;
        if (failSource && entityId === id(1)) return new Response('', { status: 503 });
        return response({
          id: entityId,
          action: 'CREATE',
          status: 'APPROVED',
          targetEntityId: entityId,
          targetEntityType: 'TASK',
          conversationId: id(5),
        });
      }
      if (path.includes('/conversations/'))
        return response({ id: id(5), projectId: id(92), status: 'COMPLETED' });
      return original(input, init);
    });
    const initial = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(
      initial.connections.filter((connection) => connection.relationship === 'created-via'),
    ).toHaveLength(2);
    expect(
      initial.connections.find((connection) => connection.relationship === 'created-via')?.target,
    ).toEqual({ entityId: id(5), entityType: 'CONVERSATION' });
    expect(
      initial.connections.filter((connection) => connection.relationship === 'parent'),
    ).toHaveLength(2);
    failSource = true;
    const partial = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(
      partial.connections.some((connection) => connection.relationship === 'derives-from'),
    ).toBe(true);
    expect(
      partial.limits.find((limit) => limit.scope === `sourceConversation:TASK:${id(1)}`)
        ?.unavailable,
    ).toBe(true);
  });
  it('reads canonical uppercase attention, skipping non-candidate types without calling them invalid', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    const wire = (n: number, entityType: string, entityId: string) => ({
      id: id(2000 + n),
      entityType,
      entityId,
      entityName: `Entity ${n}`,
      tab: null,
      focusStart: new Date(now - 120_000 + n * 1000).toISOString(),
      focusEnd: new Date(now - 90_000 + n * 1000).toISOString(),
      durationMs: 30_000,
    });
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/attention'))
        return response({
          events: [
            wire(1, 'TASK', id(1)),
            wire(2, 'AGENT_SESSION', id(50)),
            wire(3, 'PROPOSAL', id(51)),
          ],
          pagination: { limit: 50, offset: 0, total: 3 },
        });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items[0]).toMatchObject({
      viewsSevenDays: 1,
      focusMsSevenDays: 30_000,
    });
    expect(input.attention.totalsComplete).toBe(true);
    expect(input.attention.reopenCandidates).toEqual([]);
    expect(input.limits).toContainEqual({
      scope: 'attention',
      invalidRecords: 0,
      truncated: false,
      unavailable: false,
    });
  });
  it('rejects records that do not match the contract and says why', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/attention'))
        return response({
          events: [{ ...session(1, 1, now - 60_000), entityType: 'task' }],
          pagination: { limit: 50, offset: 0, total: 1 },
        });
      return original(input, init);
    });
    const handlerDeps = deps(fetchImpl);
    const warn = vi.spyOn(handlerDeps.logger, 'warn');
    const input = await new TriageInputOwner(handlerDeps, id(91), id(92), token, now).build();
    expect(input.attention.totalsComplete).toBe(false);
    expect(warn).toHaveBeenCalledWith('open_items_triage.record.invalid', {
      scope: 'attention',
      reasons: { 'entityType: invalid_enum_value': 1 },
    });
  });
  it('pages the full bounded window, isolates bad records and preserves a healthy later page', async () => {
    const fetchImpl = fetchFixture();
    const original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/attention')) {
        const offset = Number(url.searchParams.get('offset'));
        return response({
          events:
            offset === 0
              ? [
                  null,
                  ...Array.from({ length: 49 }, (_, n) =>
                    session(n, 1, now - 100_000 + n * 1000, 500),
                  ),
                ]
              : [session(50, 1, now - 1000, 500)],
          pagination: { limit: 50, offset, total: 51 },
        });
      }
      if (url.pathname.endsWith('/context')) return new Response('', { status: 503 });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items[0]).toMatchObject({ viewsSevenDays: 50 });
    expect(input.attention.totalsComplete).toBe(false);
    expect(input.limits).toContainEqual({
      scope: 'attention',
      invalidRecords: 1,
      truncated: false,
      unavailable: false,
    });
    expect(input.limits.some((l) => l.unavailable && l.scope.startsWith('connections:'))).toBe(
      true,
    );
  });
  it('keeps healthy collection rows and Goals when independent records/lookups fail', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/open-items'))
        return response({
          state: 'PRESENT',
          revision: 4,
          items: [null, openItem()],
          groups: [null],
        });
      if (path.endsWith('/goals/active'))
        return response({
          items: [
            { id: id(7), name: 'Goal A', dueDate: null },
            { id: id(8), name: 'Goal B', dueDate: null },
          ],
          userId: id(99),
          windowDays: 30,
        });
      if (path.endsWith(`/work-items/${id(7)}`)) return new Response('', { status: 500 });
      if (path.endsWith(`/work-items/${id(8)}`))
        return response({
          id: id(8),
          type: 'GOAL',
          trackedEntities: [
            null,
            { targetEntityId: id(3), targetEntityType: 'TASK', title: 'Tracked work' },
          ],
        });
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(input.collection.items).toHaveLength(1);
    expect(input.goals[1]?.trackedItems).toHaveLength(1);
    expect(input.limits.find((l) => l.scope === `goal:${id(7)}:tracked`)?.unavailable).toBe(true);
    expect(input.limits.find((l) => l.scope === 'collection')?.invalidRecords).toBe(1);
  });
  it('caps attention pages and reports partial evidence after transport failure', async () => {
    const fetchImpl = fetchFixture(),
      original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/attention')) {
        const offset = Number(url.searchParams.get('offset'));
        return response({
          events: Array.from({ length: 50 }, (_, n) =>
            session(offset + n, 1, now - 1_000_000 + (offset + n) * 1000, 500),
          ),
          pagination: { limit: 50, offset, total: 5000 },
        });
      }
      return original(input, init);
    });
    const input = await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/attention'))).toHaveLength(
      20,
    );
    expect(input.limits.find((l) => l.scope === 'attention')?.truncated).toBe(true);
    expect(input.attention.totalsComplete).toBe(false);
    fetchImpl.mockImplementation(async (input, init) => {
      if (String(input).includes('/attention')) throw new Error('offline');
      return original(input, init);
    });
    expect(
      (await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build()).limits.find(
        (l) => l.scope === 'attention',
      )?.unavailable,
    ).toBe(true);
  });
  it('blocks only the run requiring an unavailable collection; a later run can proceed', async () => {
    const fetchImpl = fetchFixture();
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(
      new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build(),
    ).rejects.toThrow('required collection');
    expect(
      (await new TriageInputOwner(deps(fetchImpl), id(91), id(92), token, now).build()).collection
        .revision,
    ).toBe(3);
  });

  it('refreshes initial, Send and Run Again input using GET only and snapshots the full prompt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const handler = new OpenItemsTriageHandler(),
      fetchImpl = fetchFixture(),
      dependencies = deps(fetchImpl);
    const request = {
      projectId: id(92),
      requestKind: 'freshPass' as const,
      mode: 'tidyUp' as const,
    };
    const first = await handler.prepare(run, request, dependencies);
    expect(buildTriagePrompt(first.payload)).toMatchSnapshot();
    const second = await handler.prepare(
      run,
      {
        ...first.payload,
        requestKind: 'followUp',
        userMessage: 'Why keep this?',
        guidance: 'Focus on unfinished work.',
      },
      dependencies,
    );
    expect(second.payload.guidance).toBe('Focus on unfinished work.');
    expect(buildTriagePrompt(second.payload)).toMatchSnapshot();
    await handler.prepare(run, first.payload, dependencies);
    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/open-items')),
    ).toHaveLength(3);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(handler.validateCompletion(event(JSON.stringify(reply)))).toEqual({ ok: true });
    expect(
      dispatchResponseType(
        JSON.stringify(reply),
        {
          taskId: null,
          promptType: handler.promptType,
          expectedResponseTypes: handler.expectedResponseTypes,
          emitLegacyStartupPlanUiElement: false,
        },
        NOOP_LOGGER,
      ),
    ).toMatchObject({
      matched: true,
      updateData: {
        data: {
          uiElements: [
            {
              type: 'open_items_triage',
              payload: {
                summary: reply.summary,
                suggestions: [],
              },
            },
          ],
        },
      },
    });
    expect(run.entity).toEqual({ entityType: 'PROJECT', entityId: id(92) });
    expect(handler.validateCompletion(event('{}')).ok).toBe(false);
    await expect(
      handler.prepare(
        run,
        { projectId: id(92), requestKind: 'freshPass' } as OpenItemsTriagePromptPayload,
        dependencies,
      ),
    ).rejects.toThrow();
    await expect(
      handler.prepare(run, { ...request, projectId: id(93) }, dependencies),
    ).rejects.toThrow('scope');
  });

  it('frames fresh-pass guidance as review focus and snapshots both modes with and without guidance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const handler = new OpenItemsTriageHandler();
    expect(handler.allowsEmptyUserMessage).toBe(true);
    expect(
      handler.addUserMessage({ projectId: id(92), requestKind: 'freshPass', mode: 'tidyUp' }),
    ).toBeNull();
    expect(
      handler.addUserMessage({
        projectId: id(92),
        requestKind: 'freshPass',
        mode: 'tidyUp',
        userMessage: 'Focus on unfinished work.',
      }),
    ).toContain(
      'Treat this as guidance for what the review should focus on, not a question to answer.',
    );
    const followUpMessage = handler.addUserMessage({
      projectId: id(92),
      requestKind: 'followUp',
      mode: 'springCleaning',
      guidance: 'Focus on unfinished work.',
      userMessage: 'Why keep this?',
    });
    expect(followUpMessage).toContain('Treat this as guidance for what the review should focus on');
    expect(followUpMessage).toContain('Focus on unfinished work.');
    expect(followUpMessage).toContain('Please respond to it directly:');
    expect(followUpMessage).toContain('Why keep this?');

    for (const mode of ['tidyUp', 'springCleaning'] as const) {
      for (const userMessage of [undefined, 'Focus on unfinished work.'] as const) {
        const prepared = await handler.prepare(
          run,
          {
            projectId: id(92),
            requestKind: 'freshPass',
            mode,
            ...(userMessage !== undefined ? { userMessage } : {}),
          },
          deps(),
        );
        const fullPrompt =
          buildTriagePrompt(prepared.payload) + (handler.addUserMessage(prepared.payload) ?? '');
        expect(fullPrompt).toMatchSnapshot(
          `${mode}-${userMessage === undefined ? 'without' : 'with'}-guidance`,
        );
      }
    }
  });
});

describe('relationships and typed replies', () => {
  it('accepts existing exclusive group/Goal targets and rejects a date-only targetDate', () => {
    const suggestions = [
      {
        ...base,
        kind: 'groupOpenItems',
        items: [item()],
        group: { kind: 'existingGroup', groupId: id(6), name: 'Work' },
      },
      {
        ...base,
        suggestionId: 'two',
        kind: 'trackOnGoal',
        items: [item()],
        goal: { kind: 'existingGoal', goalId: id(7), title: 'Outcome' },
      },
    ];
    const parsed = parseTriageResponse(JSON.stringify({ ...reply, suggestions }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(mapTriageResponse(parsed.value).suggestions).toEqual(suggestions);
    expect(
      parseTriageResponse(
        JSON.stringify({
          ...reply,
          suggestions: [
            {
              ...base,
              kind: 'promoteGroupToGoal',
              groupId: id(6),
              groupName: 'Work',
              goalName: 'Deliver',
              affectedMembers: [item()],
              targetDate: '2026-10-13',
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });
  it('retains relevant lineage, shared parents and source conversations only', () => {
    const connections = [
      { source: item(), target: item(2), relationship: 'derives-from' },
      { source: item(), target: item(9), relationship: 'related-to' },
      { source: item(), target: item(4), relationship: 'parent' },
      { source: item(2), target: item(4), relationship: 'parent' },
      {
        source: item(),
        target: { ...item(5), entityType: 'CONVERSATION' as const },
        relationship: 'created-via',
      },
      {
        source: item(2),
        target: { ...item(5), entityType: 'CONVERSATION' as const },
        relationship: 'created-via',
      },
    ];
    expect(reduceConnections(connections, [item(), item(2)]).connections).toHaveLength(5);
  });
  it('maps all five evidence-bearing kinds and dispatches the generated conversation payload', () => {
    const suggestions = [
      { ...base, kind: 'removeOpenItems', items: [item()] },
      { ...base, suggestionId: 'two', kind: 'reopenItems', items: [item(2)] },
      {
        ...base,
        suggestionId: 'three',
        kind: 'groupOpenItems',
        items: [item()],
        group: { kind: 'newGroup', newGroupName: 'Related work' },
      },
      {
        ...base,
        suggestionId: 'four',
        kind: 'trackOnGoal',
        items: [item()],
        goal: {
          kind: 'newGoal',
          newGoal: { name: 'Deliver this outcome', targetDate: '2026-11-01T00:00:00Z' },
        },
      },
      {
        ...base,
        suggestionId: 'five',
        kind: 'promoteGroupToGoal',
        groupId: id(6),
        groupName: 'Work',
        goalName: 'Deliver',
        affectedMembers: [item()],
      },
    ];
    const text = JSON.stringify({ ...reply, suggestions });
    const parsed = parseTriageResponse(`\`\`\`json\n${text}\n\`\`\``);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(mapTriageResponse(parsed.value).suggestions).toHaveLength(5);
    const context = {
      taskId: null,
      promptType: 'open_items_triage',
      expectedResponseTypes: ['open_items_triage_v1'] as const,
      emitLegacyStartupPlanUiElement: false,
    };
    expect(dispatchResponseType(text, context, NOOP_LOGGER)).toMatchObject({
      matched: true,
      updateData: {
        data: {
          response: reply.summary,
          uiElements: [
            { type: 'open_items_triage', payload: { summary: reply.summary, suggestions } },
          ],
        },
      },
    });
    expect(
      dispatchResponseType(
        JSON.stringify({ ...reply, suggestions: [{ ...suggestions[0], evidence: [] }] }),
        context,
        NOOP_LOGGER,
      ),
    ).toMatchObject({ matched: false });
  });
  it('rejects missing evidence, mixed exclusive targets, unknown kinds and more than twenty suggestions', () => {
    for (const suggestions of [
      [{ ...base, kind: 'removeOpenItems', items: [item()], evidence: [] }],
      [
        {
          ...base,
          kind: 'groupOpenItems',
          items: [item()],
          group: { kind: 'existingGroup', groupId: id(6), name: 'Work', newGroupName: 'Mixed' },
        },
      ],
      [
        {
          ...base,
          kind: 'trackOnGoal',
          items: [item()],
          goal: { kind: 'existingGoal', goalId: id(6), title: 'Goal', newGoal: { name: 'Mixed' } },
        },
      ],
      [{ ...base, kind: 'deleteEverything' }],
      Array.from({ length: 21 }, (_, n) => ({
        ...base,
        suggestionId: String(n),
        kind: 'removeOpenItems',
        items: [item()],
      })),
    ])
      expect(parseTriageResponse(JSON.stringify({ ...reply, suggestions })).ok).toBe(false);
  });
});
