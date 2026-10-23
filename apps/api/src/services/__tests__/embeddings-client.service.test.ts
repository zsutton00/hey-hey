import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { of } from 'rxjs';
import { DevelopmentService } from 'src/generated/embeddings/api/development.service';
import { OrganizationLifecycleService } from 'src/generated/embeddings/api/organizationLifecycle.service';
import { MonitoringService } from 'src/generated/embeddings/api/monitoring.service';
import { SearchService } from 'src/generated/embeddings/api/search.service';
import {
  ProjectionDeletionCommand,
  ProjectionDeletionResult,
} from 'src/generated/embeddings';
import { SearchResponse } from 'src/generated/embeddings/model/searchResponse';
import { ApiKeyService } from '../api-key.service';
import { EmbeddingsClientService } from '../embeddings-client.service';
import { OrganizationId, ProjectId } from 'src/types';

jest.mock('@prisma/client', () => ({
  ApiKeyType: {
    INTERNAL: 'INTERNAL',
    MASTRA_AI: 'MASTRA_AI',
  },
  Prisma: {
    defineExtension: (extension: unknown) => extension,
  },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $extends() {
      return this;
    }
  },
}));

describe('EmbeddingsClientService', () => {
  let service: EmbeddingsClientService;
  let configService: ConfigService;
  let apiKeyService: ApiKeyService;
  let searchService: { searchEmbeddingsOrgGet: jest.Mock };
  let lifecycleService: {
    deleteOrganizationProjection: jest.Mock;
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'EMBEDDINGS_SERVICE_ENABLED') {
          return 'true';
        }
        if (key === 'EMBEDDINGS_SERVICE_URL') {
          return 'http://localhost:5005';
        }
        if (key === 'EMBEDDINGS_SERVICE_API_KEY') {
          return undefined;
        }
        return defaultValue ?? 'test-value';
      }),
    };

    const mockApiKeyService = {
      getOrganizationApiKey: jest.fn(),
      invalidateOrganizationApiKey: jest.fn(),
      clearOrganizationApiKeyCache: jest.fn(),
    } as unknown as ApiKeyService;

    searchService = {
      searchEmbeddingsOrgGet: jest.fn(),
    };
    lifecycleService = {
      deleteOrganizationProjection: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingsClientService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          // Provide a minimal mock for HttpService to satisfy constructor deps
          provide: HttpService,
          useValue: {},
        },
        {
          provide: ApiKeyService,
          useValue: mockApiKeyService,
        },
        {
          provide: SearchService,
          useValue: searchService,
        },
        {
          provide: OrganizationLifecycleService,
          useValue: lifecycleService,
        },
        {
          provide: MonitoringService,
          useValue: {},
        },
        {
          provide: DevelopmentService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<EmbeddingsClientService>(EmbeddingsClientService);
    configService = module.get(ConfigService);
    apiKeyService = module.get(ApiKeyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have config service available', () => {
    expect(configService).toBeDefined();
  });

  describe('configuration', () => {
    it('should access configuration values', () => {
      const testConfig = configService.get('TEST_KEY');
      expect(testConfig).toBe('test-value');
      expect(configService.get).toHaveBeenCalledWith('TEST_KEY');
    });
  });

  it('should have API key service available', () => {
    expect(apiKeyService).toBeDefined();
  });

  it('sends the canonical projection-deletion command with the scoped credential', async () => {
    const command: ProjectionDeletionCommand = {
      organizationId: 'org-123',
      markerId: 'marker-123',
      irreversibleClosureAt: '2026-08-19T12:00:00.000Z',
      deletionDeadline: '2026-09-18T12:00:00.000Z',
    };
    const result: ProjectionDeletionResult = {
      ...command,
      tombstoneRecorded: true,
      contentVerificationCompleted: true,
    };
    lifecycleService.deleteOrganizationProjection.mockReturnValue(
      of({ data: result } as AxiosResponse<ProjectionDeletionResult>),
    );

    await expect(
      service.deleteOrganizationProjection(command, 'closure-token'),
    ).resolves.toEqual(result);

    expect(lifecycleService.deleteOrganizationProjection).toHaveBeenCalledWith(
      'org-123',
      command,
      expect.objectContaining({
        config: expect.objectContaining({
          headers: {
            Authorization: 'Bearer closure-token',
            'Content-Type': 'application/json',
          },
        }),
      }),
    );
  });

  describe('embedding operations', () => {
    it('should handle embedding requests', async () => {
      // Test basic service instantiation and mock setup
      expect(service).toBeInstanceOf(EmbeddingsClientService);
    });

    it('should be ready for embedding creation', () => {
      // Verify the service is properly set up for embeddings
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });
  });

  describe('searchWithUserToken', () => {
    it('should pass parsed entity types to generated GET entityType parameter', async () => {
      const response: AxiosResponse<SearchResponse> = {
        data: { data: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
      searchService.searchEmbeddingsOrgGet.mockReturnValue(of(response));

      await service.searchWithUserToken(
        {
          q: 'test',
          organizationId: 'org-123' as OrganizationId,
          projectId: 'project-456' as ProjectId,
          statuses: ['open'],
          entityType: 'task',
        },
        'user-token',
      );

      expect(searchService.searchEmbeddingsOrgGet).toHaveBeenCalledWith(
        'org-123',
        'project-456',
        'test',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ['task'],
        expect.objectContaining({
          config: expect.objectContaining({
            params: expect.objectContaining({
              q: 'test',
              statuses: ['open'],
              entityType: ['task'],
            }),
          }),
        }),
      );
    });

    it('should forward searchType and boostRecent through generated GET', async () => {
      const response: AxiosResponse<SearchResponse> = {
        data: { data: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
      searchService.searchEmbeddingsOrgGet.mockReturnValue(of(response));

      await service.searchWithUserToken(
        {
          q: 'test',
          organizationId: 'org-123' as OrganizationId,
          projectId: 'project-456' as ProjectId,
          searchType: 'hybrid',
          boostRecent: true,
        },
        'user-token',
      );

      expect(searchService.searchEmbeddingsOrgGet).toHaveBeenCalledWith(
        'org-123',
        'project-456',
        'test',
        undefined,
        undefined,
        'hybrid',
        undefined,
        true,
        undefined,
        expect.any(Object),
      );
    });
  });
});
