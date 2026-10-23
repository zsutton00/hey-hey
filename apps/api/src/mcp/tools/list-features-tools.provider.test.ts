import type { Request } from 'express';
import { ListFeaturesToolsProvider } from './list-features-tools.provider';
import {
  EntityContextService,
  type ListFeaturesResponseDto,
} from '../../services/entity-context/entity-context.service';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const rootA = '11111111-1111-1111-1111-111111111111';
const rootB = '22222222-2222-2222-2222-222222222222';
const childA1 = '33333333-3333-3333-3333-333333333333';

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
  overrides?: Partial<ListFeaturesResponseDto>,
): ListFeaturesResponseDto {
  return {
    items: [
      { id: rootA, name: 'Root A', parentFeatureId: null, depth: 0 },
      { id: childA1, name: 'Child A1', parentFeatureId: rootA, depth: 1 },
      { id: rootB, name: 'Root B', parentFeatureId: null, depth: 0 },
    ],
    total: 3,
    hasMore: false,
    limit: 200,
    offset: 0,
    ...overrides,
  };
}

describe('ListFeaturesToolsProvider', () => {
  let provider: ListFeaturesToolsProvider;
  let entityContextService: jest.Mocked<EntityContextService>;

  beforeEach(() => {
    entityContextService = {
      listFeatures: jest.fn(),
    } as unknown as jest.Mocked<EntityContextService>;

    provider = new ListFeaturesToolsProvider(entityContextService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('successful response shape', () => {
    it('returns the flat DFS list with parentFeatureId and depth', async () => {
      entityContextService.listFeatures.mockResolvedValue(makeListResponse());

      const result = (await provider.listFeatures(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as ListFeaturesResponseDto;

      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toMatchObject({
        id: rootA,
        parentFeatureId: null,
        depth: 0,
      });
      expect(result.items[1]).toMatchObject({
        id: childA1,
        parentFeatureId: rootA,
        depth: 1,
      });
      expect(result.items[2]).toMatchObject({
        id: rootB,
        parentFeatureId: null,
        depth: 0,
      });
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('returns empty items + zero total when project has no features', async () => {
      entityContextService.listFeatures.mockResolvedValue({
        items: [],
        total: 0,
        hasMore: false,
        limit: 200,
        offset: 0,
      });

      const result = (await provider.listFeatures(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as ListFeaturesResponseDto;

      expect(result).toEqual({
        items: [],
        total: 0,
        hasMore: false,
        limit: 200,
        offset: 0,
      });
    });

    it('passes hasMore through when the window does not cover the full result set', async () => {
      entityContextService.listFeatures.mockResolvedValue(
        makeListResponse({
          items: [
            { id: rootA, name: 'Root A', parentFeatureId: null, depth: 0 },
          ],
          total: 3,
          hasMore: true,
          limit: 1,
          offset: 0,
        }),
      );

      const result = (await provider.listFeatures(
        { limit: 1, offset: 0, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as ListFeaturesResponseDto;

      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
    });
  });

  describe('parameter forwarding', () => {
    it('forwards limit and offset to the service', async () => {
      entityContextService.listFeatures.mockResolvedValue(makeListResponse());

      await provider.listFeatures(
        { limit: 50, offset: 100, projectId: testIds.project },
        {} as any,
        makeRequest(),
      );

      expect(entityContextService.listFeatures).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        50,
        100,
      );
    });
  });

  describe('projectId resolution', () => {
    it('resolves projectId from the X-Project-ID header when omitted', async () => {
      entityContextService.listFeatures.mockResolvedValue(makeListResponse());

      await provider.listFeatures(
        { limit: 200, offset: 0 },
        {} as any,
        makeRequest({ headers: { 'x-project-id': testIds.project } }),
      );

      expect(entityContextService.listFeatures).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        200,
        0,
      );
    });

    it('returns mcpError when projectId is missing everywhere', async () => {
      const result = (await provider.listFeatures(
        { limit: 200, offset: 0 },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Missing projectId/i);
      expect(entityContextService.listFeatures).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('wraps unexpected service errors with mcpError', async () => {
      entityContextService.listFeatures.mockRejectedValue(
        new Error('DB exploded'),
      );

      const result = (await provider.listFeatures(
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

      const result = (await provider.listFeatures(
        { limit: 200, offset: 0, projectId: testIds.project },
        {} as any,
        unauthedRequest,
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication required/i);
      expect(entityContextService.listFeatures).not.toHaveBeenCalled();
    });
  });
});
