import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */

// Now that Jest moduleNameMapper has been cleaned up, we can import ioredis directly

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { execSync } from 'child_process';
import * as fs from 'fs';
import Redis from 'ioredis';
import * as path from 'path';
import { RedisMemoryServer } from 'redis-memory-server';
import { v4 as uuidv4 } from 'uuid';
import { CustomLoggerService } from '../../common/logger/logger.service';
import { ProviderRegistryService } from '../../context/registry/provider-registry.service';
import { ContextResolutionService } from '../../context/services/context-resolution.service';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { EventRouter } from '../../core/events/event-router';
import { InMemoryMessageBus } from '../../core/events/in-memory-message-bus.service';
import { OutboxPublisher } from '../../core/events/outbox-publisher.service';
import {
  DOMAIN_EVENT_PUBLISHER_TOKEN,
  MESSAGE_BUS_TOKEN,
  OUTBOX_STORE_TOKEN,
} from '../../core/events/tokens';
import { AgentProcessor } from '../../core/processing/agent-processor.service';
import { ArtifactProcessor } from '../../core/processing/artifact-processor.service';
import { CoreProcessor } from '../../core/processing/core-processor.service';
import { FlowNodeProcessor } from '../../core/processing/flow-node-processor.service';
import { NotificationGenerationProcessor } from '../../core/processing/notification-generation-processor.service';
import { FlowNodeErrorRecoveryService } from '../../services/workflows/flow-node-error-recovery.service';
import { LlmProcessor } from '../../core/processing/llm-processor.service';
import { MessageProcessor } from '../../core/processing/message-processor.service';
import { QUEUE_SERVICE_TOKEN } from '../../core/queue/queue.module';
import { RedisQueueService } from '../../core/queue/redis-queue.service';
import { RedisService } from '../../core/redis/redis.service';
import { ONBOARDING_NODES, SHARED_NODES } from '../../flows/constants/node-ids';
import { MessageStatus } from '../../constants/message-status.constants';
import {
  ConversationStatus,
  CreateProjectDto,
  InitiationType,
  MessageType,
  ProjectStatus,
  SystemMessageResponseType,
  UIElement,
  WorkflowName,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { MastraClientService } from '../../services/agents/mastra-client.service';
import { ArtifactDataService } from '../../services/artifacts/artifact-data.service';
import { ArtifactDataValidators } from '../../services/artifacts/artifact-data.validators';
import { ArtifactGraphService } from '../../services/artifacts/artifact-graph.service';
import { ArtifactService } from '../../services/artifacts/artifact.service';
import { ConversationService } from '../../services/conversation.service';
import { EntityRegistryService } from '../../services/entity-registry/entity-registry.service';
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { InitiativeArtifactService } from '../../services/initiatives/initiative-artifact.service';
import { IntentDetectorService } from '../../services/intent-detector.service';
import { IJobEnqueuer } from '../../services/interfaces/job-enqueuer.interface';
import { JobEnqueueingService } from '../../services/job-enqueuing.service';
import { JOB_ENQUEUER_TOKEN } from '../../services/job.tokens';
import { LLMClientService } from '../../services/llm/llm-client.service';
import { PromptBuilderService } from '../../services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from '../../services/llm/strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from '../../services/llm/strategies/initiative-refinement-prompt-builder.strategy';
import { PlaceholderResolver } from '../../services/llm/placeholders/resolver.service';
import { MessageClassificationService } from '../../services/message-classification/message-classification.service';
import { MessageService } from '../../services/message.service';
import { MentionRelationService } from '../../services/mentions/mention-relation.service';
import { OrganizationService } from '../../services/organization.service';
import { ApiKeyService } from '../../services/api-key.service';
import { OutboxStore } from '../../services/outbox-store.service';
import { ProjectService } from '../../services/project.service';
import { SecurityLoggerService } from '../../services/security-logger.service';
import { UserService } from '../../services/user.service';
import { EmailService } from '../../services/email.service';
import { TagService } from '../../services/tag.service';
import { NodeExecutionService } from '../../services/workflows/node-execution.service';
import { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import { FlowSecurityService } from '../../services/workflows/flow-security.service';
import { InitiativeRefinementWorkflowService } from '../../services/workflows/initiative-refinement-workflow.service';
import {
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../types';
import { EntityLifecycleProcessor } from '../../core/processing/entity-lifecycle-processor.service';
import { NonInteractiveFlowNodeProcessor } from '../../core/processing/non-interactive-flow-node-processor.service';
import { NodeRegistry } from '../../flows/nodes/node-registry.service';
import { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import * as TestUtils from '../../utils/testUtils';
import * as activities from '../activities';
import { SqlitePrismaWrapper } from './sqlite-prisma-wrapper';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import { taskGenerationFlow } from 'src/flows/templates/task-generation.flow';

const requireNonNull = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`Expected ${label} to be non-null`);
  }
  return value;
};

/**
 * CRITICAL: attention Claude, the whole point of this test is to test all components working together
 * so we don't want to mock services!
 */

const describeTaskFunctional =
  process.env.RUN_TASK_FUNCTIONAL_TESTS === '1' ? describe : describe.skip;

describeTaskFunctional(
  'Conversation Flow Functional Tests with Real Event Processing',
  () => {
    // Set debug logging for this test
    beforeAll(() => {
      process.env.LOG_LEVEL = 'debug';
      console.log('✅ LOG_LEVEL set to debug for test suite');
    });

    afterAll(() => {
      delete process.env.LOG_LEVEL;
    });
    let module: TestingModule;
    let sqlitePrisma: SqlitePrismaWrapper;
    let projectService: ProjectService;
    let messageService: MessageService;
    let flowNodeProcessor: FlowNodeProcessor;
    let redis: Redis;
    let redisServer: RedisMemoryServer;
    let testEnv: TestWorkflowEnvironment;
    let worker: Worker;
    let conversationService: ConversationService;
    let _client: Client;

    const testDbPath = path.join(process.cwd(), 'prisma', 'test.db');
    let testOrganizationId: OrganizationId;
    const testUserId = 'user-func-123' as UserId;

    // Mock services
    const mockConversationValidation = {
      validateConversationBelongsToProject: jest.fn(),
      validateProjectIdConsistency: jest.fn(),
    };

    const mockTagService = {
      createTag: jest.fn(),
      findOrCreateTag: jest.fn(),
      getTagsByOrganization: jest.fn(),
      assignToArtifact: jest.fn(),
      removeFromArtifact: jest.fn(),
      assignToInitiative: jest.fn(),
      removeFromInitiative: jest.fn(),
      getArtifactTags: jest.fn(),
      getInitiativeTags: jest.fn(),
      addTagsToArtifact: jest.fn(),
      addTagsToInitiative: jest.fn(),
      syncArtifactTags: jest.fn(),
      syncInitiativeTags: jest.fn(),
    };

    // We'll set up the real Temporal test environment in beforeEach

    // Remove testProjectId since we'll create projects dynamically

    beforeAll(async () => {
      // Clean up any existing test database
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      if (fs.existsSync(testDbPath + '-journal')) {
        fs.unlinkSync(testDbPath + '-journal');
      }

      // Generate Prisma Client for SQLite test schema
      try {
        execSync('npx prisma generate --schema=prisma/test.prisma', {
          cwd: process.cwd(),
          stdio: 'inherit',
        });

        // Push the schema to create tables
        execSync(
          'npx prisma db push --schema=prisma/test.prisma --skip-generate',
          {
            cwd: process.cwd(),
            stdio: 'inherit',
          },
        );
      } catch (error) {
        console.error(
          'Failed to generate Prisma client or push schema:',
          error,
        );
        throw error;
      }

      // Import the generated test client
      const { PrismaClient: TestPrismaClient } = await import(
        path.join(process.cwd(), 'node_modules/.prisma/client-test/index.js')
      );

      // Create SQLite Prisma Client instance with wrapper
      const rawClient = new TestPrismaClient();
      sqlitePrisma = new SqlitePrismaWrapper(rawClient);

      // Connect to the database
      await sqlitePrisma.$connect();

      // Create test user first (required for organization creation)
      await sqlitePrisma.db.user.upsert({
        where: { id: testUserId },
        create: {
          id: testUserId,
          email: 'func-test@example.com',
          name: 'Functional Test User',
        },
        update: {
          email: 'func-test@example.com',
          name: 'Functional Test User',
        },
      });

      // Create organization using OrganizationService (this will automatically create system user)
      const mockSecurityLogger = {
        logBulkInviteAttempt: jest.fn(),
        logSecurityEvent: jest.fn(),
        logInvalidEmailAttempt: jest.fn(),
        logRoleEscalationAttempt: jest.fn(),
        logBulkInviteFailure: jest.fn(),
        logBulkInviteSuccess: jest.fn(),
        logMemberInvited: jest.fn(),
        logExcessiveBatchAttempt: jest.fn(),
      };

      const mockApiKeyService = {
        createApiKey: jest.fn(),
        validateApiKey: jest.fn(),
        revokeApiKey: jest.fn(),
        getUserApiKeys: jest.fn(),
        createMastraApiKey: jest.fn().mockResolvedValue('mock-mastra-key'),
      };

      const organizationService = new OrganizationService(
        { membershipRemoved: jest.fn() } as never,
        {} as never,
        sqlitePrisma as unknown as PrismaService,
        mockSecurityLogger as unknown as SecurityLoggerService,
        mockApiKeyService as any,
        { addProjectMember: jest.fn() } as any,
        { createInvitedUser: jest.fn() } as any,
        { sendWelcomeEmail: jest.fn() } as any,
        {} as any,
      );

      // Check if organization already exists
      let testOrg;
      try {
        const existingOrgs = await sqlitePrisma.db.organization.findMany({
          where: { slug: 'test-func-org' },
        });
        if (existingOrgs.length > 0) {
          testOrg = existingOrgs[0];
        } else {
          testOrg = await organizationService.createOrganization(
            {
              name: 'Test Functional Organization',
              slug: 'test-func-org',
              description: 'Test organization for functional tests',
            },
            testUserId,
          );
        }
      } catch (error) {
        // If creation fails, try to find existing organization
        const existingOrgs = await sqlitePrisma.db.organization.findMany({
          where: { slug: 'test-func-org' },
        });
        if (existingOrgs.length > 0) {
          testOrg = existingOrgs[0];
        } else {
          throw error;
        }
      }
      testOrganizationId = testOrg.id;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockLlmImplementation: (a: any, b: any, c: any) => Promise<any>;

    beforeEach(async () => {
      console.log('🔧 beforeEach: Starting test setup');

      // Configure Temporal Runtime for debug logging - must be first!
      try {
        // Create a custom logger that filters out peer: Client messages
        const filteredLogger = new DefaultLogger('DEBUG');
        const originalLog = filteredLogger.log.bind(filteredLogger);
        filteredLogger.log = (level, message, meta) => {
          // Filter out temporal internal logs with peer: Client and sdkComponent: core
          if (
            typeof meta === 'object' &&
            meta !== null &&
            'peer' in meta &&
            meta.peer === 'Client'
          ) {
            return;
          }
          if (
            typeof meta === 'object' &&
            meta !== null &&
            'sdkComponent' in meta &&
            meta.sdkComponent === 'core'
          ) {
            return;
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
        console.log('🔧 beforeEach: Temporal Runtime configured');
      } catch (error) {
        console.log(
          '🔧 beforeEach: Temporal Runtime already configured, skipping',
        );
      }
      // Clear test data (except base data)

      console.log('🔧 beforeEach: Clearing test data');

      // Delete in dependency order - child records first, then parent records
      await sqlitePrisma.db.message.deleteMany({});
      await sqlitePrisma.db.conversation.deleteMany({});

      // Delete project-related child records before deleting projects
      await sqlitePrisma.db.flowExecution.deleteMany({});
      await sqlitePrisma.db.integration.deleteMany({});
      await sqlitePrisma.db.projectInitiative.deleteMany({});
      await sqlitePrisma.db.artifact.deleteMany({});

      // Clear outbox events to prevent constraint violations
      await sqlitePrisma.db.outboxEvent.deleteMany({});

      // ProjectTask has onDelete: Cascade, so will be cleaned up automatically
      // Now safe to delete projects
      await sqlitePrisma.db.project.deleteMany({});

      console.log('🔧 beforeEach: Test data cleared');

      // Set up real Redis using redis-memory-server
      console.log('🔧 beforeEach: Setting up Redis server');
      redisServer = new RedisMemoryServer();
      const host = await redisServer.getHost();
      const port = await redisServer.getPort();

      // Configure environment variables for RedisService
      process.env.REDIS_HOST = host;
      process.env.REDIS_PORT = port.toString();

      redis = new Redis({
        host,
        port,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });
      console.log('🔧 beforeEach: Redis server setup complete');

      // Test that our Redis client works and has the keys method
      console.log('DEBUG: Testing Redis client...');
      console.log('DEBUG: Redis client type:', typeof redis);
      console.log('DEBUG: Redis client constructor:', redis.constructor.name);
      console.log(
        'DEBUG: Redis client has keys method:',
        typeof redis.keys === 'function',
      );
      console.log(
        'DEBUG: Redis available methods:',
        Object.getOwnPropertyNames(redis)
          .filter(
            (name) =>
              typeof (redis as unknown as { [key: string]: unknown })[name] ===
              'function',
          )
          .slice(0, 10),
      );
      console.log('DEBUG: Redis host/port:', host, port);

      // Wait for Redis to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        const testKeys = await redis.keys('*');
        console.log(
          'DEBUG: Redis keys() call successful, found keys:',
          testKeys.length,
        );
      } catch (error) {
        console.log('DEBUG: Redis keys() call failed:', error);
      }

      // Set up real Temporal test environment
      console.log('🔧 beforeEach: Setting up Temporal test environment');
      testEnv = await TestWorkflowEnvironment.createTimeSkipping();
      console.log('🔧 beforeEach: Temporal test environment setup complete');

      // Start the worker with real activities
      console.log('🔧 beforeEach: Creating Temporal worker');

      worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'conversation-queue',
        workflowsPath: require.resolve('../../workflows/workers'),
        activities,
        debugMode: true,
        bundlerOptions: {
          ignoreModules: ['stream'],
          webpackConfigHook: (config) => {
            config.module = config.module || {};
            config.module.exprContextCritical = false;
            return config;
          },
        },
      });
      console.log('🔧 beforeEach: Temporal worker created');

      mockLlmImplementation = async (
        prompt: any,
        _options: any,
        _source: any,
      ) => {
        console.log(
          'MockLLM callStructured called with prompt:',
          prompt.substring(0, 100) + '...',
          _source,
        );

        // Check if this is an initiative generation request
        if (
          prompt.includes(
            'You are a senior product manager helping to break down a project into actionable initiatives',
          )
        ) {
          // Return a mock initiative generation response as a JSON string
          const mockInitiativeResponse = {
            initiatives: [
              {
                name: 'Frontend Development',
                description: 'Build the user interface for the chatbot',
                details:
                  'Create responsive React components for the chatbot interface. Assumes users prefer web-based interface and will interact through modern browsers.',
                acceptanceCriteria:
                  'Responsive design and cross-browser compatibility with Chrome, Firefox, Safari, and Edge',
                priority: 'high',
                estimatedEffort: 'medium',
                tags: ['frontend', 'ui'],
                reasoning:
                  'Essential user-facing component for chatbot interaction',
              },
              {
                name: 'Backend API Development',
                description:
                  'Develop the API endpoints for chatbot functionality',
                details:
                  'Build RESTful API with authentication and chat endpoints using Node.js and Express framework. Assumes REST API is suitable for chat functionality.',
                acceptanceCriteria:
                  'RESTful API design with proper authentication, rate limiting, and real-time chat capabilities',
                priority: 'high',
                estimatedEffort: 'large',
                tags: ['backend', 'api'],
                reasoning:
                  'Core backend infrastructure required for chatbot operations',
              },
            ],
            reasoning: 'Generated initiatives based on chatbot requirements',
            confidenceScore: 0.85,
            suggestedNextSteps: [
              'Review and prioritize initiatives',
              'Assign team members',
            ],
          };

          return {
            content: mockInitiativeResponse,
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
        // Check if this is a generate artifacts request
        else if (
          prompt.includes(
            'You are a principal product manager analyzing a project onboarding conversation to extract structured insights',
          ) ||
          prompt.includes(
            'analyze the entire conversation and extract insights',
          )
        ) {
          // Return the generate artifacts mock response from onboardingMocks
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
                'Clear project concept with specific technical requirements, use cases, and integration needs identified through multiple conversation exchanges',
              insights: [
                {
                  category: 'userGoals',
                  title: 'Primary Project Vision',
                  confidence: 0.95,
                  reasoning:
                    'User explicitly described building a customer support chatbot',
                  content:
                    'Create an AI-powered customer support chatbot that handles common inquiries and reduces support agent workload.',
                  tags: ['vision', 'chatbot', 'support'],
                  influences: [] as string[],
                },
                {
                  category: 'technicalAnalysis',
                  title: 'Integration Requirements',
                  confidence: 0.88,
                  reasoning:
                    'User mentioned specific integration needs with GitHub and Jira',
                  content:
                    'Requires integration with GitHub for code management and Jira for issue tracking to provide comprehensive project context.',
                  tags: ['integration', 'github', 'jira'],
                  influences: [],
                },
              ],
              uiElements: [] as UIElement[],
              influences: [] as string[],
            },
            usage: {
              promptTokens: 150,
              completionTokens: 80,
              totalTokens: 230,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 150,
              outputTokens: 80,
              totalTokens: 230,
              inputCost: 0.15,
              outputCost: 0.32,
              totalCost: 0.47,
            },
          };
        }
        // Check if this is a generate node request
        else if (
          prompt.includes('generate initiatives') ||
          prompt.includes('Based on the gathered requirements')
        ) {
          // For generate nodes, we want the action to execute instead of LLM
          // Return a response that triggers the node's action
          return {
            content: {
              type: 'GENERIC',
              response: 'Generating initiatives...',
              detectedIntent: 'initiatives_generated',
              intentConfidence: 0.95,
              reasoning: 'Generating project initiatives',
              uiElements: [],
            },
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              inputCost: 0.1,
              outputCost: 0.2,
              totalCost: 0.3,
            },
          };
        }
        // Check if this is a routing decision prompt (Phase 2 intelligent routing)
        if (
          prompt.includes(
            'determine the most appropriate next step in the onboarding flow',
          )
        ) {
          console.log('MockLLM: Handling routing decision prompt');
          return {
            content: {
              nextNodeId: 'setup_integrations',
              reasoning:
                'User wants to build a customer support chatbot, which is a greenfield project suitable for setup integrations',
              confidence: 0.9,
            },
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              inputCost: 0.1,
              outputCost: 0.2,
              totalCost: 0.3,
            },
          };
        }

        // Default response for gather nodes (ANALYZE_PROJECT_CONCEPT)
        return {
          content: {
            type: 'QUESTIONS',
            response:
              'I understand you want to build a customer support chatbot. Let me ask a few questions to better understand your requirements.',
            detectedIntent: 'gather_requirements',
            intentConfidence: 0.9,
            reasoning: 'User wants to build a chatbot',
            uiElements: [
              {
                type: 'text_input',
                id: 'requirements_input',
                label: 'Additional Requirements',
                placeholder: 'Any other requirements...',
                required: false,
              },
            ],
          },
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          costData: {
            model: 'claude-4-haiku-20250108',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            inputCost: 0.1,
            outputCost: 0.2,
            totalCost: 0.3,
          },
        };
      };

      // Create test module with real services
      console.log('🔧 beforeEach: Creating NestJS test module');
      module = await Test.createTestingModule({
        providers: [
          {
            provide: ProjectAccessService,
            useValue: {
              assertProject: jest.fn(),
              projectWhere: ProjectAccessService.prototype.projectWhere,
            },
          },
          {
            provide: ProjectMembershipRevocationService,
            useValue: { membershipRemoved: jest.fn() },
          },
          {
            provide: WorkflowTypeRegistryService,
            useValue: TestUtils.createMockWorkflowTypeRegistryService(),
          },
          {
            provide: NodeRegistry,
            useValue: {
              get: jest.fn(),
              has: jest.fn(),
              register: jest.fn(),
            },
          },
          {
            provide: EntityLifecycleProcessor,
            useValue: {
              handleCodingPromptCreated: jest.fn(),
              handleMessageCreated: jest.fn(),
              handleMessageDeleted: jest.fn(),
              handleConversationCreated: jest.fn(),
              handleConversationUpdated: jest.fn(),
              handleConversationDeleted: jest.fn(),
              handleTaskCreated: jest.fn(),
              handleTaskUpdated: jest.fn(),
              handleTaskArchived: jest.fn(),
              handleTaskStatusChanged: jest.fn(),
              handleInitiativeCreated: jest.fn(),
              handleInitiativeUpdated: jest.fn(),
              handleInitiativeStatusChanged: jest.fn(),
              handleInitiativeArchived: jest.fn(),
              handleDesignDocCreated: jest.fn(),
              handleDesignDocUpdated: jest.fn(),
              handleDesignDocArchived: jest.fn(),
              handleDesignDocRestored: jest.fn(),
            },
          },
          {
            provide: NonInteractiveFlowNodeProcessor,
            useValue: {
              processNonInteractiveFlowNode: jest.fn(),
            },
          },
          CustomLoggerService,
          {
            provide: PrismaService,
            useValue: sqlitePrisma,
          },
          {
            provide: MESSAGE_BUS_TOKEN,
            useClass: InMemoryMessageBus,
          },
          {
            provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
            useFactory: (outboxStore) => {
              const publisher = new DomainEventPublisher(outboxStore);
              // Override publish method to add debug logging
              const originalPublish = publisher.publish.bind(publisher);
              publisher.publish = async (event) => {
                console.log(
                  'DEBUG: DomainEventPublisher.publish called with event:',
                  event,
                );
                return originalPublish(event);
              };
              return publisher;
            },
            inject: [OUTBOX_STORE_TOKEN],
          },
          EventRouter,
          {
            provide: OUTBOX_STORE_TOKEN,
            useClass: OutboxStore,
          },
          {
            provide: QUEUE_SERVICE_TOKEN,
            useClass: RedisQueueService,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key: string) => {
                // Mock config values that RedisQueueService needs
                switch (key) {
                  case 'REDIS_HOST':
                    return host;
                  case 'REDIS_PORT':
                    return port;
                  case 'REDIS_PASSWORD':
                    return undefined;
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
            useFactory: () => {
              // Create a mock RedisService that uses our test Redis instance directly
              const mockRedisService = {
                getClient: () => redis,
              };
              return mockRedisService;
            },
          },
          {
            provide: 'TEMPORAL_CLIENT',
            useValue: testEnv.client,
          },

          // Business services
          ProjectService,
          EntityRegistryService,
          MessageService,
          {
            provide: ConversationService,
            useFactory: (
              prisma: PrismaService,
              publisher: DomainEventPublisher,
              temporalClient: any,
              messageService: MessageService,
              projectService: ProjectService,
              artifactService: ArtifactService,
              workflowTypeRegistryService: WorkflowTypeRegistryService,
            ) =>
              new ConversationService(
                prisma,
                mockConversationValidation,
                publisher,
                temporalClient,
                messageService,
                projectService,
                artifactService,
                workflowTypeRegistryService,
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
            useFactory: () => ({
              get: (serviceToken: unknown) => {
                if (serviceToken === InitiativeLifecycleService) {
                  return module.get(InitiativeLifecycleService);
                }
                if (serviceToken === InitiativeService) {
                  return module.get(InitiativeService);
                }
                if (serviceToken === ArtifactService) {
                  return module.get(ArtifactService);
                }
                if ((serviceToken as any)?.name === 'FeatureFlagService') {
                  return {
                    isEnabled: jest.fn().mockResolvedValue(true),
                    getFlag: jest.fn().mockResolvedValue({ enabled: true }),
                  };
                }
                if (
                  (serviceToken as any)?.name === 'ContextResolutionService'
                ) {
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
                const tokenName =
                  (serviceToken as { name?: string }).name || 'unknown';
                throw new Error(
                  `Service ${tokenName} not found in mock app context`,
                );
              },
            }),
          },
          PromptBuilderService,
          StandardPromptBuilderStrategy,
          InitiativeRefinementPromptBuilderStrategy,
          PlaceholderResolver,
          IntentDetectorService,
          {
            provide: FlowSecurityService,
            useValue: {
              checkFlowAccess: jest.fn().mockResolvedValue(true),
              validateFlowExecution: jest.fn().mockResolvedValue(true),
              validateProjectAccess: jest.fn().mockResolvedValue(undefined),
              validateUserOrganization: jest.fn().mockResolvedValue(undefined),
              sanitizePrompt: jest.fn().mockImplementation((prompt) => prompt),
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
                .mockImplementation(mockLlmImplementation),
              // Remove callLLM since it's now handled by the call method above
            },
          },
          {
            provide: NodeExecutionService,
            useFactory: (
              intentDetector: IntentDetectorService,
              flowSecurity: FlowSecurityService,
              messageService: MessageService,
              jobEnqueuer: IJobEnqueuer,
              nodeRegistry: NodeRegistry,
              promptBuilder: PromptBuilderService,
              llmClientService: LLMClientService,
            ) => {
              const service = new NodeExecutionService(
                intentDetector,
                flowSecurity,
                messageService,
                jobEnqueuer,
                {
                  get: (serviceToken: unknown) => {
                    if (serviceToken === InitiativeLifecycleService) {
                      return module.get(InitiativeLifecycleService);
                    }
                    if (serviceToken === InitiativeService) {
                      return module.get(InitiativeService);
                    }
                    if (serviceToken === ArtifactService) {
                      return module.get(ArtifactService);
                    }
                    if ((serviceToken as any)?.name === 'FeatureFlagService') {
                      // Mock FeatureFlagService
                      return {
                        isEnabled: jest.fn().mockResolvedValue(true),
                        getFlag: jest.fn().mockResolvedValue({ enabled: true }),
                      };
                    }
                    if (
                      (serviceToken as any)?.name === 'ContextResolutionService'
                    ) {
                      // Mock ContextResolutionService
                      return {
                        resolveContext: jest.fn().mockResolvedValue({
                          artifacts: [],
                          totalCount: 0,
                          tokenEstimate: 0,
                        }),
                      };
                    }
                    // Add other services as needed
                    const tokenName =
                      (serviceToken as { name?: string }).name || 'unknown';
                    throw new Error(
                      `Service ${tokenName} not found in mock app context`,
                    );
                  },
                } as unknown as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                nodeRegistry,
                promptBuilder,
                llmClientService,
              );

              service.registerFlow(taskGenerationFlow);

              return service;
            },
            inject: [
              IntentDetectorService,
              FlowSecurityService,
              MessageService,
              JOB_ENQUEUER_TOKEN,
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
              jobEnqueuer: any,
              messageService: MessageService,
              temporalClient: any,
              flowEngineService: NodeExecutionService,
              llmClientService: LLMClientService,
              promptBuilder: PromptBuilderService,
              intentDetector: IntentDetectorService,
              errorRecoveryService: FlowNodeErrorRecoveryService,
              flowExecutionService: FlowExecutionService,
            ) =>
              new FlowNodeProcessor(
                eventPublisher,
                jobEnqueuer,
                messageService,
                temporalClient,
                flowEngineService,
                llmClientService,
                promptBuilder,
                intentDetector,
                errorRecoveryService,
                flowExecutionService,
                errorRecoveryService, // Injecting twice as per constructor
              ),
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
          AgentProcessor,
          NotificationGenerationProcessor,
          MentionRelationService,
          {
            provide: CoreProcessor,
            useFactory: (
              queueService,
              eventPublisher: DomainEventPublisher,
              messageProcessor,
              artifactProcessor,
              llmProcessor,
              agentProcessor: AgentProcessor,
              flowNodeProcessor: FlowNodeProcessor,
              notificationGenerationProcessor: NotificationGenerationProcessor,
              mentionRelationService: MentionRelationService,
              eventRouter: EventRouter,
              entityLifecycleProcessor: EntityLifecycleProcessor,
              nonInteractiveFlowNodeProcessor: NonInteractiveFlowNodeProcessor,
            ) => {
              const coreProcessor = new CoreProcessor(
                queueService,
                eventPublisher,
                messageProcessor,
                artifactProcessor,
                llmProcessor,
                agentProcessor,
                flowNodeProcessor,
                entityLifecycleProcessor,
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

              // Override onQueueJobCreated to add debug logging
              const originalOnQueueJobCreated =
                coreProcessor['onQueueJobCreated'].bind(coreProcessor);
              coreProcessor['onQueueJobCreated'] = async (event) => {
                console.log(
                  'DEBUG: CoreProcessor.onQueueJobCreated called with event:',
                  event,
                );
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
              EventRouter,
              NonInteractiveFlowNodeProcessor,
            ],
          },
          OutboxPublisher,
          FlowExecutionService,
          InitiativeRefinementWorkflowService,
          ArtifactDataService,
          ArtifactDataValidators,
          ArtifactGraphService,
          ArtifactService,
          {
            provide: TagService,
            useValue: mockTagService,
          },
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
              createMastraApiKey: jest
                .fn()
                .mockResolvedValue('mock-mastra-key'),
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
        ],
      }).compile();
      console.log('🔧 beforeEach: NestJS test module compiled');

      // Configure the NestJS logger to use our CustomLoggerService
      const logger = module.get<CustomLoggerService>(CustomLoggerService);
      module.useLogger(logger);
      console.log('🔧 beforeEach: Custom logger configured for test module');

      // Set the global nest context so worker activities use our test module
      (global as unknown as { nestModuleRef: any }).nestModuleRef = module; // eslint-disable-line @typescript-eslint/no-explicit-any
      console.log(
        '🔧 beforeEach: Global nest context set for worker activities',
      );

      // Get services
      console.log('🔧 beforeEach: Getting services from module');
      projectService = module.get<ProjectService>(ProjectService);
      conversationService =
        module.get<ConversationService>(ConversationService);
      messageService = module.get<MessageService>(MessageService);
      flowNodeProcessor = module.get<FlowNodeProcessor>(FlowNodeProcessor);
      const coreProcessor = module.get<CoreProcessor>(CoreProcessor);
      const outboxPublisher = module.get<OutboxPublisher>(OutboxPublisher);
      console.log('🔧 beforeEach: Services retrieved');

      // Test the logger is working
      logger.debug('🔧 DEBUG: Test logger is working in test module', 'TEST');
      logger.log('🔧 INFO: Test logger info level working', 'TEST');
      console.log('🔧 beforeEach: Logger functionality verified');

      // Initialize processors
      console.log('🔧 beforeEach: Initializing processors');
      flowNodeProcessor.onModuleInit();
      await coreProcessor.onModuleInit();
      outboxPublisher.onModuleInit();
      console.log('🔧 beforeEach: Processors initialized');

      console.log('🔧 beforeEach: Starting worker');
      console.log('🔧 beforeEach: Worker state before run:', worker.getState());

      // Start the worker but don't wait for it to complete (it runs indefinitely)
      void worker.run();
      console.log(
        '🔧 beforeEach: Worker.run() called, waiting for RUNNING state',
      );

      // Wait for worker to be in RUNNING state with timeout
      await new Promise((resolve, reject) => {
        const startTime = Date.now();
        const timeoutMs = 30000; // 30 second timeout
        const checkState = () => {
          if (Date.now() - startTime > timeoutMs) {
            reject(
              new Error(
                `Worker failed to reach RUNNING state after ${timeoutMs}ms`,
              ),
            );
            return;
          }

          const state = worker.getState();
          console.log('🔧 beforeEach: Worker state check:', state);
          if (state === 'RUNNING') {
            console.log('🔧 beforeEach: Worker is now RUNNING');
            resolve(undefined);
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });

      _client = testEnv.client;
      console.log('🔧 beforeEach: Worker started and ready');

      // Debug: Check event routing setup
      console.log('CoreProcessor onModuleInit completed');
      console.log('OutboxPublisher onModuleInit completed');
      console.log('Event routing should be set up now');
    }, 60000);

    afterEach(async () => {
      // Clear the global nest context
      (global as unknown as { nestModuleRef: any }).nestModuleRef = undefined; // eslint-disable-line @typescript-eslint/no-explicit-any

      // Stop the OutboxPublisher to prevent background polling errors
      if (module) {
        const outboxPublisher = module.get<OutboxPublisher>(OutboxPublisher);
        outboxPublisher.stopPublisher();
        await module.close();
      }
      // Stop Temporal worker
      if (worker && worker.getState() === 'RUNNING') {
        worker.shutdown();
      }
      // Disconnect Redis client
      if (redis) {
        redis.disconnect();
      }
      // Stop Redis server
      if (redisServer) {
        await redisServer.stop();
      }
      jest.clearAllMocks();
    });

    afterAll(async () => {
      // Ensure OutboxPublisher is stopped before disconnecting
      if (module) {
        const outboxPublisher = module.get<OutboxPublisher>(OutboxPublisher);
        outboxPublisher.stopPublisher();
      }

      // Stop Temporal worker
      if (worker && worker.getState() === 'RUNNING') {
        worker.shutdown();
      }

      // Tear down Temporal test environment
      if (testEnv) {
        await testEnv.teardown();
      }

      // Disconnect Redis client
      if (redis) {
        redis.disconnect();
      }

      // Stop Redis server
      if (redisServer) {
        await redisServer.stop();
      }

      await sqlitePrisma.$disconnect();

      // Clean up test database
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      if (fs.existsSync(testDbPath + '-journal')) {
        fs.unlinkSync(testDbPath + '-journal');
      }
    });

    describe('Task Generation Compensation', () => {
      const waitForMessageCount = async (
        conversationId: string,
        expectedCount: number,
        mostRecentMsgStatus?: string,
      ): Promise<void> => {
        console.log(`checking for ${expectedCount} message(s)`, {
          mostRecentMsgStatus,
        });
        return new Promise<void>((resolve, reject) => {
          const checkMessages = async (attempt = 1): Promise<void> => {
            const currentMessages = await sqlitePrisma.db.message.findMany({
              where: { conversationId },
              orderBy: { createdAt: 'asc' },
            });
            console.log(
              `[checkMessages] Waiting for ${expectedCount} messages. Current count: ${currentMessages.length}`,
              {
                messagesTypes: currentMessages
                  .map((m: { type: string }) => m.type)
                  .join(' -> '),
                mostRecentMsgStatus,
              },
            );
            if (currentMessages.length >= expectedCount) {
              const status = currentMessages[currentMessages.length - 1].status;
              if (!mostRecentMsgStatus || status === mostRecentMsgStatus) {
                return void resolve();
              } else {
                console.log(`DEBUG: most recent message status not expected`, {
                  status: status,
                  expectedStatus: mostRecentMsgStatus,
                });
              }
            }

            if (attempt === 10) {
              console.debug(
                '[checkMessages] Attempted 10 tries, going home now',
              );
              for (let i = 0; i < currentMessages.length; i++) {
                console.debug(
                  `message ${i + 1}`,
                  JSON.stringify(currentMessages[i], null, 2),
                );
              }

              return void reject(new Error('time out'));
            }

            setTimeout(() => void checkMessages(attempt + 1), 1000);
          };
          void checkMessages();
        });
      };
      it('should handle compensation for LLM failures in task_generation_conversation node', async () => {
        // Step 1: Create project directly in database
        const project = await sqlitePrisma.db.project.create({
          data: {
            id: uuidv4(),
            name: 'Task Generation Compensation Test Project',
            description:
              'Test compensation system for task_generation_conversation node',
            organizationId: testOrganizationId,
            status: 'ACTIVE',
            createdBy: testUserId,
          },
        });

        // Step 2: Create conversation manually first, then start workflow
        const workflowId = ('task-gen-compensation-test-' +
          Date.now()) as WorkflowId;

        console.log('🚀 Creating task generation conversation...');
        const taskGenConversation = requireNonNull(
          await conversationService.createConversation(
            {
              projectId: project.id as ProjectId,
              organizationId: testOrganizationId,
              workflowId,
              initiatedBy: InitiationType.User,
              triggerEvent: 'TASK_GENERATION_STARTED',
              status: ConversationStatus.Started,
              title: 'Task Generation - Compensation Test',
              workflowName: 'task-generation',
              workflowAboutId: project.id,
              workflowAboutType: 'initiative',
              context: {
                aboutId: project.id,
                aboutType: 'initiative',
              },
            },
            testOrganizationId,
          ),
          'task generation conversation (compensation test)',
        );

        expect(taskGenConversation).toBeDefined();
        console.log(
          '✅ Task generation conversation created:',
          taskGenConversation.id,
        );

        // Step 3: Start Temporal workflow with task generation flow
        const temporalClient = testEnv.client;
        console.log('🚀 Starting task generation workflow...');
        await temporalClient.workflow.start('conversationFlowWorkflow', {
          taskQueue: 'conversation-queue',
          workflowId,
          args: [
            {
              projectId: project.id,
              workflowId,
              organizationId: testOrganizationId,
              flowId: 'task-generation',
              userId: testUserId,
              conversationId: taskGenConversation.id,
              initiatedBy: 'USER' as const,
              triggerEvent: 'TASK_GENERATION_STARTED',
              title: 'Task Generation - Compensation Test',
              category: 'task-generation',
              additionalContext: {},
            },
          ],
        });

        // Step 4: Wait for workflow to initialize and send initial welcome message
        await waitForMessageCount(taskGenConversation.id, 1);

        // Step 5: Mock LLM service to simulate timeout on first attempt, succeed on retry
        const llmClientService = module.get<LLMClientService>(LLMClientService);
        let attemptCount = 1;
        const originalCallStructured = llmClientService.callStructured;

        llmClientService.callStructured = jest
          .fn()
          .mockImplementation(async (prompt, options, source) => {
            console.log(
              `MockLLM attempt ${attemptCount} for task generation compensation test`,
            );
            console.log(`MockLLM prompt snippet: ${prompt.substring(0, 200)}`);

            // Check if this is a task_generation_conversation call
            const isTaskGenerationConversation =
              prompt.includes(
                'helpful assistant that engages in conversation about task generation',
              ) ||
              prompt.includes(
                'Understanding their project context and goals',
              ) ||
              prompt.includes(
                'task generation needs rather than immediately generating tasks',
              );

            console.log(
              `MockLLM: Is task_generation_conversation? ${isTaskGenerationConversation}`,
            );

            // Simulate timeout on first task_generation_conversation attempt only
            if (attemptCount === 1 && isTaskGenerationConversation) {
              attemptCount++;
              console.log(
                'MockLLM: Simulating timeout on first task_generation_conversation attempt',
              );
              const timeoutError = new Error('Request timeout');
              timeoutError.name = 'TimeoutError';
              throw timeoutError;
            }

            // Succeed on task_generation_conversation retry (attempt 2)
            if (attemptCount === 2 && isTaskGenerationConversation) {
              console.log(
                'MockLLM: Succeeding on task_generation_conversation retry attempt',
              );
              return {
                content: {
                  response:
                    'I understand you want to discuss task generation. Let me help you understand your project context and generate the right tasks for your needs.',
                },
                usage: {
                  promptTokens: 100,
                  completionTokens: 80,
                  totalTokens: 180,
                },
                costData: {
                  model: 'claude-4-haiku-20250108',
                  inputTokens: 100,
                  outputTokens: 80,
                  totalTokens: 180,
                  inputCost: 0.1,
                  outputCost: 0.32,
                  totalCost: 0.42,
                },
              };
            }

            // For classification calls, route to conversation
            if (
              prompt.includes(
                'classification assistant that determines user intent',
              ) &&
              prompt.includes('task generation context')
            ) {
              console.log('MockLLM: Handling task generation classification');
              return {
                content: {
                  detectedIntent: 'conversation',
                  intentConfidence: 0.95,
                  reasoning: 'User wants to discuss task generation needs',
                },
                usage: {
                  promptTokens: 50,
                  completionTokens: 30,
                  totalTokens: 80,
                },
                costData: {
                  model: 'claude-4-haiku-20250108',
                  inputTokens: 50,
                  outputTokens: 30,
                  totalTokens: 80,
                  inputCost: 0.05,
                  outputCost: 0.12,
                  totalCost: 0.17,
                },
              };
            }

            // Default fallback - call original implementation
            console.log('MockLLM: Using original implementation');
            return originalCallStructured.call(
              llmClientService,
              prompt,
              options,
              source,
            );
          });

        const currentMessages = await sqlitePrisma.db.message.findMany({
          where: { conversationId: taskGenConversation.id },
          orderBy: { createdAt: 'asc' },
        });

        console.log('Current messages before user input:', {
          count: currentMessages.length,
          types: currentMessages.map((m: any) => m.type),
          statuses: currentMessages.map((m: any) => m.status),
        });

        // Find the latest system message to respond to
        const latestSystemMessage = currentMessages
          .filter((m: any) => m.type === MessageType.System)
          .pop();

        if (!latestSystemMessage) {
          throw new Error('No system message found to respond to');
        }

        // Create user message that will be classified as conversation intent
        const userMessage = await messageService.addMessage(
          {
            projectId: project.id,
            conversationId: taskGenConversation.id,
            type: 'USER' as const,
            status: MessageStatus.Completed,
            userId: testUserId,
            data: {
              message:
                'I want to discuss what kinds of tasks would be best for my project. Can you help me understand my options?',
            },
            parentMessageId: latestSystemMessage.id,
          },
          testOrganizationId,
          'user-interaction',
        );

        console.log('✅ User message created:', userMessage.id);

        // Step 7: Wait for processing (first attempt fails, compensation retries, second attempt succeeds)
        const startTime = Date.now();

        // Step 4: Wait for workflow to initialize and send initial welcome message
        await waitForMessageCount(taskGenConversation.id, 2);

        // Step 8: Verify that messages were created via workflow processing
        const messages = await sqlitePrisma.db.message.findMany({
          where: { conversationId: taskGenConversation.id },
          orderBy: { createdAt: 'asc' },
        });

        const elapsedTime = Date.now() - startTime;
        console.log('DEBUG: Task generation compensation test messages:', {
          count: messages.length,
          types: messages.map((m: any) => m.type),
          statuses: messages.map((m: any) => m.status),
          elapsedTime: `${elapsedTime}ms`,
        });

        // Should have workflow-created messages (initial + retry messages from compensation)
        expect(messages.length).toBeGreaterThanOrEqual(2);

        // Find system response messages created by workflow
        const systemMessages = messages.filter(
          (m: any) => m.type === MessageType.System,
        );

        expect(systemMessages.length).toBeGreaterThan(0);

        // At least one system message should contain response about task generation discussion
        const responseMessage = systemMessages.find(
          (m: any) =>
            m.data?.response &&
            (m.data.response.includes('understand') ||
              m.data.response.includes('discuss') ||
              m.data.response.includes('task generation')),
        );

        expect(responseMessage).toBeDefined();
        // expect(responseMessage.status).toBe(MessageStatus.Completed);

        await waitForMessageCount(taskGenConversation.id, 3);

        // now wait for retry, we'll give 10 seconds to be safe
        await new Promise((resolve) => setTimeout(resolve, 10000));

        await waitForMessageCount(taskGenConversation.id, 4, 'completed');

        // Step 9: Verify the compensation system worked (should have retried due to timeout)
        const endTime = Date.now();
        const processingTime = endTime - startTime;

        console.log(`Processing time: ${processingTime}ms`);

        // Verify that retry actually happened by checking attempt count
        expect(attemptCount).toBe(2);
        console.log(
          `✅ Compensation system successfully retried: ${attemptCount} attempts`,
        );

        // Step 10: Verify the conversation is still functional (not in dead-end state)
        const finalConversation = await sqlitePrisma.db.conversation.findUnique(
          {
            where: { id: taskGenConversation.id },
          },
        );

        expect(finalConversation?.status).toBe('IN_PROGRESS'); // Not stuck in dead-end

        // Restore original LLM service
        llmClientService.callStructured = originalCallStructured;

        console.log(
          '✅ Task generation compensation test passed - task_generation_conversation node successfully retried after timeout and avoided UI dead-end',
        );
      }, 60000);

      it('should handle RATE_LIMITED compensation with proper delay in task_generation_conversation node', async () => {
        // Step 1: Create project
        const project = await sqlitePrisma.db.project.create({
          data: {
            id: uuidv4(),
            name: 'Task Generation Rate Limit Test Project',
            description:
              'Test RATE_LIMITED compensation for task_generation_conversation node',
            organizationId: testOrganizationId,
            status: 'ACTIVE',
            createdBy: testUserId,
          },
        });

        // Step 2: Create conversation
        const workflowId = ('task-gen-rate-limit-test-' +
          Date.now()) as WorkflowId;

        console.log(
          '🚀 Creating task generation conversation for rate limit test...',
        );
        const taskGenConversation = requireNonNull(
          await conversationService.createConversation(
            {
              projectId: project.id as ProjectId,
              organizationId: testOrganizationId,
              workflowId,
              initiatedBy: InitiationType.User,
              triggerEvent: 'TASK_GENERATION_STARTED',
              status: ConversationStatus.Started,
              title: 'Task Generation - Rate Limit Test',
              workflowName: 'task-generation',
              workflowAboutId: project.id,
              workflowAboutType: 'initiative',
              context: {
                aboutId: project.id,
                aboutType: 'initiative',
              },
            },
            testOrganizationId,
          ),
          'task generation conversation (rate limit test)',
        );

        // Step 3: Start workflow
        const temporalClient = testEnv.client;
        const workflowHandle = await temporalClient.workflow.start(
          'conversationFlowWorkflow',
          {
            taskQueue: 'conversation-queue',
            workflowId,
            args: [
              {
                projectId: project.id,
                workflowId,
                organizationId: testOrganizationId,
                flowId: 'task-generation',
                userId: testUserId,
                conversationId: taskGenConversation.id,
                initiatedBy: 'USER' as const,
                triggerEvent: 'TASK_GENERATION_STARTED',
                title: 'Task Generation - Rate Limit Test',
                category: 'task-generation',
                additionalContext: {},
              },
            ],
          },
        );

        // Wait for workflow to initialize and send initial welcome message
        await waitForMessageCount(taskGenConversation.id, 1);

        // Step 4: Mock LLM service to simulate rate limiting on first attempt
        const llmClientService = module.get<LLMClientService>(LLMClientService);
        let attemptCount = 0;
        const originalCallStructured = llmClientService.callStructured;

        llmClientService.callStructured = jest
          .fn()
          .mockImplementation(async (prompt, options, source) => {
            attemptCount++;
            console.log(
              `MockLLM attempt ${attemptCount} for rate limit compensation test`,
            );

            // Check if this is a task_generation_conversation call
            const isTaskGenerationConversation =
              prompt.includes(
                'helpful assistant that engages in conversation about task generation',
              ) ||
              prompt.includes('Understanding their project context and goals');

            // Simulate rate limiting on first task_generation_conversation attempt only
            if (attemptCount === 1 && isTaskGenerationConversation) {
              console.log(
                'MockLLM: Simulating rate limiting on first task_generation_conversation attempt',
              );
              const rateLimitError = new Error('Rate limit exceeded');
              rateLimitError.name = 'RateLimitError';
              throw rateLimitError;
            }

            // Succeed on retry with proper delay
            if (attemptCount === 2 && isTaskGenerationConversation) {
              console.log(
                'MockLLM: Succeeding on task_generation_conversation retry after rate limit',
              );
              return {
                content: {
                  response:
                    'Thank you for your patience. I can now help you with task generation planning.',
                },
                usage: {
                  promptTokens: 100,
                  completionTokens: 80,
                  totalTokens: 180,
                },
                costData: {
                  model: 'claude-4-haiku-20250108',
                  inputTokens: 100,
                  outputTokens: 80,
                  totalTokens: 180,
                  inputCost: 0.1,
                  outputCost: 0.32,
                  totalCost: 0.42,
                },
              };
            }

            // For classification calls
            if (
              prompt.includes(
                'classification assistant that determines user intent',
              )
            ) {
              return {
                content: {
                  detectedIntent: 'conversation',
                  intentConfidence: 0.95,
                  reasoning: 'User wants to discuss task generation',
                },
                usage: {
                  promptTokens: 50,
                  completionTokens: 30,
                  totalTokens: 80,
                },
                costData: {
                  model: 'claude-4-haiku-20250108',
                  inputTokens: 50,
                  outputTokens: 30,
                  totalTokens: 80,
                  inputCost: 0.05,
                  outputCost: 0.12,
                  totalCost: 0.17,
                },
              };
            }

            return originalCallStructured.call(
              llmClientService,
              prompt,
              options,
              source,
            );
          });

        // Step 5: Send user message and trigger rate limit compensation
        // Verify we have the initial system message before proceeding
        const currentMessages = await sqlitePrisma.db.message.findMany({
          where: { conversationId: taskGenConversation.id },
          orderBy: { createdAt: 'asc' },
        });

        const latestSystemMessage = currentMessages
          .filter((m: any) => m.type === MessageType.System)
          .pop();

        if (!latestSystemMessage) {
          throw new Error('No system message found to respond to');
        }

        const userMessage = await messageService.addMessage(
          {
            projectId: project.id,
            conversationId: taskGenConversation.id,
            type: 'USER' as const,
            status: MessageStatus.Completed,
            userId: testUserId,
            data: {
              message:
                'Can you help me plan the right tasks for my development project?',
            },
            parentMessageId: latestSystemMessage.id,
          },
          testOrganizationId,
          'user-interaction',
        );

        // Step 6: Wait for rate limit compensation with 5000ms retry delay
        const startTime = Date.now();

        // Wait for initial processing and compensation to occur
        await waitForMessageCount(taskGenConversation.id, 2);

        // Keep the delay for rate limit retry timing verification
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait longer for rate limit retry delay

        // Verify final message count after retry
        await waitForMessageCount(taskGenConversation.id, 3, 'completed');

        // Step 7: Verify compensation worked with proper retry delay
        const processingTime = Date.now() - startTime;
        console.log(`Rate limit processing time: ${processingTime}ms`);

        // Should have taken at least 5000ms due to retry delay specified in compensate method
        expect(processingTime).toBeGreaterThan(4000);

        expect(attemptCount).toBe(2);
        console.log(
          `✅ Rate limit compensation worked with ${attemptCount} attempts`,
        );

        // Restore
        llmClientService.callStructured = originalCallStructured;

        console.log('✅ Task generation RATE_LIMITED compensation test passed');
      }, 90000);

      it('should handle FAIL compensation when max attempts reached in task_generation_conversation node', async () => {
        // Step 1: Create project
        const project = await sqlitePrisma.db.project.create({
          data: {
            id: uuidv4(),
            name: 'Task Generation FAIL Test Project',
            description:
              'Test FAIL compensation for task_generation_conversation node',
            organizationId: testOrganizationId,
            status: 'ACTIVE',
            createdBy: testUserId,
          },
        });

        // Step 2: Create conversation
        const workflowId = ('task-gen-fail-test-' + Date.now()) as WorkflowId;

        const taskGenConversation = requireNonNull(
          await conversationService.createConversation(
            {
              projectId: project.id as ProjectId,
              organizationId: testOrganizationId,
              workflowId,
              initiatedBy: InitiationType.User,
              triggerEvent: 'TASK_GENERATION_STARTED',
              status: ConversationStatus.Started,
              title: 'Task Generation - FAIL Test',
              workflowName: 'task-generation',
              workflowAboutId: project.id,
              workflowAboutType: 'initiative',
              context: {
                aboutId: project.id,
                aboutType: 'initiative',
              },
            },
            testOrganizationId,
          ),
          'task generation conversation (fail test)',
        );

        // Step 3: Start workflow
        const temporalClient = testEnv.client;
        const workflowHandle = await temporalClient.workflow.start(
          'conversationFlowWorkflow',
          {
            taskQueue: 'conversation-queue',
            workflowId,
            args: [
              {
                projectId: project.id,
                workflowId,
                organizationId: testOrganizationId,
                flowId: 'task-generation',
                userId: testUserId,
                conversationId: taskGenConversation.id,
                initiatedBy: 'USER' as const,
                triggerEvent: 'TASK_GENERATION_STARTED',
                title: 'Task Generation - FAIL Test',
                category: 'task-generation',
                additionalContext: {},
              },
            ],
          },
        );

        // Wait for workflow to initialize and send initial welcome message
        await waitForMessageCount(taskGenConversation.id, 1);

        // Step 4: Mock LLM service to always fail with non-retryable error
        const llmClientService = module.get<LLMClientService>(LLMClientService);
        let attemptCount = 0;
        const originalCallStructured = llmClientService.callStructured;

        llmClientService.callStructured = jest
          .fn()
          .mockImplementation(async (prompt, options, source) => {
            attemptCount++;
            console.log(
              `MockLLM attempt ${attemptCount} for FAIL compensation test`,
            );

            // Check if this is a task_generation_conversation call
            const isTaskGenerationConversation = prompt.includes(
              'helpful assistant that engages in conversation about task generation',
            );

            // Always throw non-retryable error for task_generation_conversation
            if (isTaskGenerationConversation) {
              console.log(
                'MockLLM: Simulating permanent failure for task_generation_conversation',
              );
              const permanentError = new Error('Permanent service failure');
              permanentError.name = 'ServiceError';
              throw permanentError;
            }

            // For classification calls, succeed
            if (
              prompt.includes(
                'classification assistant that determines user intent',
              )
            ) {
              return {
                content: {
                  detectedIntent: 'conversation',
                  intentConfidence: 0.95,
                  reasoning: 'User wants conversation',
                },
                usage: {
                  promptTokens: 50,
                  completionTokens: 30,
                  totalTokens: 80,
                },
                costData: {
                  model: 'claude-4-haiku-20250108',
                  inputTokens: 50,
                  outputTokens: 30,
                  totalTokens: 80,
                  inputCost: 0.05,
                  outputCost: 0.12,
                  totalCost: 0.17,
                },
              };
            }

            return originalCallStructured.call(
              llmClientService,
              prompt,
              options,
              source,
            );
          });

        // Step 5: Send user message that will trigger compensation FAIL
        // Verify we have the initial system message before proceeding
        const currentMessages = await sqlitePrisma.db.message.findMany({
          where: { conversationId: taskGenConversation.id },
          orderBy: { createdAt: 'asc' },
        });

        console.log('currentMessages', currentMessages);

        const latestSystemMessage = currentMessages
          .filter((m: any) => m.type === MessageType.System)
          .pop();

        if (!latestSystemMessage) {
          throw new Error('No system message found to respond to');
        }

        const userMessage = await messageService.addMessage(
          {
            projectId: project.id,
            conversationId: taskGenConversation.id,
            type: 'USER' as const,
            status: MessageStatus.Completed,
            userId: testUserId,
            data: {
              message:
                'This should trigger a permanent failure in compensation',
            },
            parentMessageId: latestSystemMessage?.id,
          },
          testOrganizationId,
          'user-interaction',
        );

        // Step 6: Wait for workflow to process the failure
        // For FAIL compensation, we expect only the initial messages plus user message
        await waitForMessageCount(taskGenConversation.id, 2);
        await new Promise((res) => setTimeout(res, 10000));

        // now wait for the failed message
        await waitForMessageCount(taskGenConversation.id, 4, 'failed');

        // Step 7: Verify compensation returned FAIL and workflow handled it
        // expect(attemptCount).toBe(1); // Should only try once for non-retryable error

        // Verify final conversation state - workflow should handle the permanent failure
        const finalConversation = await sqlitePrisma.db.conversation.findUnique(
          {
            where: { id: taskGenConversation.id },
          },
        );

        // ok
        expect(finalConversation.status).toBe('IN_PROGRESS');

        // Restore
        llmClientService.callStructured = originalCallStructured;

        console.log(
          '✅ Task generation FAIL compensation test passed - properly handled permanent failure',
        );
      }, 60000);
    });
  },
);
