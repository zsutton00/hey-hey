import type { Request } from 'express';
import { NotFoundException } from '@nestjs/common';
import { GetFeatureSyncContextToolsProvider } from './get-feature-sync-context-tools.provider';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import * as TestUtils from '../../utils/testUtils';
import { EMPTY_FEATURE_REQUIREMENTS_CONTENT } from '../../services/tasks/feature-requirements-reader';

const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const taskId = '123e4567-e89b-42d3-a456-426614174099';
const parentFeatureId = '123e4567-e89b-42d3-a456-426614174070';
const grandParentFeatureId = '123e4567-e89b-42d3-a456-426614174071';

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

function makeFeatureSyncContext(
  overrides?: Partial<{
    taskId: string;
    ancestorFeatures: Array<{
      id: string;
      name: string;
      description: string | null;
      requirements: string | null;
      distance: number;
    }>;
  }>,
) {
  return {
    taskId,
    ancestorFeatures: [
      {
        id: parentFeatureId,
        name: 'Parent Feature',
        description: 'Parent description.',
        requirements: EMPTY_FEATURE_REQUIREMENTS_CONTENT,
        distance: 1,
      },
      {
        id: grandParentFeatureId,
        name: 'Grandparent Feature',
        description: 'Grandparent description.',
        requirements: null,
        distance: 2,
      },
    ],
    ...overrides,
  };
}

describe('GetFeatureSyncContextToolsProvider', () => {
  let provider: GetFeatureSyncContextToolsProvider;
  let entityContextService: jest.Mocked<EntityContextService>;

  beforeEach(() => {
    entityContextService = {
      getFeatureSyncContext: jest.fn(),
    } as unknown as jest.Mocked<EntityContextService>;

    provider = new GetFeatureSyncContextToolsProvider(entityContextService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('successful response shape', () => {
    it('returns ancestor features in walk order with full content', async () => {
      entityContextService.getFeatureSyncContext.mockResolvedValue(
        makeFeatureSyncContext() as any,
      );

      const result = (await provider.getFeatureSyncContext(
        { taskId, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.taskId).toBe(taskId);
      expect(result.ancestorFeatures).toHaveLength(2);
      expect(result.ancestorFeatures[0]).toMatchObject({
        id: parentFeatureId,
        name: 'Parent Feature',
        description: 'Parent description.',
        requirements: EMPTY_FEATURE_REQUIREMENTS_CONTENT,
        distance: 1,
      });
      expect(result.ancestorFeatures[1]).toMatchObject({
        id: grandParentFeatureId,
        distance: 2,
        requirements: null,
      });
    });

    it('returns empty ancestorFeatures when task has no FEATURE ancestors', async () => {
      entityContextService.getFeatureSyncContext.mockResolvedValue({
        taskId,
        ancestorFeatures: [],
      } as any);

      const result = (await provider.getFeatureSyncContext(
        { taskId, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result).toEqual({ taskId, ancestorFeatures: [] });
    });
  });

  describe('projectId resolution', () => {
    it('resolves projectId from the X-Project-ID header when omitted', async () => {
      entityContextService.getFeatureSyncContext.mockResolvedValue(
        makeFeatureSyncContext() as any,
      );

      await provider.getFeatureSyncContext(
        { taskId },
        {} as any,
        makeRequest({ headers: { 'x-project-id': testIds.project } }),
      );

      expect(entityContextService.getFeatureSyncContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        taskId,
      );
    });

    it('returns mcpError when projectId is missing everywhere', async () => {
      const result = (await provider.getFeatureSyncContext(
        { taskId },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Missing projectId/i);
      expect(entityContextService.getFeatureSyncContext).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns a clean mcpError when the task is not found', async () => {
      entityContextService.getFeatureSyncContext.mockRejectedValue(
        new NotFoundException(`Task with id ${taskId} not found`),
      );

      const result = (await provider.getFeatureSyncContext(
        { taskId, projectId: testIds.project },
        {} as any,
        makeRequest(),
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(`Task with id ${taskId} not found`);
    });

    it('wraps unexpected service errors with mcpError', async () => {
      entityContextService.getFeatureSyncContext.mockRejectedValue(
        new Error('DB exploded'),
      );

      const result = (await provider.getFeatureSyncContext(
        { taskId, projectId: testIds.project },
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

      const result = (await provider.getFeatureSyncContext(
        { taskId, projectId: testIds.project },
        {} as any,
        unauthedRequest,
      )) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication required/i);
      expect(entityContextService.getFeatureSyncContext).not.toHaveBeenCalled();
    });
  });
});
