import { Logger, type Type, type ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Client, WorkflowClient } from '@temporalio/client';
import { ModuleMocker, type MockMetadata } from 'jest-mock';
import { JwtKeysService } from '../../src/auth/services/jwt-keys.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../src/core/events/tokens';
import { QUEUE_SERVICE_TOKEN } from '../../src/core/queue/queue.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEMPORAL_CLIENT } from '../../src/prisma/temporal.module';
import { ApiKeyService } from '../../src/services/api-key.service';
import { ConversationService } from '../../src/services/conversation.service';
import { EntityRegistryService } from '../../src/services/entity-registry/entity-registry.service';
import { InfluenceService } from '../../src/services/influence/influence.service';
import { JOB_ENQUEUER_TOKEN } from '../../src/services/job.tokens';
import { LLMTrackingService } from '../../src/services/llm/llm-tracking.service';
import { MessageService } from '../../src/services/message.service';
import { WorkflowRouterService } from '../../src/services/workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../../src/services/workflows/workflow-type-registry.service';

const moduleMocker = new ModuleMocker(global);

type ProviderToken<T = unknown> = string | symbol | Type<T> | Function;

type OverrideEntry = [ProviderToken, unknown];

type OverridesInput =
  | Map<ProviderToken, unknown>
  | OverrideEntry[]
  | ReadonlyArray<OverrideEntry>
  | undefined;

interface DefaultMockDefinition<T> {
  token: ProviderToken<T>;
  factory: () => T;
}

const createConfigServiceMock = (): jest.Mocked<ConfigService> =>
  ({
    get: jest.fn(),
    getOrThrow: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
  }) as unknown as jest.Mocked<ConfigService>;

const createJwtKeysServiceMock = (): jest.Mocked<JwtKeysService> =>
  ({
    getToken: jest.fn(),
    getSystemUserId: jest.fn(),
    isSystemSubject: jest.fn(),
  }) as unknown as jest.Mocked<JwtKeysService>;

const createLLMTrackingServiceMock = (): jest.Mocked<LLMTrackingService> =>
  ({
    recordPromptStart: jest.fn(),
    finalizePromptResponse: jest.fn(),
    recordPromptResponse: jest.fn(),
    findMany: jest.fn(),
    findById: jest.fn(),
    getStatsForOrganization: jest.fn(),
    getOrganizationCostSummary: jest.fn(),
    getProjectCostSummaries: jest.fn(),
  }) as unknown as jest.Mocked<LLMTrackingService>;

const createPrismaServiceMock = (): jest.Mocked<PrismaService> => {
  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
    $extends: jest.fn().mockReturnThis(),
    db: {
      $transaction: jest.fn(),
    },
  };

  return prismaMock as unknown as jest.Mocked<PrismaService>;
};

const createTemporalClientMock = (): Partial<Client> => ({
  workflow: {
    getHandle: jest.fn().mockReturnValue({
      signal: jest.fn(),
      terminate: jest.fn(),
    }),
    start: jest.fn(),
  } as Partial<WorkflowClient> as WorkflowClient,
});

const createDomainEventPublisherMock = () => ({
  publish: jest.fn(),
  publishInTransaction: jest.fn(),
});

const createJobEnqueuerMock = () => ({
  queueLLMWorkflow: jest.fn(),
  queueFlowNodeExecution: jest.fn(),
  queueNonInteractiveFlowNodeExecution: jest.fn(),
  queueArtifactGeneration: jest.fn(),
  getJob: jest.fn(),
  getQueueStats: jest.fn(),
  retryJob: jest.fn(),
});

const createQueueServiceMock = () => ({
  addProcessor: jest.fn(),
  processJob: jest.fn(),
  getJob: jest.fn(),
});

const createApiKeyServiceMock = (): jest.Mocked<ApiKeyService> =>
  (() => {
    const createOrganizationApiKey = jest.fn();
    return {
      getOrganizationApiKey: jest.fn(),
      createOrganizationApiKey,
      createMastraApiKey: createOrganizationApiKey,
      invalidateOrganizationApiKey: jest.fn(),
      clearOrganizationApiKeyCache: jest.fn(),
      createServiceApiKey: jest.fn(),
    } as unknown as jest.Mocked<ApiKeyService>;
  })();

const createLoggerMock = (): jest.Mocked<Logger> =>
  ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    setContext: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

const createWorkflowRouterServiceMock =
  (): jest.Mocked<WorkflowRouterService> =>
    ({
      routeUserMessage: jest.fn(),
      registerWorkflowType: jest.fn(),
      sendUserMessage: jest.fn(),
      restartWorkflow: jest.fn(),
      sendSkipToNode: jest.fn(),
      isWorkflowRunning: jest.fn().mockResolvedValue(true),
      getWorkflowInfo: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      sendStructuredMessage: jest.fn(),
    }) as unknown as jest.Mocked<WorkflowRouterService>;

const createWorkflowTypeRegistryServiceMock =
  (): jest.Mocked<WorkflowTypeRegistryService> =>
    ({
      getWorkflowConfig: jest.fn().mockReturnValue(null),
      getSupportedWorkflowConfigs: jest.fn().mockReturnValue([]),
      getAllSupportedWorkflowTypes: jest.fn().mockReturnValue([]),
      isWorkflowTypeSupported: jest.fn().mockReturnValue(true),
      validateWorkflowName: jest.fn(),
      startWorkflowByType: jest.fn(),
    }) as unknown as jest.Mocked<WorkflowTypeRegistryService>;

const createInfluenceServiceMock = (): jest.Mocked<InfluenceService> =>
  ({
    createMany: jest.fn(),
    getInfluencesOn: jest.fn(),
    getInfluencesBy: jest.fn(),
    deleteInfluencesForEntity: jest.fn(),
  }) as unknown as jest.Mocked<InfluenceService>;

const createEntityRegistryServiceMock =
  (): jest.Mocked<EntityRegistryService> =>
    ({
      registerEntity: jest.fn(),
      lookupEntityTypes: jest.fn(),
      registerEntities: jest.fn(),
      getEntitiesByIds: jest.fn().mockResolvedValue([]),
    }) as unknown as jest.Mocked<EntityRegistryService>;

const createMessageServiceMock = (): jest.Mocked<MessageService> =>
  ({
    getMentionsForConversation: jest.fn().mockResolvedValue([]),
    getMessagesMentioningEntity: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<MessageService>;

const createConversationServiceMock = (): jest.Mocked<ConversationService> =>
  ({
    createConversation: jest.fn(),
    getConversation: jest.fn(),
    findOne: jest.fn(),
    updateConversation: jest.fn(),
    updateConversationInternal: jest.fn(),
    updateConversationWorkflowId: jest.fn(),
    incrementConversationVersion: jest.fn(),
    getConversationsByProject: jest.fn(),
    getActiveConversations: jest.fn(),
    getActiveConversationsFromAdapter: jest.fn(),
    getConversationsByInitiativeFromAdapter: jest.fn(),
    getConversationsByWorkflowEntityFromAdapter: jest.fn(),
    getAllConversationsFromAdapter: jest.fn(),
    getConversationFromAdapter: jest.fn(),
    getConversationVersion: jest.fn(),
    updateConversationFromAdapter: jest.fn(),
    deleteConversation: jest.fn(),
    deleteConversationFromAdapter: jest.fn(),
    getConversationHistoryEntries: jest.fn(),
    getRecentMessages: jest.fn(),
  }) as unknown as jest.Mocked<ConversationService>;

const DEFAULT_MOCKS = {
  configService: {
    token: ConfigService,
    factory: createConfigServiceMock,
  },
  jwtKeysService: {
    token: JwtKeysService,
    factory: createJwtKeysServiceMock,
  },
  llmTrackingService: {
    token: LLMTrackingService,
    factory: createLLMTrackingServiceMock,
  },
  prismaService: {
    token: PrismaService,
    factory: createPrismaServiceMock,
  },
  temporalClient: {
    token: TEMPORAL_CLIENT,
    factory: createTemporalClientMock,
  },
  domainEventPublisher: {
    token: DOMAIN_EVENT_PUBLISHER_TOKEN,
    factory: createDomainEventPublisherMock,
  },
  jobEnqueuer: {
    token: JOB_ENQUEUER_TOKEN,
    factory: createJobEnqueuerMock,
  },
  queueService: {
    token: QUEUE_SERVICE_TOKEN,
    factory: createQueueServiceMock,
  },
  apiKeyService: {
    token: ApiKeyService,
    factory: createApiKeyServiceMock,
  },
  logger: {
    token: Logger,
    factory: createLoggerMock,
  },
  workflowRouterService: {
    token: WorkflowRouterService,
    factory: createWorkflowRouterServiceMock,
  },
  workflowTypeRegistryService: {
    token: WorkflowTypeRegistryService,
    factory: createWorkflowTypeRegistryServiceMock,
  },
  influenceService: {
    token: InfluenceService,
    factory: createInfluenceServiceMock,
  },
  entityRegistryService: {
    token: EntityRegistryService,
    factory: createEntityRegistryServiceMock,
  },
  messageService: {
    token: MessageService,
    factory: createMessageServiceMock,
  },
  conversationService: {
    token: ConversationService,
    factory: createConversationServiceMock,
  },
} as const satisfies Record<string, DefaultMockDefinition<unknown>>;

type DefaultMockRegistry = typeof DEFAULT_MOCKS;

type ExtractFactoryResult<K extends keyof DefaultMockRegistry> = ReturnType<
  DefaultMockRegistry[K]['factory']
>;

export type ServiceTestingModuleMocks = {
  [K in keyof DefaultMockRegistry]: ExtractFactoryResult<K>;
} & {
  get<T>(token: ProviderToken<T>): T;
};

const defaultMockFactories = new Map<ProviderToken, () => unknown>(
  Object.values(DEFAULT_MOCKS).map(({ token, factory }) => [token, factory]),
);

const normalizeOverrides = (
  overrides: OverridesInput,
): Map<ProviderToken, unknown> => {
  if (!overrides) {
    return new Map();
  }

  if (overrides instanceof Map) {
    return new Map(overrides);
  }

  return new Map(overrides);
};

const extractProviderToken = (provider: unknown): ProviderToken | null => {
  if (
    provider &&
    typeof provider === 'object' &&
    'provide' in (provider as Record<string, unknown>)
  ) {
    return (provider as { provide: ProviderToken }).provide;
  }

  if (
    typeof provider === 'function' ||
    typeof provider === 'string' ||
    typeof provider === 'symbol'
  ) {
    return provider as ProviderToken;
  }

  return null;
};

export interface ServiceTestingModuleOptions
  extends Partial<
    Pick<ModuleMetadata, 'imports' | 'providers' | 'controllers' | 'exports'>
  > {
  overrides?: OverridesInput;
}

export interface ServiceTestingModuleResult {
  module: TestingModule;
  mocks: ServiceTestingModuleMocks;
}

export const registerServiceTestingModuleDefaultMock = <T>(
  token: ProviderToken<T>,
  factory: () => T,
) => {
  defaultMockFactories.set(token, factory);
};

export async function createServiceTestingModule(
  metadata: ServiceTestingModuleOptions,
): Promise<ServiceTestingModuleResult> {
  const { overrides, ...moduleMetadata } = metadata;
  const overridesMap = normalizeOverrides(overrides);
  const providers = moduleMetadata.providers ?? [];
  moduleMetadata.providers = providers;

  const providerTokens = new Set(
    providers
      .map((provider: unknown) => extractProviderToken(provider))
      .filter((token): token is ProviderToken => Boolean(token)),
  );

  (Object.values(DEFAULT_MOCKS) as DefaultMockDefinition<unknown>[]).forEach(
    ({ token, factory }) => {
      if (!overridesMap.has(token) && !providerTokens.has(token)) {
        overridesMap.set(token, factory());
      }
    },
  );

  overridesMap.forEach((value, token) => {
    if (!providerTokens.has(token)) {
      providers.push({ provide: token, useValue: value });
      providerTokens.add(token);
    }
  });

  const builder = Test.createTestingModule(moduleMetadata);

  overridesMap.forEach((value, token) => {
    try {
      builder.overrideProvider(token).useValue(value);
    } catch (error) {
      // Ignore tokens that are not registered in the testing module metadata.
    }
  });

  builder.useMocker((token) => {
    if (!token) {
      return undefined;
    }
    if (overridesMap.has(token)) {
      return overridesMap.get(token);
    }

    if (typeof token === 'function') {
      const metadata = moduleMocker.getMetadata(token);
      if (!metadata) {
        return undefined;
      }
      return moduleMocker.generateFromMetadata(
        metadata as MockMetadata<unknown>,
      );
    }

    return undefined;
  });

  const module = await builder.compile();

  const resolvedMocks = {} as ServiceTestingModuleMocks;

  (Object.keys(DEFAULT_MOCKS) as Array<keyof DefaultMockRegistry>).forEach(
    (key) => {
      const { token } = DEFAULT_MOCKS[key];
      let instance: unknown;
      try {
        instance = module.get(token, { strict: false });
      } catch {
        instance =
          overridesMap.get(token) ?? defaultMockFactories.get(token)?.();
      }
      // @ts-expect-error override readonly for tests
      resolvedMocks[key] = instance as ExtractFactoryResult<typeof key>;
    },
  );

  resolvedMocks.get = <T>(token: ProviderToken<T>) => {
    try {
      return module.get(token, { strict: false });
    } catch {
      return (overridesMap.get(token) ??
        defaultMockFactories.get(token)?.()) as T;
    }
  };

  return { module, mocks: resolvedMocks };
}
