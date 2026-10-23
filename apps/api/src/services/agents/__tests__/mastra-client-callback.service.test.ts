import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { MastraClientService } from '../mastra-client.service';
import { MastraAgentRequest } from '../mastra-client.service';
import { LLMTrackingService } from '../../llm/llm-tracking.service';
import { EntityRelationshipResolverService } from '../../relationships/entity-relationship-resolver.service';
import type {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
} from '../../../types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { JwtKeysService } from 'src/auth/services/jwt-keys.service';
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  ApiKeyType: {
    INTERNAL: 'INTERNAL',
    MASTRA_AI: 'MASTRA_AI',
  },
  EntityType: {
    ARTIFACT: 'ARTIFACT',
    INITIATIVE: 'INITIATIVE',
    TASK: 'TASK',
    MESSAGE: 'MESSAGE',
    DESIGN_DOC: 'DESIGN_DOC',
  },
  ReportAudience: {
    WORKFLOW_ONLY: 'WORKFLOW_ONLY',
    PROJECT_VISIBLE: 'PROJECT_VISIBLE',
    ORGANIZATION_VISIBLE: 'ORGANIZATION_VISIBLE',
  },
  AgentSessionType: {
    CODING: 'CODING',
    DAILY_SESSION: 'DAILY_SESSION',
    SESSION_MONITOR: 'SESSION_MONITOR',
    TASK_REFINING: 'TASK_REFINING',
    ENTITY_CONVERSATION: 'ENTITY_CONVERSATION',
    PROJECT_CONVERSATION: 'PROJECT_CONVERSATION',
    DESIGN_DOC_REFINING: 'DESIGN_DOC_REFINING',
    AGENT_SEARCH: 'AGENT_SEARCH',
    PROPOSAL_REFINING: 'PROPOSAL_REFINING',
    PLAN_GENERATION: 'PLAN_GENERATION',
    PLAN_STAGE_REFINING: 'PLAN_STAGE_REFINING',
    VALIDATION: 'VALIDATION',
  },
  AgentSessionStatus: {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    WAITING: 'WAITING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  },
  DesignDocParentEntityType: {
    TASK: 'TASK',
    DESIGN_DOC: 'DESIGN_DOC',
  },
  WorkStatus: {
    GENERATED: 'GENERATED',
    BACKLOG: 'BACKLOG',
    GENERATING_DESCRIPTION: 'GENERATING_DESCRIPTION',
    REFINING_DESCRIPTION: 'REFINING_DESCRIPTION',
    REFINING_DETAILS: 'REFINING_DETAILS',
    REFINING_ACCEPTANCE_CRITERIA: 'REFINING_ACCEPTANCE_CRITERIA',
    GENERATING_DETAILS: 'GENERATING_DETAILS',
    GENERATING_DESCRIPTION_AND_DETAILS: 'GENERATING_DESCRIPTION_AND_DETAILS',
    GENERATING_ACCEPTANCE_CRITERIA: 'GENERATING_ACCEPTANCE_CRITERIA',
    GENERATING_ALL: 'GENERATING_ALL',
    ON_HOLD: 'ON_HOLD',
    ACTIVE: 'ACTIVE',
    VERIFYING: 'VERIFYING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    ARCHIVED: 'ARCHIVED',
  },
  PlanStageStatus: {
    NOT_STARTED: 'NOT_STARTED',
    REFINING: 'REFINING',
    IN_PROGRESS: 'IN_PROGRESS',
    BLOCKED: 'BLOCKED',
    COMPLETE: 'COMPLETE',
  },
  PlanStepStatus: {
    NOT_STARTED: 'NOT_STARTED',
    REFINING: 'REFINING',
    IN_PROGRESS: 'IN_PROGRESS',
    VERIFYING: 'VERIFYING',
    BLOCKED: 'BLOCKED',
    SKIPPED: 'SKIPPED',
    COMPLETE: 'COMPLETE',
  },
  PlanStepType: {
    TASK: 'TASK',
    DESIGN_DOC: 'DESIGN_DOC',
    SERVICE: 'SERVICE',
    OTHER: 'OTHER',
  },
  PlanEffortUnit: {
    HOURS: 'HOURS',
    DAYS: 'DAYS',
    POINTS: 'POINTS',
  },
  PlanDurationUnit: {
    HOURS: 'HOURS',
    DAYS: 'DAYS',
    WEEKS: 'WEEKS',
  },
  PlanSignOffStatus: {
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  },
  PlanRelationshipType: {
    CREATED: 'CREATED',
    LINKED: 'LINKED',
  },
  PlanType: {
    STANDARD: 'STANDARD',
    MINI: 'MINI',
  },
  PlanStatus: {
    INTAKE: 'INTAKE',
    BRAINSTORMING: 'BRAINSTORMING',
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    ON_HOLD: 'ON_HOLD',
    BLOCKED: 'BLOCKED',
    COMPLETE: 'COMPLETE',
    ARCHIVED: 'ARCHIVED',
  },
  TaskType: {
    STANDARD: 'STANDARD',
    BUG: 'BUG',
    FEATURE: 'FEATURE',
    GOAL: 'GOAL',
  },
  PlanExecutionGuidanceStatus: {
    REQUESTED: 'REQUESTED',
    GENERATING: 'GENERATING',
    READY: 'READY',
  },
  ProposalStatus: {
    DRAFT: 'DRAFT',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  },
  TargetEntityType: {
    TASK: 'TASK',
    DESIGN_DOC: 'DESIGN_DOC',
    PLAN_STAGE: 'PLAN_STAGE',
    PLAN_STEP: 'PLAN_STEP',
    CONVERSATION: 'CONVERSATION',
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

const testIds = {
  organization: 'org-123' as OrganizationId,
  project: 'proj-456' as ProjectId,
  initiative: 'init-789' as InitiativeId,
  conversation: 'conv-123' as ConversationId,
};

// Test response schema that exactly matches AgentResponseShape
const TestResponseSchema = z
  .object({
    summary: z.string(),
  })
  .and(z.record(z.unknown())); // Required summary + allow other properties like [key: string]: unknown

// Mock fetch globally
global.fetch = jest.fn();

describe('MastraClientService - Callback Integration', () => {
  let service: MastraClientService;
  let mockLLMTrackingService: jest.Mocked<LLMTrackingService>;
  let configService: jest.Mocked<ConfigService>;
  let jwtService: jest.Mocked<JwtKeysService>;
  let relationshipResolver: jest.Mocked<EntityRelationshipResolverService>;

  // Set up proper mock responses for JWT issuance
  const setupApiKeyMocks = () => {
    jwtService.getToken.mockReturnValue('org-specific-key-123');
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const configOverrides = {
      get: jest.fn((key: string, defaultValue?: string | number) => {
        switch (key) {
          case 'MASTRA_BASE_URL':
            return 'http://localhost:4112/api';
          case 'BASE_URL':
            return 'http://localhost:3000';
          case 'MASTRA_TIMEOUT':
            return 300000;
          case 'MASTRA_CIRCUIT_BREAKER_THRESHOLD':
            return 5;
          case 'MASTRA_MAX_CONCURRENT_EXECUTIONS':
            return 10;
          default:
            return defaultValue;
        }
      }),
      getOrThrow: jest.fn(),
      set: jest.fn(),
      has: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const relationshipResolverMock = {
      resolveForWorkflowAbout: jest.fn().mockResolvedValue({
        resolvedContext: {},
        additionalHeaders: {},
      }),
    } as unknown as jest.Mocked<EntityRelationshipResolverService>;

    const { module, mocks } = await createServiceTestingModule({
      providers: [MastraClientService],
      overrides: [
        [ConfigService, configOverrides],
        [EntityRelationshipResolverService, relationshipResolverMock],
      ],
    });
    mockLLMTrackingService = mocks.llmTrackingService;
    configService = mocks.configService;
    jwtService = mocks.jwtKeysService;
    relationshipResolver = module.get<EntityRelationshipResolverService>(
      EntityRelationshipResolverService,
    ) as jest.Mocked<EntityRelationshipResolverService>;

    mockLLMTrackingService.recordPromptResponse.mockResolvedValue(
      'tracking-id',
    );
    setupApiKeyMocks();

    service = module.get<MastraClientService>(MastraClientService);
  });

  describe('executeAgent with callback integration', () => {
    const mockRequest: MastraAgentRequest = {
      agentId: 'initiative-refiner',
      requestId: 'req-callback-001',
      messages: [
        {
          role: 'user',
          content: 'Please help me refine this initiative',
        },
      ],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        initiativeId: testIds.initiative,
        conversationId: testIds.conversation,
        workflowAboutId: testIds.initiative,
        workflowAboutType: 'initiative',
      },
      temperature: 0.7,
      maxExecutionTime: 300000,
    };

    it('should include context information in request headers', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Override to return specific key for this test
      jwtService.getToken.mockReturnValueOnce('org-specific-key-123');

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            executionId: 'exec-123',
            status: 'completed',
            result: { refined: 'initiative' },
            summary: 'Test execution summary',
          },
        }),
        text: async () =>
          JSON.stringify({
            data: {
              executionId: 'exec-123',
              status: 'completed',
              result: { refined: 'initiative' },
              summary: 'Test execution summary',
            },
          }),
      } as Response);

      await service.executeAgent(mockRequest, TestResponseSchema as any, {
        nodeId: 'test-node',
        workflowId: 'test-workflow',
      });

      // Check that the service used the mocked base URL
      const [firstCall] = mockFetch.mock.calls;
      if (!firstCall) {
        throw new Error('Expected fetch call');
      }
      const actualUrl = firstCall[0] as string;
      expect(actualUrl).toBe('http://localhost:4112/api/initiative-refiner');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/initiative-refiner'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer org-specific-key-123',
            'User-Agent': 'hey-hey-api/1.0',
            'X-Organization-ID': testIds.organization,
            'X-Project-ID': testIds.project,
            'X-Initiative-ID': testIds.initiative,
            'X-Conversation-ID': testIds.conversation,
          }),
        }),
      );

      expect(mockLLMTrackingService.recordPromptResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'mastra',
          success: true,
          workflowId: 'test-workflow',
        }),
      );
    });

    it('should include request parameters in request body', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Override to return specific key for this test
      jwtService.getToken.mockReturnValueOnce('org-body-key-456');

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            executionId: 'exec-456',
            status: 'completed',
            result: { data: 'test' },
            summary: 'Test execution summary',
          },
        }),
        text: async () =>
          JSON.stringify({
            data: {
              executionId: 'exec-456',
              status: 'completed',
              result: { data: 'test' },
              summary: 'Test execution summary',
            },
          }),
      } as Response);

      await service.executeAgent(mockRequest, TestResponseSchema as any, {
        nodeId: 'test-node',
        workflowId: 'test-workflow',
      });

      const [fetchCall] = mockFetch.mock.calls;
      if (!fetchCall) {
        throw new Error('Expected fetch call');
      }
      const requestBody = JSON.parse(fetchCall[1]?.body as string);

      expect(requestBody).toMatchObject({
        messages: mockRequest.messages,
        temperature: 0.7,
        maxExecutionTime: 300000,
      });

      expect(mockLLMTrackingService.recordPromptResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'mastra',
          success: true,
          workflowId: 'test-workflow',
        }),
      );
    });

    it('should use custom MASTRA_BASE_URL if configured', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const customMastraUrl = 'https://custom-mastra.example.com/api';

      // Recreate the service with custom config
      const customConfigService = {
        get: jest
          .fn()
          .mockImplementation((key: string, defaultValue?: string | number) => {
            if (key === 'BASE_URL') return 'http://localhost:3000';
            if (key === 'MASTRA_BASE_URL') return customMastraUrl;
            if (key === 'MASTRA_TIMEOUT') return 300000;
            if (key === 'MASTRA_CIRCUIT_BREAKER_THRESHOLD') return 5;
            if (key === 'MASTRA_MAX_CONCURRENT_EXECUTIONS') return 10;
            return defaultValue;
          }),
      };

      const customService = new MastraClientService(
        customConfigService as any,
        jwtService,
        mockLLMTrackingService,
        relationshipResolver,
      );

      // Override to return specific key for this test
      jwtService.getToken.mockReturnValueOnce('custom-key-789');

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            executionId: 'exec-custom',
            status: 'completed',
            summary: 'Test summary',
          },
        }),
        text: async () =>
          JSON.stringify({
            data: {
              executionId: 'exec-custom',
              status: 'completed',
              summary: 'Test summary',
            },
          }),
      } as Response);

      await customService.executeAgent(mockRequest, TestResponseSchema as any, {
        nodeId: 'test-node',
        workflowId: 'test-workflow',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${customMastraUrl}/initiative-refiner`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer custom-key-789',
          }),
        }),
      );
    });

    it('should use organization-specific API key for auth', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const specificOrgKey = 'specific-org-key-abc';

      // Override to return specific key for this test
      jwtService.getToken.mockReturnValueOnce(specificOrgKey);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            executionId: 'exec-specific',
            status: 'completed',
            summary: 'Test summary',
          },
        }),
        text: async () =>
          JSON.stringify({
            data: {
              executionId: 'exec-specific',
              status: 'completed',
              summary: 'Test summary',
            },
          }),
      } as Response);

      await service.executeAgent(mockRequest, TestResponseSchema as any, {
        nodeId: 'test-node',
        workflowId: 'test-workflow',
      });

      expect(jwtService.getToken).toHaveBeenCalledWith(
        {
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
        { expiresIn: '1h' },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${specificOrgKey}`,
          }),
        }),
      );
    });

    it('should throw error when organization API key is unavailable', async () => {
      jwtService.getToken.mockReturnValueOnce('');

      await expect(
        service.executeAgent(mockRequest, TestResponseSchema as any, {
          nodeId: 'test-node',
          workflowId: 'test-workflow',
        }),
      ).rejects.toThrow('Failed to get API key for organization');
    });
  });

  describe('security validation', () => {
    it('should require organizationId in request context', async () => {
      const requestWithoutOrg: MastraAgentRequest = {
        agentId: 'test-agent',
        requestId: 'req-missing-org-001',
        messages: [{ role: 'user', content: 'test' }],
        context: {
          // Missing organizationId
          projectId: testIds.project,
          conversationId: testIds.conversation,
          workflowAboutId: testIds.initiative,
          workflowAboutType: 'initiative',
        } as any,
      };

      await expect(
        service.executeAgent(requestWithoutOrg, TestResponseSchema as any, {
          nodeId: 'test',
          workflowId: 'test',
        }),
      ).rejects.toThrow(/Invalid agent request: .*context\.organizationId/);
    });

    it('should validate request security before making call', async () => {
      const securitySpy = jest.spyOn(
        service as any,
        'scanRequestForSensitiveData',
      );

      const mockRequest: MastraAgentRequest = {
        agentId: 'initiative-refiner',
        requestId: 'req-security-001',
        messages: [
          {
            role: 'user',
            content: 'Please help me refine this initiative',
          },
        ],
        context: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          initiativeId: testIds.initiative,
          conversationId: testIds.conversation,
          workflowAboutId: testIds.initiative,
          workflowAboutType: 'initiative',
        },
      };

      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      jwtService.getToken.mockReturnValue('test-key');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            executionId: 'exec-security',
            status: 'completed',
            summary: 'Test summary',
          },
        }),
        text: async () =>
          JSON.stringify({
            data: {
              executionId: 'exec-security',
              status: 'completed',
              summary: 'Test summary',
            },
          }),
      } as Response);

      await service.executeAgent(mockRequest, TestResponseSchema as any, {
        nodeId: 'test-node',
        workflowId: 'test-workflow',
      });

      expect(securitySpy).toHaveBeenCalled();
      const [firstCall] = securitySpy.mock.calls;
      if (!firstCall) {
        throw new Error('Expected validate call');
      }
      const [validatedRequestArg] = firstCall;
      expect(validatedRequestArg).toEqual(
        expect.objectContaining({
          agentId: mockRequest.agentId,
          context: expect.objectContaining({
            organizationId: testIds.organization,
            projectId: testIds.project,
          }),
        }),
      );
    });
  });
});
