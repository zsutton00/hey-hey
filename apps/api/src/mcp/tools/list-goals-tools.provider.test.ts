import type { Request } from 'express';
import { ListGoalsToolsProvider } from './list-goals-tools.provider';
import {
  EntityContextService,
  type ListGoalsResponseDto,
} from '../../services/entity-context/entity-context.service';
import { WorkStatus } from '../../generated';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const goalA = '11111111-1111-1111-1111-111111111111';
const goalB = '22222222-2222-2222-2222-222222222222';

function makeRequest(overrides?: {
  token?: string | null;
  headers?: Record<string, string>;
}): Request {
  const token = overrides?.token === undefined ? TEST_TOKEN : overrides.token;
  const user = {
    id: testIds.user,
    currentOrgId: testIds.organization,
    orgId: testIds.organization,
  };
  return {
    user,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(overrides?.headers ?? {}),
    },
  } as unknown as Request;
}

function makeListResponse(
  overrides?: Partial<ListGoalsResponseDto>,
): ListGoalsResponseDto {
  return {
    items: [
      {
        id: goalA,
        name: 'Ship widgets v1',
        status: 'ACTIVE',
        dueDate: '2026-06-15T00:00:00.000Z',
      },
      {
        id: goalB,
        name: 'Q3 reliability',
        status: 'ACTIVE',
        dueDate: '2026-09-30T00:00:00.000Z',
      },
    ],
    total: 2,
    hasMore: false,
    limit: 200,
    offset: 0,
    ...overrides,
  };
}

describe('ListGoalsToolsProvider', () => {
  let provider: ListGoalsToolsProvider;
  let entityContextService: jest.Mocked<EntityContextService>;

  beforeEach(() => {
    entityContextService = {
      listGoals: jest.fn(),
    } as unknown as jest.Mocked<EntityContextService>;

    provider = new ListGoalsToolsProvider(entityContextService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('successful response shape', () => {
    it('returns a flat list with id, name, status, dueDate per item', async () => {
      entityContextService.listGoals.mockResolvedValue(makeListResponse());

      const result = (await provider.listGoals(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as ListGoalsResponseDto;

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: goalA,
        name: 'Ship widgets v1',
        status: 'ACTIVE',
        dueDate: '2026-06-15T00:00:00.000Z',
      });
      // No depth or parentFeatureId — goals are flat by design.
      expect(result.items[0]).not.toHaveProperty('depth');
      expect(result.items[0]).not.toHaveProperty('parentFeatureId');
    });

    it('returns empty items + zero total for projects with no goals', async () => {
      entityContextService.listGoals.mockResolvedValue({
        items: [],
        total: 0,
        hasMore: false,
        limit: 200,
        offset: 0,
      });

      const result = (await provider.listGoals(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as ListGoalsResponseDto;

      expect(result).toEqual({
        items: [],
        total: 0,
        hasMore: false,
        limit: 200,
        offset: 0,
      });
    });
  });

  describe('status filter mapping', () => {
    it('maps simplified IN_PROGRESS to [WorkStatus.Active] before calling the service', async () => {
      entityContextService.listGoals.mockResolvedValue(makeListResponse());

      await provider.listGoals(
        {
          limit: 50,
          offset: 0,
          status: 'IN_PROGRESS',
          projectId: testIds.project,
        },
        {} as any,
        makeRequest(),
      );

      expect(entityContextService.listGoals).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        50,
        0,
        [WorkStatus.Active],
      );
    });

    it('maps BACKLOG to the full set of pre-active workflow statuses', async () => {
      entityContextService.listGoals.mockResolvedValue(makeListResponse());

      await provider.listGoals(
        {
          limit: 50,
          offset: 0,
          status: 'BACKLOG',
          projectId: testIds.project,
        },
        {} as any,
        makeRequest(),
      );

      const callStatuses = entityContextService.listGoals.mock.calls[0]?.[4];
      // Sanity check a couple of representative statuses; the full mapping
      // mirrors search-tools.provider.ts so duplicating the entire list here
      // would be testing the constant, not the wiring.
      expect(callStatuses).toContain(WorkStatus.Backlog);
      expect(callStatuses).toContain(WorkStatus.OnHold);
      expect(callStatuses).toContain(WorkStatus.Generated);
    });

    it('omits the status filter when none is provided', async () => {
      entityContextService.listGoals.mockResolvedValue(makeListResponse());

      await provider.listGoals(
        { limit: 50, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      );

      expect(entityContextService.listGoals).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        50,
        0,
        undefined,
      );
    });
  });

  describe('projectId resolution', () => {
    it('resolves projectId from the X-Project-ID header when omitted', async () => {
      entityContextService.listGoals.mockResolvedValue(makeListResponse());

      await provider.listGoals(
        { limit: 200, offset: 0 },
        {} as any,
        makeRequest({ headers: { 'x-project-id': testIds.project } }),
      );

      expect(entityContextService.listGoals).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        200,
        0,
        undefined,
      );
    });

    it('returns mcpError when projectId is missing everywhere', async () => {
      const result = (await provider.listGoals(
        { limit: 200, offset: 0 },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Missing projectId/i);
      expect(entityContextService.listGoals).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('wraps unexpected service errors with mcpError', async () => {
      entityContextService.listGoals.mockRejectedValue(
        new Error('DB exploded'),
      );

      const result = (await provider.listGoals(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('DB exploded');
    });

    it('returns authentication error when request has no user', async () => {
      const unauthedRequest = {
        headers: {},
      } as unknown as Request;

      const result = (await provider.listGoals(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        unauthedRequest,
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication required/i);
      expect(entityContextService.listGoals).not.toHaveBeenCalled();
    });
  });
});
