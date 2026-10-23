/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef, NestApplicationContext } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { WorkerOptions } from '@temporalio/worker';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import { CustomLoggerService } from '../../../common/logger/logger.service';
import { ProviderRegistryService } from '../../../context/registry/provider-registry.service';
import { ContextResolutionService } from '../../../context/services/context-resolution.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { EventRouter } from '../../../core/events/event-router';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import { EventContextManager } from '../../../core/events/observable-event.context';
import { OutboxPublisher } from '../../../core/events/outbox-publisher.service';
import {
  DOMAIN_EVENT_PUBLISHER_TOKEN,
  MESSAGE_BUS_TOKEN,
  OUTBOX_STORE_TOKEN,
} from '../../../core/events/tokens';
import { AgentProcessor } from '../../../core/processing/agent-processor.service';
import { ArtifactProcessor } from '../../../core/processing/artifact-processor.service';
import { CoreProcessor } from '../../../core/processing/core-processor.service';
import { FlowNodeErrorRecoveryService } from '../../../services/workflows/flow-node-error-recovery.service';
import { FlowNodeProcessor } from '../../../core/processing/flow-node-processor.service';
import { LlmProcessor } from '../../../core/processing/llm-processor.service';
import { MessageProcessor } from '../../../core/processing/message-processor.service';
import { NotificationGenerationProcessor } from '../../../core/processing/notification-generation-processor.service';
import { QUEUE_SERVICE_TOKEN } from '../../../core/queue/queue.module';
import { EntityLifecycleProcessor } from '../../../core/processing/entity-lifecycle-processor.service';
import { NonInteractiveFlowNodeProcessor } from '../../../core/processing/non-interactive-flow-node-processor.service';
import { RedisQueueService } from '../../../core/queue/redis-queue.service';
import { RedisService } from '../../../core/redis/redis.service';
import { NodeRegistry } from '../../../flows/nodes/node-registry.service';
import { EntityRegistryService } from '../../../services/entity-registry/entity-registry.service';

// Onboarding nodes
import { OnboardingAnalyzeProjectConceptNode } from '../../../flows/nodes/onboarding/onboarding-analyze-project-concept.node';
import { OnboardingClarifyConceptNode } from '../../../flows/nodes/onboarding/onboarding-clarify-concept.node';
import { OnboardingEndNode } from '../../../flows/nodes/onboarding/onboarding-end.node';
import { OnboardingFinalizeNode } from '../../../flows/nodes/onboarding/onboarding-finalize.node';
import { OnboardingNextStepsService } from '../../../services/onboarding-next-steps.service';
import { OnboardingGenerateInitiativesNode } from '../../../flows/nodes/onboarding/onboarding-generate-initiatives.node';
import { OnboardingCreatePlansNode } from '../../../flows/nodes/onboarding/onboarding-create-plans.node';
import { OnboardingGeneratePlansNode } from '../../../flows/nodes/onboarding/onboarding-generate-plans.node';
import { OnboardingRecoveryNode } from '../../../flows/nodes/onboarding/onboarding-recovery.node';
import { OnboardingSelectOutcomeNode } from '../../../flows/nodes/onboarding/onboarding-select-outcome.node';
import { OnboardingWelcomeNode } from '../../../flows/nodes/onboarding/onboarding-welcome.node';

// Shared nodes
import { SharedAddressConcernsNode } from '../../../flows/nodes/shared/shared-address-concerns.node';
import { SharedAnalyzeProjectNode } from '../../../flows/nodes/shared/shared-analyze-project.node';
import { SharedAssessImplementationNode } from '../../../flows/nodes/shared/shared-assess-implementation.node';
import { SharedBusinessDiscoveryNode } from '../../../flows/nodes/shared/shared-business-discovery.node';
import { SharedGenerateArtifactsNode } from '../../../flows/nodes/shared/shared-generate-artifacts.node';
import { SharedIntegrationDiscoveryNode } from '../../../flows/nodes/shared/shared-integration-discovery.node';
import { SharedPoliteRedirectNode } from '../../../flows/nodes/shared/shared-polite-redirect.node';
import { SharedProjectMembersNode } from '../../../flows/nodes/shared/shared-project-members.node';
import { SharedSetupIntegrationsNode } from '../../../flows/nodes/shared/shared-setup-integrations.node';
import { SharedTechnicalDiscoveryMatureNode } from '../../../flows/nodes/shared/shared-technical-discovery-mature.node';
import { SharedTechnicalDiscoveryNode } from '../../../flows/nodes/shared/shared-technical-discovery.node';

// Initiative Refinement nodes
import { InitiativeRefinementAgentEditorNode } from 'src/flows/nodes/initiative-refinement/agent_editor.node';
import { InitiativeRefinementEndNode } from '../../../flows/nodes/initiative-refinement/initiative-refinement-end.node';
import { InitiativeRefinementFinalizeNode } from '../../../flows/nodes/initiative-refinement/initiative-refinement-finalize.node';
import { InitiativeRefinementRecoveryNode } from '../../../flows/nodes/initiative-refinement/initiative-refinement-recovery.node';
import { InitiativeRefinementWelcomeNode } from '../../../flows/nodes/initiative-refinement/initiative-refinement-welcome.node';
import { initiativeRefinementFlow } from '../../../flows/templates/initiative-refinement.flow';
import { onboardingFlow } from '../../../flows/templates/onboarding.flow';
import { CreateProjectDto } from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import { MastraClientService } from '../../../services/agents/mastra-client.service';
import { ApiKeyService } from '../../../services/api-key.service';
import { ArchiveOrchestrationService } from '../../../services/archive-orchestration/archive-orchestration.service';
import { ArtifactDataService } from '../../../services/artifacts/artifact-data.service';
import { ArtifactDataValidators } from '../../../services/artifacts/artifact-data.validators';
import { ArtifactGraphService } from '../../../services/artifacts/artifact-graph.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { ConversationService } from '../../../services/conversation.service';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import { FeatureFlagService } from '../../../services/feature-flag/feature-flag.service';
import { InitiativeArtifactService } from '../../../services/initiatives/initiative-artifact.service';
import { InitiativeLifecycleService } from '../../../services/initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationService } from '../../../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import { IJobEnqueuer } from '../../../services/interfaces/job-enqueuer.interface';
import { EntitySummaryService } from '../../../services/entity-summary/entity-summary.service';
import { SubfacetService } from '../../../services/entity-summary/subfacet.service';
import { InfluenceService } from '../../../services/influence/influence.service';
import { JobEnqueueingService } from '../../../services/job-enqueuing.service';
import { JOB_ENQUEUER_TOKEN } from '../../../services/job.tokens';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { PlaceholderResolver } from '../../../services/llm/placeholders/resolver.service';
import { PromptBuilderService } from '../../../services/llm/prompt-builder.service';
import { InitiativeRefinementPromptBuilderStrategy } from '../../../services/llm/strategies/initiative-refinement-prompt-builder.strategy';
import { StandardPromptBuilderStrategy } from '../../../services/llm/strategies/standard-prompt-builder.strategy';
import { MessageClassificationService } from '../../../services/message-classification/message-classification.service';
import { MessageService } from '../../../services/message.service';
import { MentionRelationService } from '../../../services/mentions/mention-relation.service';
import { OrganizationService } from '../../../services/organization.service';
import { OutboxStore } from '../../../services/outbox-store.service';
import { PendingEdgeService } from '../../../services/proposal/pending-edge.service';
import { ProjectService } from '../../../services/project.service';
import { SecurityLoggerService } from '../../../services/security-logger.service';
import { UserService } from '../../../services/user.service';
import { EmailService } from '../../../services/email.service';
import { TagService } from '../../../services/tag.service';
import { TaskService } from '../../../services/tasks/task.service';
import { TaskArtifactService } from '../../../services/tasks/task-artifact.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { FlowExecutionService } from '../../../services/workflows/flow-execution.service';
import { FlowSecurityService } from '../../../services/workflows/flow-security.service';
import { InitiativeRefinementWorkflowService } from '../../../services/workflows/initiative-refinement-workflow.service';
import { WorkflowTypeRegistryService } from '../../../services/workflows/workflow-type-registry.service';
import { OrganizationId, UserId } from '../../../types';
import { SqlitePrismaWrapper } from '../sqlite-prisma-wrapper';
import { SqliteOutboxStore } from './sqlite-outbox-store';
import { FlowContext, INode } from 'src/types/flow-internal.types';
import { InitiativeRefinementPromptNextInputNode } from 'src/flows/nodes/initiative-refinement/initiative-refinement-prompt-next-input.node';

export type NodeResponseMap = Record<
  string,
  | string
  | (() => unknown | Promise<unknown>)
  | unknown
  | Array<string | (() => unknown | Promise<unknown>) | unknown>
>;

export interface FunctionalTestRunnerOptions {
  temporal: {
    taskQueue: string;
    workflowsPath: string;
    activities: Record<string, unknown>;
    workerOptions?: Partial<WorkerOptions>;
  };
  baseOrganization?: {
    slug: string;
    name: string;
    description?: string;
  };
  baseUser?: {
    id?: UserId;
    email?: string;
    name?: string;
  };
  registerFlows?: (flowEngine: NodeExecutionService) => void | Promise<void>;
  createProjectOverrides?: Partial<CreateProjectDto>;
}

interface ModuleContext {
  module: TestingModule;
  logger: CustomLoggerService;
  projectService: ProjectService;
  artifactService: ArtifactService;
  messageService: MessageService;
  flowNodeProcessor: FlowNodeProcessor;
  coreProcessor: CoreProcessor;
  outboxPublisher: OutboxPublisher;
  conversationService: ConversationService;
}

interface TestContext {
  module: TestingModule;
  prisma: SqlitePrismaWrapper;
  redis: Redis;
  worker: Worker;
  testEnv: TestWorkflowEnvironment;
  projectService: ProjectService;
  artifactService: ArtifactService;
  messageService: MessageService;
  flowNodeProcessor: FlowNodeProcessor;
  coreProcessor: CoreProcessor;
  outboxPublisher: OutboxPublisher;
  conversationService: ConversationService;
}

type LlmOverrideEntry =
  | string
  | (() => unknown | Promise<unknown>)
  | unknown
  | Array<string | (() => unknown | Promise<unknown>) | unknown>;

export class FunctionalTestRunner {
  private readonly testDbPath = path.join(process.cwd(), 'prisma', 'test.db');

  private sqlitePrisma!: SqlitePrismaWrapper;
  private redis?: Redis;
  private testEnv?: TestWorkflowEnvironment;
  private worker?: Worker;
  private module?: TestingModule;

  private projectService?: ProjectService;
  private artifactService?: ArtifactService;
  private messageService?: MessageService;
  private flowNodeProcessor?: FlowNodeProcessor;
  private coreProcessor?: CoreProcessor;
  private outboxPublisher?: OutboxPublisher;

  private testOrganizationId!: OrganizationId;
  private testUserId!: UserId;
  private testUserEmail!: string;

  private readonly mockConversationValidation = {
    validateConversationBelongsToProject: jest.fn(),
    validateProjectIdConsistency: jest.fn(),
  };

  private llmOverrides: Record<string, LlmOverrideEntry> = {};
  private llmOverrideCallCounts: Record<string, number> = {};

  private currentContext?: TestContext;

  constructor(private readonly options: FunctionalTestRunnerOptions) {}

  get organizationId(): OrganizationId {
    return this.testOrganizationId;
  }

  get userId(): UserId {
    return this.testUserId;
  }

  get userEmail(): string {
    return this.testUserEmail;
  }

  get prisma(): SqlitePrismaWrapper {
    return this.sqlitePrisma;
  }

  get context(): TestContext {
    if (!this.currentContext) {
      throw new Error(
        'FunctionalTestRunner context is not available. Did you call testSetup()?',
      );
    }
    return this.currentContext;
  }

  setLlmResponses(map: NodeResponseMap): void {
    this.llmOverrides = { ...map };
    this.llmOverrideCallCounts = {};
  }

  async suiteSetup(): Promise<void> {
    const testRunId = uuidv4().slice(0, 8);
    this.testUserId =
      this.options.baseUser?.id ?? (`user-${testRunId}` as UserId);
    this.testUserEmail =
      this.options.baseUser?.email ?? `test-${testRunId}@example.com`;

    const baseOrg = this.options.baseOrganization ?? {
      slug: 'functional-test-org',
      name: 'Functional Test Organization',
      description: 'Organization used for functional testing',
    };

    // Clean existing database
    this.removeTestDb();

    try {
      execSync('npx prisma generate --schema=prisma/test.prisma', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      execSync(
        'npx prisma db push --schema=prisma/test.prisma --skip-generate',
        {
          cwd: process.cwd(),
          stdio: 'inherit',
        },
      );
    } catch (error) {
      console.error('Failed to prepare Prisma schema for tests', error);
      throw error;
    }

    const { PrismaClient: TestPrismaClient } = await import(
      path.join(process.cwd(), 'node_modules/.prisma/client-test/index.js')
    );

    const rawClient = new TestPrismaClient();
    this.sqlitePrisma = new SqlitePrismaWrapper(rawClient);
    await this.sqlitePrisma.$connect();

    await this.sqlitePrisma.db.user.upsert({
      where: { id: this.testUserId },
      create: {
        id: this.testUserId,
        email: this.testUserEmail,
        name: this.options.baseUser?.name ?? 'Functional Test User',
      },
      update: {
        email: this.testUserEmail,
        name: this.options.baseUser?.name ?? 'Functional Test User',
      },
    });

    const organization = await this.sqlitePrisma.db.organization.upsert({
      where: { slug: baseOrg.slug },
      create: {
        id: uuidv4() as OrganizationId,
        name: baseOrg.name,
        slug: baseOrg.slug,
        description: baseOrg.description,
        isActive: true,
      },
      update: {
        name: baseOrg.name,
        description: baseOrg.description,
        isActive: true,
      },
    });

    this.testOrganizationId = organization.id;

    await this.sqlitePrisma.db.organizationMember.upsert({
      where: {
        userId_organizationId: {
          userId: this.testUserId,
          organizationId: organization.id,
        },
      },
      create: {
        userId: this.testUserId,
        organizationId: organization.id,
        role: 'OWNER',
      },
      update: { role: 'OWNER', isActive: true },
    });

    // Ensure Temporal runtime is configured only once
    try {
      const filteredLogger = new DefaultLogger('DEBUG');
      const originalLog = filteredLogger.log.bind(filteredLogger);
      filteredLogger.log = (level, message, meta) => {
        if (meta && typeof meta === 'object') {
          if ('peer' in meta && meta.peer === 'Client') {
            return;
          }
          if ('sdkComponent' in meta && meta.sdkComponent === 'core') {
            return;
          }
        }
        originalLog(level, message, meta);
      };

      Runtime.install({
        logger: filteredLogger,
        telemetryOptions: {
          logging: {
            forward: {
              level: 'DEBUG',
            },
          },
        },
      });
    } catch (error) {
      console.log('Temporal runtime already installed, skipping:', error);
    }
  }

  async suiteTeardown(): Promise<void> {
    await this.cleanupAfterEach();

    if (this.sqlitePrisma) {
      try {
        await this.sqlitePrisma.$disconnect();
      } catch (error) {
        console.warn('Failed to disconnect prisma client', error);
      }
    }

    this.removeTestDb();
  }

  async testSetup(): Promise<TestContext> {
    await this.clearDatabase();
    await this.setupRedis();
    await this.setupTemporal();
    await this.createWorker();
    this.module = await this.createTestingModule();
    const moduleContext = await this.initializeModule(this.module);
    await this.startWorker();

    this.currentContext = {
      module: moduleContext.module,
      prisma: this.sqlitePrisma,
      redis: this.redis!,
      worker: this.worker!,
      testEnv: this.testEnv!,
      projectService: moduleContext.projectService,
      artifactService: moduleContext.artifactService,
      messageService: moduleContext.messageService,
      flowNodeProcessor: moduleContext.flowNodeProcessor,
      coreProcessor: moduleContext.coreProcessor,
      outboxPublisher: moduleContext.outboxPublisher,
      conversationService: moduleContext.conversationService,
    };

    return this.currentContext;
  }

  async testTeardown(): Promise<void> {
    await this.cleanupAfterEach();
    this.currentContext = undefined;
  }

  async createProject(
    override: Partial<CreateProjectDto> = {},
  ): Promise<Awaited<ReturnType<ProjectService['create']>>> {
    const contextManager = EventContextManager.getInstance();
    const projectService = this.projectService;
    if (!projectService) {
      throw new Error(
        'ProjectService not available. Ensure testSetup() has been called.',
      );
    }

    const dto: CreateProjectDto & { organizationId: OrganizationId } = {
      name: 'Test Project',
      description: 'Functional test project',
      organizationId: this.testOrganizationId,
      ...this.options.createProjectOverrides,
      ...override,
    };

    return contextManager.runWithContext(
      {
        correlationId: contextManager.createCorrelationId(),
        sourceService: 'test',
        sourceMethod: 'functionalTestRunner.createProject',
        userId: this.testUserId,
        organizationId: this.testOrganizationId,
      },
      () => projectService.create(dto, this.testUserId),
    );
  }

  private removeTestDb(): void {
    if (fs.existsSync(this.testDbPath)) {
      fs.unlinkSync(this.testDbPath);
    }
    if (fs.existsSync(`${this.testDbPath}-journal`)) {
      fs.unlinkSync(`${this.testDbPath}-journal`);
    }
  }

  private async clearDatabase(): Promise<void> {
    const prisma = this.sqlitePrisma;
    if (!prisma) {
      return;
    }

    await prisma.db.message.deleteMany({});
    await prisma.db.conversation.deleteMany({});
    await prisma.db.flowExecution.deleteMany({});
    await prisma.db.integration.deleteMany({});
    await prisma.db.projectInitiative.deleteMany({});
    await prisma.db.influence.deleteMany({});
    await prisma.db.artifact.deleteMany({});
    await prisma.db.tag.deleteMany({});
    await prisma.db.initiative.deleteMany({});
    await prisma.db.organizationMember.deleteMany({});
    await prisma.db.outboxEvent.deleteMany({});
    await prisma.db.eventLog.deleteMany({});
    await prisma.db.project.deleteMany({});
    await prisma.db.organization.deleteMany({});

    await prisma.db.organization.upsert({
      where: { id: this.testOrganizationId },
      create: {
        id: this.testOrganizationId,
        name: 'Functional Test Organization',
        slug: this.options.baseOrganization?.slug ?? 'functional-test-org',
        description:
          this.options.baseOrganization?.description ??
          'Organization used for functional testing',
        isActive: true,
      },
      update: {
        name:
          this.options.baseOrganization?.name ?? 'Functional Test Organization',
        description:
          this.options.baseOrganization?.description ??
          'Organization used for functional testing',
        isActive: true,
      },
    });
  }

  private async setupRedis(): Promise<void> {
    const RedisMock = require('redis-mock');
    this.redis = RedisMock.createClient() as unknown as Redis;

    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
  }

  private async setupTemporal(): Promise<void> {
    // Time-skipping servers are not supported on all architectures (notably ARM without Rosetta).
    // Try time-skipping first for fast tests, but fall back to the dev server when unavailable.
    const canTimeSkip = process.arch === 'x64';

    if (canTimeSkip) {
      try {
        this.testEnv = await TestWorkflowEnvironment.createTimeSkipping();
        return;
      } catch (error) {
        console.warn(
          '[FunctionalTestRunner] Falling back to dev Temporal test server because time skipping failed',
          error,
        );
      }
    }

    this.testEnv = await TestWorkflowEnvironment.createLocal({
      server: {
        // Skip downloading the Temporal UI to keep setup lightweight in CI/dev sandboxes
        ui: false,
      },
    });
  }

  private async createWorker(): Promise<void> {
    if (!this.testEnv) {
      throw new Error('Temporal test environment not initialized');
    }

    this.worker = await Worker.create({
      connection: this.testEnv.nativeConnection,
      taskQueue: this.options.temporal.taskQueue,
      workflowsPath: this.options.temporal.workflowsPath,
      activities: this.options.temporal.activities,
      debugMode: true,
      bundlerOptions: {
        ignoreModules: ['stream'],
        webpackConfigHook: (config) => {
          config.module = config.module || {};
          config.module.exprContextCritical = false;
          return config;
        },
      },
      ...(this.options.temporal.workerOptions ?? {}),
    });
  }

  private async createTestingModule(): Promise<TestingModule> {
    const redis = this.redis;
    const testEnv = this.testEnv;
    if (!redis || !testEnv) {
      throw new Error('Redis or Temporal environment not initialized');
    }

    const providers = this.createProviders(redis, testEnv.client);
    const testingModule = await Test.createTestingModule({
      providers,
    }).compile();
    return testingModule;
  }

  private createProviders(redis: Redis, temporalClient: Client): Provider[] {
    const host = redis.options.host ?? '127.0.0.1';
    const port = redis.options.port ?? 6379;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const runner = this;

    return [
      CustomLoggerService,
      NodeRegistry,
      {
        provide: PrismaService,
        useValue: this.sqlitePrisma,
      },
      {
        provide: MESSAGE_BUS_TOKEN,
        useClass: InMemoryMessageBus,
      },
      {
        provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
        useFactory: (outboxStore: OutboxStore) => {
          const publisher = new DomainEventPublisher(outboxStore);
          const originalPublish = publisher.publish.bind(publisher);
          publisher.publish = async (event) => {
            console.log('DEBUG: DomainEventPublisher.publish', event);

            return originalPublish(event);
          };
          return publisher;
        },
        inject: [OUTBOX_STORE_TOKEN],
      },
      EventRouter,
      {
        provide: OUTBOX_STORE_TOKEN,
        useClass: SqliteOutboxStore,
      },
      {
        provide: QUEUE_SERVICE_TOKEN,
        useClass: RedisQueueService,
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockImplementation((key: string) => {
            switch (key) {
              case 'REDIS_HOST':
                return host;
              case 'REDIS_PORT':
                return port;
              case 'REDIS_URL':
                return `redis://${host}:${port}`;
              default:
                return undefined;
            }
          }),
        },
      },
      {
        provide: RedisService,
        useValue: {
          getClient: () => redis,
        },
      },
      {
        provide: 'TEMPORAL_CLIENT',
        useValue: temporalClient,
      },
      ProjectService,
      WorkflowTypeRegistryService,
      EntityRegistryService,
      MentionRelationService,
      {
        provide: 'MOCK_WORKFLOW_TYPE_REGISTRY_SERVICE',
        useValue: {
          getWorkflowConfig: jest.fn(),
          getAllSupportedWorkflowTypes: jest.fn(),
          getSupportedWorkflowConfigs: jest.fn(),
          isWorkflowTypeSupported: jest.fn(),
          validateWorkflowType: jest.fn(),
          startWorkflowByType: jest.fn(),
        },
      },
      MessageService,
      {
        provide: ConversationService,
        useFactory: (
          prisma: PrismaService,
          publisher: DomainEventPublisher,
          client: Client,
          messageService: MessageService,
          projectService: ProjectService,
          artifactService: ArtifactService,
          workflowTypeRegistry: WorkflowTypeRegistryService,
        ) =>
          new ConversationService(
            prisma,
            runner.mockConversationValidation,
            publisher,
            client,
            messageService,
            projectService,
            artifactService,
            workflowTypeRegistry,
          ),
        inject: [
          PrismaService,
          DOMAIN_EVENT_PUBLISHER_TOKEN,
          'TEMPORAL_CLIENT',
          MessageService,
          ProjectService,
          ArtifactService,
          WorkflowTypeRegistryService,
        ],
      },
      {
        provide: 'APP_CONTEXT',
        useFactory: (moduleRef: ModuleRef) =>
          ({
            get: (token: unknown) => runner.resolveAppContext(moduleRef, token),
          }) as unknown,
        inject: [ModuleRef],
      },
      PromptBuilderService,
      StandardPromptBuilderStrategy,
      InitiativeRefinementPromptBuilderStrategy,
      PlaceholderResolver,
      IntentDetectorService,
      ArchiveOrchestrationService,
      DesignDocService,
      {
        provide: FeatureFlagService,
        useValue: {
          isEnabled: jest.fn().mockResolvedValue(false),
        },
      },
      {
        provide: EntitySummaryService,
        useValue: {
          getCurrentSummariesByCategory: jest.fn().mockResolvedValue([]),
          createSummaryWithSubfacets: jest.fn().mockResolvedValue({
            summary: null,
            subfacets: [],
          }),
        },
      },
      {
        provide: SubfacetService,
        useValue: {
          createSubfacetsWithDeduping: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: ContextResolutionService,
        useValue: {
          resolveContext: jest.fn().mockResolvedValue({ artifacts: [] }),
        },
      },
      {
        provide: FlowSecurityService,
        useValue: {
          checkFlowAccess: jest.fn().mockResolvedValue(true),
          validateFlowExecution: jest.fn().mockResolvedValue(true),
          validateProjectAccess: jest.fn().mockResolvedValue(undefined),
          validateUserOrganization: jest.fn().mockResolvedValue(undefined),
          validateUserMessage: jest
            .fn()
            .mockImplementation((message) => Promise.resolve(message)),
          sanitizePrompt: jest
            .fn()
            .mockImplementation((prompt: string) => prompt),
        },
      },
      {
        provide: LLMClientService,
        useValue: {
          chat: jest.fn().mockResolvedValue({
            content: 'Tell me more about your chatbot requirements',
            usage: { totalTokens: 100 },
          }),
          callStructured: jest
            .fn()
            .mockImplementation(
              (prompt: string, options: unknown, context: { nodeId: string }) =>
                runner.handleLlmResponse(prompt, options, context),
            ),
        },
      },
      {
        provide: NodeExecutionService,
        useFactory: (
          intentDetector: IntentDetectorService,
          flowSecurity: FlowSecurityService,
          messageService: MessageService,
          jobEnqueuer: IJobEnqueuer,
          moduleRef: ModuleRef,
          nodeRegistry: NodeRegistry,
          promptBuilder: PromptBuilderService,
          llmClientService: LLMClientService,
        ) => {
          const appContext = {
            get: (token: unknown) => runner.resolveAppContext(moduleRef, token),
          } as NestApplicationContext;

          const service = new NodeExecutionService(
            intentDetector,
            flowSecurity,
            messageService,
            jobEnqueuer,
            appContext,
            nodeRegistry,
            promptBuilder,
            llmClientService,
          );

          runner.registerDefaultFlows(service);
          if (runner.options.registerFlows) {
            void runner.options.registerFlows(service);
          }

          return service;
        },
        inject: [
          IntentDetectorService,
          FlowSecurityService,
          MessageService,
          JOB_ENQUEUER_TOKEN,
          ModuleRef,
          NodeRegistry,
          PromptBuilderService,
          LLMClientService,
        ],
      },
      {
        provide: JOB_ENQUEUER_TOKEN,
        useClass: JobEnqueueingService,
      },
      InitiativeService,
      InitiativeArtifactService,
      InitiativeOptimizationService,
      {
        provide: InfluenceService,
        useValue: {
          createMany: jest.fn().mockResolvedValue(0),
          getInfluencesOn: jest.fn().mockResolvedValue([]),
          getInfluencesBy: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: InitiativeLifecycleService,
        useFactory: (
          conversationService: ConversationService,
          prisma: PrismaService,
          artifactService: ArtifactService,
          initiativeService: InitiativeService,
        ) =>
          new InitiativeLifecycleService(
            conversationService,
            prisma,
            artifactService,
            initiativeService,
          ),
        inject: [
          ConversationService,
          PrismaService,
          ArtifactService,
          InitiativeService,
        ],
      },
      {
        provide: FlowNodeErrorRecoveryService,
        useValue: {
          handleError: jest.fn().mockResolvedValue(undefined),
          handleErrorRecovery: jest.fn().mockResolvedValue(undefined),
          resetErrorRecoveryState: jest.fn().mockResolvedValue(undefined),
          analyzeError: jest.fn().mockResolvedValue(undefined),
          createErrorReport: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: FlowNodeProcessor,
        useFactory: (
          eventPublisher: DomainEventPublisher,
          jobEnqueuer: IJobEnqueuer,
          messageService: MessageService,
          client: Client,
          flowEngineService: NodeExecutionService,
          llmClientService: LLMClientService,
          promptBuilder: PromptBuilderService,
          intentDetector: IntentDetectorService,
          errorRecoveryService: FlowNodeErrorRecoveryService,
          flowExecutionService: FlowExecutionService,
        ) => {
          return new FlowNodeProcessor(
            eventPublisher,
            jobEnqueuer,
            messageService,
            client,
            flowEngineService,
            llmClientService,
            promptBuilder,
            intentDetector,
            errorRecoveryService,
            flowExecutionService,
            errorRecoveryService,
          );
        },
        inject: [
          DOMAIN_EVENT_PUBLISHER_TOKEN,
          JOB_ENQUEUER_TOKEN,
          MessageService,
          'TEMPORAL_CLIENT',
          NodeExecutionService,
          LLMClientService,
          PromptBuilderService,
          IntentDetectorService,
          FlowNodeErrorRecoveryService,
          FlowExecutionService,
        ],
      },
      LlmProcessor,
      MessageProcessor,
      ArtifactProcessor,
      {
        provide: MastraClientService,
        useValue: {
          executeAgentWithProgress: jest.fn().mockResolvedValue({
            executionId: 'test-execution-id',
            status: 'completed',
            result: { summary: 'Test agent execution completed' },
            iterations: 1,
          }),
        },
      },
      TaskArtifactService,
      TaskService,
      AgentProcessor,
      EntityLifecycleProcessor,
      NotificationGenerationProcessor,
      NonInteractiveFlowNodeProcessor,
      {
        provide: CoreProcessor,
        useFactory: (
          queueService: RedisQueueService,
          eventPublisher: DomainEventPublisher,
          messageProcessor: MessageProcessor,
          artifactProcessor: ArtifactProcessor,
          llmProcessor: LlmProcessor,
          agentProcessor: AgentProcessor,
          flowNodeProcessor: FlowNodeProcessor,
          summaryProcessor: EntityLifecycleProcessor,
          notificationGenerationProcessor: NotificationGenerationProcessor,
          mentionRelationService: MentionRelationService,
          nonInteractiveFlowNodeProcessor: NonInteractiveFlowNodeProcessor,
          eventRouter: EventRouter,
        ) => {
          const coreProcessor = new CoreProcessor(
            queueService,
            eventPublisher,
            messageProcessor,
            artifactProcessor,
            llmProcessor,
            agentProcessor,
            flowNodeProcessor,
            summaryProcessor,
            notificationGenerationProcessor,
            mentionRelationService,
            nonInteractiveFlowNodeProcessor,
            {
              findIdByConversationId: jest.fn().mockResolvedValue(null),
              markUnsyncedChanges: jest.fn().mockResolvedValue(undefined),
              markSynced: jest.fn().mockResolvedValue(undefined),
            } as any,
            {} as any,
            eventRouter,
          );

          const originalOnQueueJobCreated =
            coreProcessor['onQueueJobCreated'].bind(coreProcessor);
          coreProcessor['onQueueJobCreated'] = async (event) => {
            console.log('DEBUG: CoreProcessor.onQueueJobCreated', event);
            return originalOnQueueJobCreated(event);
          };

          return coreProcessor;
        },
        inject: [
          QUEUE_SERVICE_TOKEN,
          DOMAIN_EVENT_PUBLISHER_TOKEN,
          MessageProcessor,
          ArtifactProcessor,
          LlmProcessor,
          AgentProcessor,
          FlowNodeProcessor,
          EntityLifecycleProcessor,
          NotificationGenerationProcessor,
          MentionRelationService,
          NonInteractiveFlowNodeProcessor,
          EventRouter,
        ],
      },
      OutboxPublisher,
      FlowExecutionService,
      InitiativeRefinementWorkflowService,
      ArtifactDataService,
      ArtifactDataValidators,
      ArtifactGraphService,
      ArtifactService,
      TagService,
      TaskService,
      ProviderRegistryService,
      ContextResolutionService,
      MessageClassificationService,
      {
        provide: ApiKeyService,
        useValue: {
          createApiKey: jest.fn(),
          validateApiKey: jest.fn(),
          revokeApiKey: jest.fn(),
          getUserApiKeys: jest.fn(),
          createMastraApiKey: jest.fn().mockResolvedValue('mock-mastra-key'),
        },
      },
      OrganizationService,
      {
        provide: SecurityLoggerService,
        useValue: {
          logBulkInviteAttempt: jest.fn(),
          logSecurityEvent: jest.fn(),
          logInvalidEmailAttempt: jest.fn(),
          logRoleEscalationAttempt: jest.fn(),
          logBulkInviteFailure: jest.fn(),
          logBulkInviteSuccess: jest.fn(),
          logMemberInvited: jest.fn(),
          logExcessiveBatchAttempt: jest.fn(),
        },
      },
      {
        provide: UserService,
        useValue: { createInvitedUser: jest.fn() },
      },
      {
        provide: EmailService,
        useValue: { sendWelcomeEmail: jest.fn() },
      },
    ];
  }

  private resolveAppContext(moduleRef: ModuleRef, token: unknown) {
    if (token === InitiativeLifecycleService) {
      return moduleRef.get(InitiativeLifecycleService, { strict: false });
    }
    if (token === InitiativeService) {
      return moduleRef.get(InitiativeService, { strict: false });
    }
    if (token === ArtifactService) {
      return moduleRef.get(ArtifactService, { strict: false });
    }
    if (token === ConversationService) {
      return moduleRef.get(ConversationService, { strict: false });
    }
    if (token === TaskService) {
      return moduleRef.get(TaskService, { strict: false });
    }
    if (token === TaskArtifactService) {
      return moduleRef.get(TaskArtifactService, { strict: false });
    }
    if ((token as { name?: string })?.name === 'FeatureFlagService') {
      return {
        isEnabled: jest.fn().mockResolvedValue(true),
        getFlag: jest.fn().mockResolvedValue({ enabled: true }),
      };
    }
    if ((token as { name?: string })?.name === 'ContextResolutionService') {
      return {
        resolveContext: jest.fn().mockResolvedValue({
          artifacts: [],
          totalCount: 0,
          tokenEstimate: 0,
          providerName: 'mock',
          executionTimeMs: 0,
        }),
      };
    }

    const tokenName = (token as { name?: string })?.name ?? 'unknown';
    throw new Error(
      `Service ${tokenName} not found in FunctionalTestRunner app context`,
    );
  }

  private registerDefaultFlows(flowEngine: NodeExecutionService): void {
    flowEngine.registerFlow(onboardingFlow);

    flowEngine.registerFlow(initiativeRefinementFlow);
  }

  private async handleLlmResponse(
    prompt: string,
    _options: unknown,
    context: { nodeId: string },
  ): Promise<unknown> {
    const override = this.llmOverrides[context.nodeId];
    if (override !== undefined) {
      return this.resolveLlmOverride(context.nodeId, override);
    }

    return this.defaultLlmImplementation(context.nodeId);
  }

  private async resolveLlmOverride(
    nodeId: string,
    override: LlmOverrideEntry,
  ): Promise<unknown> {
    if (Array.isArray(override)) {
      const callCount = this.llmOverrideCallCounts[nodeId] ?? 0;
      const value = override[Math.min(callCount, override.length - 1)];
      this.llmOverrideCallCounts[nodeId] = callCount + 1;
      return this.resolveLlmOverride(nodeId, value as LlmOverrideEntry);
    }

    if (typeof override === 'function') {
      return override();
    }

    if (typeof override === 'string') {
      return {
        content: {
          type: 'GENERIC',
          response: override,
          detectedIntent: 'generic_processing',
          intentConfidence: 0.7,
        },
      };
    }

    return override;
  }

  private async defaultLlmImplementation(nodeId: string): Promise<unknown> {
    switch (nodeId) {
      case 'onboarding-analyze-project-concept': {
        return {
          content: {
            analysis: {
              projectType: 'chatbot',
              complexity: 'moderate',
              keyTerms: ['customer support', 'automation', 'chatbot'],
              clarificationNeeded: false,
            },
            reasoning:
              'Project concept is clear - building a customer support chatbot',
            confidenceScore: 0.9,
            detectedIntent: 'technical_project',
          },
        };
      }
      case 'shared-generate-initiatives': {
        const artifacts = await this.sqlitePrisma.db.artifact.findMany({
          select: {
            id: true,
            type: true,
            sourceType: true,
            sourceId: true,
            projectId: true,
            title: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const artifactIds = artifacts.map(
          (artifact: { id: string }) => artifact.id,
        );

        // If no artifacts found, use empty influences array
        const influences =
          artifactIds.length > 0
            ? artifactIds.slice(0, 1).map((artifactId: string) => ({
                artifactId,
                reasoning: 'Supports UI requirements',
                reasonType: 'supporting_evidence',
                confidence: 0.8,
              }))
            : [];

        return {
          content: {
            type: 'INITIATIVES',
            response:
              "I've analyzed your project and created a strategic initiative roadmap",
            detectedIntent: 'initiative_generation_complete',
            intentConfidence: 0.95,
            reasoning: 'Generated initiatives based on chatbot requirements',
            initiatives: [
              {
                name: 'Frontend Development',
                description: 'Build the user interface for the chatbot',
                details:
                  'Create responsive components for the chatbot interface.',
                acceptanceCriteria:
                  'Responsive design with cross-browser compatibility',
                estimatedEffort: 'medium' as const,
                priority: 'high' as const,
                tags: ['frontend', 'ui'],
                reasoning:
                  'Essential user-facing component for chatbot interaction',
                influences,
              },
            ],
          },
          usage: {
            promptTokens: 200,
            completionTokens: 100,
            totalTokens: 300,
          },
          costData: {
            model: 'claude-4-haiku-20250108',
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            inputCost: 0.2,
            outputCost: 0.4,
            totalCost: 0.6,
          },
        };
      }
      case 'shared-generate-plans': {
        return {
          content: {
            type: 'INITIATIVES',
            response:
              "I've created concise initial plans to get started quickly.",
            detectedIntent: 'plan_generation_complete',
            intentConfidence: 0.95,
            plans: [
              {
                title: 'Initial Delivery Plan',
                description:
                  'Define and deliver the first end-to-end slice for onboarding.',
                outcome:
                  'A validated first slice is live and ready for feedback.',
                evidenceWeight: 0.87,
                rationale:
                  'High-confidence alignment with onboarding conversation priorities.',
              },
            ],
          },
          usage: {
            promptTokens: 160,
            completionTokens: 70,
            totalTokens: 230,
          },
        };
      }
      case 'shared-generate-artifacts': {
        return {
          content: {
            type: 'ARTIFACTS_GENERATION',
            response:
              "I've analyzed the conversation history and extracted key insights across multiple categories.",
            title:
              'Project Analysis: AI-Powered Organizational Intelligence Platform',
            detectedIntent: 'project_analysis_complete',
            intentConfidence: 0.92,
            reasoning:
              'Clear project concept with specific technical requirements and integration needs',
            insights: [
              {
                category: 'userGoals',
                title: 'Primary Project Vision',
                summary:
                  'Implement an AI-powered chatbot to assist customer support teams',
              },
            ],
          },
          usage: {
            promptTokens: 180,
            completionTokens: 90,
            totalTokens: 270,
          },
        };
      }
      default:
        return {
          content: {
            type: 'QUESTIONS',
            response: 'Tell me more about your project requirements.',
            detectedIntent: 'needs_more_information',
            intentConfidence: 0.7,
            uiElements: [
              {
                id: 'q1',
                type: 'textarea',
                label: 'What are your main goals?',
              },
              {
                id: 'q2',
                type: 'textarea',
                label: 'Who are your target users?',
              },
            ],
          },
          usage: {
            promptTokens: 50,
            completionTokens: 25,
            totalTokens: 75,
          },
        };
    }
  }

  private async initializeModule(
    module: TestingModule,
  ): Promise<ModuleContext> {
    module.useLogger(module.get(CustomLoggerService));
    (global as unknown as { nestModuleRef: any }).nestModuleRef = module;

    const projectService = module.get(ProjectService);
    const artifactService = module.get(ArtifactService);
    const messageService = module.get(MessageService);
    const flowNodeProcessor = module.get(FlowNodeProcessor);
    const coreProcessor = module.get(CoreProcessor);
    const outboxPublisher = module.get(OutboxPublisher);
    const nodeRegistry = module.get(NodeRegistry);

    // Get services needed for node instantiation
    const featureFlagService = module.get(FeatureFlagService);
    const contextResolutionService = module.get(ContextResolutionService);
    const initiativeService = module.get(InitiativeService);
    const initiativeOptimizationService = module.get(
      InitiativeOptimizationService,
    );
    const conversationService = module.get(ConversationService);
    const pendingEdgeService = module.get(PendingEdgeService);

    // ============================================
    // ONBOARDING NODES
    // ============================================
    const onboardingWelcomeNode = new OnboardingWelcomeNode(
      featureFlagService,
      contextResolutionService,
    );
    const onboardingClarifyConceptNode = new OnboardingClarifyConceptNode();
    const onboardingAnalyzeProjectConceptNode =
      new OnboardingAnalyzeProjectConceptNode();
    const onboardingFinalizeNode = new OnboardingFinalizeNode(
      new OnboardingNextStepsService(
        module.get(PrismaService),
        artifactService,
        module.get(LLMClientService),
        projectService,
      ),
    );
    const onboardingRecoveryNode = new OnboardingRecoveryNode(
      featureFlagService,
      contextResolutionService,
    );
    const onboardingEndNode = new OnboardingEndNode();
    const onboardingGenerateInitiativesNode =
      new OnboardingGenerateInitiativesNode(
        initiativeService,
        conversationService,
      );
    const onboardingSelectOutcomeNode = new OnboardingSelectOutcomeNode();
    const onboardingGeneratePlansNode = new OnboardingGeneratePlansNode();
    const onboardingCreatePlansNode = new OnboardingCreatePlansNode(
      module.get(TaskService),
      pendingEdgeService,
    );

    nodeRegistry.register(onboardingWelcomeNode);
    nodeRegistry.register(onboardingClarifyConceptNode);
    nodeRegistry.register(onboardingAnalyzeProjectConceptNode);
    nodeRegistry.register(onboardingFinalizeNode);
    nodeRegistry.register(onboardingRecoveryNode);
    nodeRegistry.register(onboardingEndNode);
    nodeRegistry.register(onboardingSelectOutcomeNode);
    nodeRegistry.register(onboardingGeneratePlansNode as INode<FlowContext>);
    nodeRegistry.register(onboardingCreatePlansNode as INode<FlowContext>);
    nodeRegistry.register(
      onboardingGenerateInitiativesNode as INode<FlowContext>,
    );

    // ============================================
    // SHARED NODES
    // ============================================
    const sharedSetupIntegrationsNode = new SharedSetupIntegrationsNode();
    const sharedBusinessDiscoveryNode = new SharedBusinessDiscoveryNode();
    const sharedTechnicalDiscoveryNode = new SharedTechnicalDiscoveryNode();
    const sharedTechnicalDiscoveryMatureNode =
      new SharedTechnicalDiscoveryMatureNode();
    const sharedIntegrationDiscoveryNode = new SharedIntegrationDiscoveryNode();
    const sharedAssessImplementationNode = new SharedAssessImplementationNode();
    const sharedAddressConcernsNode = new SharedAddressConcernsNode();
    const sharedAnalyzeProjectNode = new SharedAnalyzeProjectNode();
    const sharedProjectMembersNode = new SharedProjectMembersNode();
    const sharedPoliteRedirectNode = new SharedPoliteRedirectNode();
    const sharedGenerateArtifactsNode = new SharedGenerateArtifactsNode();

    nodeRegistry.register(sharedSetupIntegrationsNode);
    nodeRegistry.register(sharedBusinessDiscoveryNode);
    nodeRegistry.register(sharedTechnicalDiscoveryNode);
    nodeRegistry.register(sharedTechnicalDiscoveryMatureNode);
    nodeRegistry.register(sharedIntegrationDiscoveryNode);
    nodeRegistry.register(sharedAssessImplementationNode);
    nodeRegistry.register(sharedAddressConcernsNode);
    nodeRegistry.register(sharedAnalyzeProjectNode);
    nodeRegistry.register(sharedProjectMembersNode);
    nodeRegistry.register(sharedPoliteRedirectNode);
    nodeRegistry.register(sharedGenerateArtifactsNode);

    // ============================================
    // INITIATIVE REFINEMENT NODES
    // ============================================
    const initiativeRefinementWelcomeNode = new InitiativeRefinementWelcomeNode(
      initiativeService,
    );
    const initiativeRefinementPromptNextInputNode =
      new InitiativeRefinementPromptNextInputNode(initiativeService);
    const initiativeRefinementFinalizeNode =
      new InitiativeRefinementFinalizeNode();
    const initiativeRefinementEndNode = new InitiativeRefinementEndNode(
      initiativeService,
    );
    const initiativeRefinementRecoveryNode =
      new InitiativeRefinementRecoveryNode(initiativeService);
    const initiativeRefinementAgentAnalysisNode =
      new InitiativeRefinementAgentEditorNode(
        initiativeService,
        artifactService,
      );

    nodeRegistry.register(initiativeRefinementWelcomeNode);
    nodeRegistry.register(initiativeRefinementPromptNextInputNode);
    nodeRegistry.register(initiativeRefinementFinalizeNode);
    nodeRegistry.register(initiativeRefinementEndNode);
    nodeRegistry.register(initiativeRefinementRecoveryNode);
    nodeRegistry.register(initiativeRefinementAgentAnalysisNode);

    flowNodeProcessor.onModuleInit();
    await coreProcessor.onModuleInit();
    outboxPublisher.onModuleInit();

    this.projectService = projectService;
    this.artifactService = artifactService;
    this.messageService = messageService;
    this.flowNodeProcessor = flowNodeProcessor;
    this.coreProcessor = coreProcessor;
    this.outboxPublisher = outboxPublisher;

    return {
      module,
      logger: module.get(CustomLoggerService),
      projectService,
      artifactService,
      messageService,
      flowNodeProcessor,
      coreProcessor,
      outboxPublisher,
      conversationService,
    };
  }

  private async startWorker(): Promise<void> {
    if (!this.worker) {
      throw new Error('Temporal worker not created');
    }

    void this.worker.run();
    await this.waitForWorkerRunning(this.worker);
  }

  private async waitForWorkerRunning(worker: Worker): Promise<void> {
    const startTime = Date.now();
    const timeoutMs = 30000;

    await new Promise<void>((resolve, reject) => {
      const check = () => {
        const state = worker.getState();
        if (state === 'RUNNING') {
          resolve();
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          reject(
            new Error('Worker failed to reach RUNNING state within timeout'),
          );
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  private async cleanupAfterEach(): Promise<void> {
    // Stop OutboxPublisher first to prevent new events
    if (this.module) {
      try {
        const outboxPublisher = this.module.get(OutboxPublisher);
        outboxPublisher.stopPublisher();
      } catch (error) {
        console.warn('Failed to stop OutboxPublisher', error);
      }
    }

    // Shutdown worker before tearing down testEnv
    if (this.worker) {
      try {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await this.worker.shutdown();
        // Clear worker reference immediately after shutdown
        this.worker = undefined;
        // Give the worker time to fully release connection
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.warn('Failed to shutdown Temporal worker', error);
        this.worker = undefined;
      }
    }

    // Now teardown testEnv after worker is fully cleared
    if (this.testEnv) {
      try {
        await this.testEnv.teardown();
        this.testEnv = undefined;
      } catch (error) {
        console.warn('Failed to teardown Temporal environment', error);
        this.testEnv = undefined;
      }
    }

    // Close NestJS module
    if (this.module) {
      try {
        await this.module.close();
        this.module = undefined;
      } catch (error) {
        console.warn('Failed to close testing module', error);
        this.module = undefined;
      }
    }

    // Cleanup Redis
    if (this.redis) {
      try {
        if (typeof this.redis.disconnect === 'function') {
          this.redis.disconnect();
        } else if (typeof (this.redis as any).quit === 'function') {
          await (this.redis as any).quit();
        }
        this.redis = undefined;
      } catch (error) {
        console.warn('Failed to disconnect Redis client', error);
        this.redis = undefined;
      }
    }

    // Clear service references
    this.projectService = undefined;
    this.artifactService = undefined;
    this.messageService = undefined;
    this.flowNodeProcessor = undefined;
    this.coreProcessor = undefined;
    this.outboxPublisher = undefined;

    // Clear all Jest mocks
    jest.clearAllMocks();
  }
}
