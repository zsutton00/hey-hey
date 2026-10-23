import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { of } from 'rxjs';

import { ProviderRegistryService } from '../../../../context/registry/provider-registry.service';
import { ContextResolutionService } from '../../../../context/services/context-resolution.service';
import { SearchContextProvider } from '../../../../context/providers/search-context.provider';
import { JwtKeysService } from '../../../../auth/services/jwt-keys.service';

import { PlaceholderContextBuilder } from '../base/placeholder-context';
import { StandardPlaceholderRegistry } from '../registries/standard-placeholders.registry';
import type { PlaceholderContext } from '../base/placeholder-types';

import type {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import type { FlowContext } from '../../../../types/flow-internal.types';
import type { ArtifactService } from '../../../artifacts/artifact.service';
import type { InitiativeService } from '../../../initiatives/initiative.service';
import type { TaskService } from '../../../tasks/task.service';
import { ApiKeyService } from 'src/services/api-key.service';
import { SearchService } from 'src/generated/embeddings/api/search.service';

describe('StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS (live)', () => {
  let testingModule: TestingModule;
  let contextResolutionService: ContextResolutionService;
  let placeholderContext: PlaceholderContext;

  beforeAll(async () => {
    jest.setTimeout(20000);

    process.env.EMBEDDINGS_SERVICE_URL =
      process.env.EMBEDDINGS_SERVICE_URL ?? 'http://localhost:5005';
    process.env.EMBEDDINGS_SERVICE_ENABLED =
      process.env.EMBEDDINGS_SERVICE_ENABLED ?? 'true';
    process.env.EMBEDDINGS_SERVICE_API_KEY =
      process.env.EMBEDDINGS_SERVICE_API_KEY ?? 'test-embeddings-service-key';

    const apiKeyServiceMock = {
      getOrganizationApiKey: jest
        .fn()
        .mockResolvedValue('test-organization-api-key'),
    } satisfies Partial<ApiKeyService>;
    const jwtKeysServiceMock = {
      getToken: jest
        .fn()
        .mockReturnValue(process.env.EMBEDDINGS_SERVICE_API_KEY),
      getSystemUserId: jest.fn().mockReturnValue('system'),
      isSystemSubject: (subject?: string | null): subject is string =>
        Boolean(subject),
    } satisfies Partial<JwtKeysService>;
    const searchServiceMock = {
      searchEmbeddingsOrgPost: jest.fn().mockReturnValue(
        of({
          data: {
            success: true,
            results: 1,
            data: [
              {
                id: 'result-1',
                score: 0.91,
                content: 'Knowledge snippet for live context search',
                metadata: {
                  entityType: 'initiative',
                  entityId: 'live-initiative',
                  title: 'Live Initiative',
                },
                matchType: 'semantic',
              },
            ],
          },
        }),
      ),
    } satisfies Partial<SearchService>;

    testingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), HttpModule],
      providers: [
        ProviderRegistryService,
        ContextResolutionService,
        SearchContextProvider,
        { provide: ApiKeyService, useValue: apiKeyServiceMock },
        { provide: JwtKeysService, useValue: jwtKeysServiceMock },
        { provide: SearchService, useValue: searchServiceMock },
      ],
    }).compile();

    contextResolutionService = testingModule.get(ContextResolutionService);
    const searchProvider = testingModule.get(SearchContextProvider);
    contextResolutionService.registerProvider(searchProvider);

    const organizationId =
      '6815f349-7b01-4852-9b59-66cf17709c25' as OrganizationId;
    const projectId = '06748933-867b-4b1b-be5f-a2cc9332fa26' as ProjectId;

    const conversationId = 'live-conversation' as ConversationId;
    const workflowId = 'live-workflow' as WorkflowId;
    const userId = 'test-user' as UserId;
    const initiativeId = 'live-initiative' as InitiativeId;

    const flowContext = {
      core: {
        workflowId,
        projectId,
        organizationId,
        conversationId,
        workflowAboutId: initiativeId,
        workflowAboutType: 'initiative',
        user: {
          id: userId,
          role: 'admin',
        },
        session: {
          startTime: new Date(),
          interactionCount: 1,
        },
      },
      flowId: 'initiative-refinement',
      flowPath: {
        pathTaken: [],
      },
      initiativeId,
    } as FlowContext & { initiativeId: InitiativeId };

    placeholderContext = PlaceholderContextBuilder.create()
      .withFlowContext(flowContext)
      .withServices({
        initiativeService: {
          findOne: jest.fn(),
        } as unknown as InitiativeService,
        artifactService: { findMany: jest.fn() } as unknown as ArtifactService,
        taskService: {} as TaskService,
        designDocService: {} as any,
        contextResolutionService,
      })
      .build();
  });

  afterAll(async () => {
    if (testingModule) {
      await testingModule.close();
    }
  });

  it('performs a live embeddings search via CONTEXT_SEARCH_RESULTS', async () => {
    const result =
      await StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS.resolve(
        placeholderContext,
        {
          query: 'knowledge',
          maxResults: 3,
        },
      );

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('[Context search failed]');
  });
});
