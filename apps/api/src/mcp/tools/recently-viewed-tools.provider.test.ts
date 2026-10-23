import type { Request } from 'express';
import { RecentlyViewedToolsProvider } from './recently-viewed-tools.provider';
import { AttentionEventService } from '../../services/analytics/attention-event.service';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const taskId = '123e4567-e89b-42d3-a456-426614174090';
const designDocId = '123e4567-e89b-42d3-a456-426614174091';
const featureRootId = '123e4567-e89b-42d3-a456-426614174092';
const featureParentId = '123e4567-e89b-42d3-a456-426614174093';

function makeRequest(overrides?: {
  token?: string | null;
  projectIdHeader?: string;
}): Request {
  const token = overrides?.token === undefined ? TEST_TOKEN : overrides.token;
  const user = {
    userId: testIds.user,
    currentOrgId: testIds.organization,
  };
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (overrides?.projectIdHeader) {
    headers['x-project-id'] = overrides.projectIdHeader;
  }
  return { user, headers } as unknown as Request;
}

function makeParams(overrides?: Record<string, unknown>) {
  return {
    projectId: testIds.project,
    limit: 20,
    sinceHours: 24,
    ...overrides,
  } as {
    projectId?: string;
    limit: number;
    sinceHours: number;
  };
}

function makeAttentionEvent(overrides?: Record<string, unknown>) {
  return {
    id: 'evt-1',
    entityType: 'TASK',
    entityId: taskId,
    entityName: 'Review JWT rotation',
    tab: undefined,
    focusStart: '2026-04-15T09:00:00.000Z',
    focusEnd: '2026-04-15T09:05:00.000Z',
    durationMs: 300_000,
    ...overrides,
  };
}

function makeFullContext(overrides?: Record<string, unknown>) {
  return {
    entityId: taskId,
    entityType: 'TASK',
    displayName: 'Review JWT rotation',
    createdAt: '2026-04-01T00:00:00.000Z',
    creatingProposalId: undefined,
    proposals: [],
    relatedEntities: [],
    agentSessions: [],
    featureHierarchy: [
      {
        id: featureParentId,
        name: 'Auth',
        relationship: 'ancestor',
        distance: 1,
      },
      {
        id: featureRootId,
        name: 'Platform',
        relationship: 'ancestor',
        distance: 2,
      },
      {
        id: 'sibling-id',
        name: 'Session Hygiene',
        relationship: 'sibling',
        distance: 1,
      },
    ],
    ...overrides,
  };
}

describe('RecentlyViewedToolsProvider', () => {
  let provider: RecentlyViewedToolsProvider;
  let attentionEventService: jest.Mocked<AttentionEventService>;
  let entityContextService: jest.Mocked<EntityContextService>;

  beforeEach(() => {
    attentionEventService = {
      getAttentionEvents: jest.fn(),
    } as unknown as jest.Mocked<AttentionEventService>;

    entityContextService = {
      getFullEntityContext: jest.fn(),
    } as unknown as jest.Mocked<EntityContextService>;

    provider = new RecentlyViewedToolsProvider(
      attentionEventService,
      entityContextService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns project-scoped events mapped to the tool output shape', async () => {
    attentionEventService.getAttentionEvents.mockResolvedValue({
      events: [makeAttentionEvent()],
      pagination: { limit: 20, offset: 0, total: 1 },
    } as any);
    entityContextService.getFullEntityContext.mockResolvedValue(
      makeFullContext() as any,
    );

    const result = (await provider.getRecentlyViewed(
      makeParams(),
      {} as any,
      makeRequest(),
    )) as { entities: any[] };

    expect(attentionEventService.getAttentionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ userId: testIds.user }),
      expect.objectContaining({
        limit: 20,
        offset: 0,
        sort: 'mostRecent',
        projectId: testIds.project,
      }),
    );

    expect(result.entities).toEqual([
      {
        entityType: 'TASK',
        entityId: taskId,
        title: 'Review JWT rotation',
        featurePath: ['Platform', 'Auth'],
        lastViewedAt: '2026-04-15T09:05:00.000Z',
      },
    ]);
  });

  it('respects custom limit and sinceHours and converts sinceHours to an ISO string', async () => {
    attentionEventService.getAttentionEvents.mockResolvedValue({
      events: [],
      pagination: { limit: 5, offset: 0, total: 0 },
    } as any);

    const fixedNow = new Date('2026-04-15T12:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    await provider.getRecentlyViewed(
      makeParams({ limit: 5, sinceHours: 2 }),
      {} as any,
      makeRequest(),
    );

    expect(attentionEventService.getAttentionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: 5,
        since: '2026-04-15T10:00:00.000Z',
      }),
    );
  });

  it('returns an mcpError when auth is missing', async () => {
    const unauthenticated = { headers: {} } as unknown as Request;

    const result = (await provider.getRecentlyViewed(
      makeParams(),
      {} as any,
      unauthenticated,
    )) as { isError: boolean };

    expect(result.isError).toBe(true);
    expect(attentionEventService.getAttentionEvents).not.toHaveBeenCalled();
  });

  it('returns an mcpError when no projectId is provided via param or header', async () => {
    const result = (await provider.getRecentlyViewed(
      makeParams({ projectId: undefined }),
      {} as any,
      makeRequest(),
    )) as { isError: boolean };

    expect(result.isError).toBe(true);
    expect(attentionEventService.getAttentionEvents).not.toHaveBeenCalled();
  });

  it('falls back to an empty feature path and keeps other entries when one lookup fails', async () => {
    attentionEventService.getAttentionEvents.mockResolvedValue({
      events: [
        makeAttentionEvent(),
        makeAttentionEvent({
          id: 'evt-2',
          entityType: 'DESIGN_DOC',
          entityId: designDocId,
          entityName: 'Auth Design Doc',
        }),
      ],
      pagination: { limit: 20, offset: 0, total: 2 },
    } as any);

    entityContextService.getFullEntityContext.mockImplementation(
      async (_orgId, _projectId, _type, entityId) => {
        if (entityId === designDocId) {
          throw new Error('simulated lookup failure');
        }
        return makeFullContext() as any;
      },
    );

    const result = (await provider.getRecentlyViewed(
      makeParams(),
      {} as any,
      makeRequest(),
    )) as { entities: any[] };

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].featurePath).toEqual(['Platform', 'Auth']);
    expect(result.entities[1]).toEqual(
      expect.objectContaining({
        entityType: 'DESIGN_DOC',
        entityId: designDocId,
        title: 'Auth Design Doc',
        featurePath: [],
      }),
    );
  });
});
