import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { UnifiedSearchController } from '../unified-search.controller';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import {
  UnifiedBatchSearchRequest,
  UnifiedBatchSearchResponse,
  UnifiedSearchRequest,
  UnifiedSearchResponse,
} from '../../generated';
import { OrganizationId, ProjectId } from '../../types';

describe('UnifiedSearchController', () => {
  let controller: UnifiedSearchController;
  const unifiedSearchService = {
    search: jest.fn(),
    batchSearch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UnifiedSearchController],
      providers: [
        {
          provide: UnifiedSearchService,
          useValue: unifiedSearchService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UnifiedSearchController);
    jest.clearAllMocks();
  });

  it('passes org/project/token and returns service response', async () => {
    const organizationId = 'org-1' as OrganizationId;
    const projectId = 'proj-1' as ProjectId;
    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
    };
    const response: UnifiedSearchResponse = {
      intent: 'semantic',
      query: 'test',
      organizationId,
      projectId,
      embeddings: { results: 0 },
      execution: { totalMs: 1 },
    };

    unifiedSearchService.search.mockResolvedValue(response);

    const result = await controller.search(
      organizationId,
      projectId,
      request,
      'token',
    );

    expect(unifiedSearchService.search).toHaveBeenCalledWith(
      organizationId,
      projectId,
      request,
      'token',
    );
    expect(result).toBe(response);
  });

  it('keeps rich relationship search as the REST default', async () => {
    const organizationId = 'org-1' as OrganizationId;
    const projectId = 'proj-1' as ProjectId;
    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      graph: {
        seedEntityIds: ['a1349862-4931-4b4e-a5ea-d2a90020bcd2'],
        includeRelationships: true,
      },
    };
    const response: UnifiedSearchResponse = {
      intent: 'relationship',
      query: '',
      organizationId,
      projectId,
      graph: {
        results: [{ path: { depth: 1 }, pathCount: 2 }],
        relationships: [],
      },
      execution: { totalMs: 1 },
    };
    unifiedSearchService.search.mockResolvedValue(response);
    const result = await controller.search(
      organizationId,
      projectId,
      request,
      'token',
    );
    expect(unifiedSearchService.search).toHaveBeenCalledWith(
      organizationId,
      projectId,
      request,
      'token',
    );
    expect(result.graph).toEqual(response.graph);
  });

  it('passes org/project/token to batch search and returns service response', async () => {
    const organizationId = 'org-1' as OrganizationId;
    const projectId = 'proj-1' as ProjectId;
    const request: UnifiedBatchSearchRequest = {
      queries: [{ intent: 'semantic', query: 'test' }],
    };
    const response: UnifiedBatchSearchResponse = {
      organizationId,
      projectId,
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 50,
      queryCount: 1,
      execution: { totalMs: 1 },
    };

    unifiedSearchService.batchSearch.mockResolvedValue(response);

    const result = await controller.batchSearch(
      organizationId,
      projectId,
      request,
      'token',
    );

    expect(unifiedSearchService.batchSearch).toHaveBeenCalledWith(
      organizationId,
      projectId,
      request,
      'token',
    );
    expect(result).toBe(response);
  });
});
