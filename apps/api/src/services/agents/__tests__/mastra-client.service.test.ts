/* eslint-disable @typescript-eslint/unbound-method */
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { JwtKeysService } from 'src/auth/services/jwt-keys.service';
import {
  MastraAgentRequest,
  MastraClientService,
} from '../mastra-client.service';
import { LLMTrackingService } from '../../llm/llm-tracking.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { EntityRelationshipResolverService } from '../../relationships/entity-relationship-resolver.service';
import type {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
} from '../../../types';

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

// Mock fetch globally
global.fetch = jest.fn();

describe('MastraClientService', () => {
  let service: MastraClientService;
  let configService: jest.Mocked<ConfigService>;
  let jwtService: jest.Mocked<JwtKeysService>;
  let llmTrackingService: jest.Mocked<LLMTrackingService>;
  let relationshipResolverMock: jest.Mocked<EntityRelationshipResolverService>;

  const testIds = {
    organization: 'org-123' as OrganizationId,
    project: 'proj-456' as ProjectId,
    initiative: 'init-789' as InitiativeId,
    conversation: 'conv-123' as ConversationId,
    agentId: 'agent-001',
  };

  const createMockAgentRequest = (
    overrides: Partial<MastraAgentRequest> = {},
  ): MastraAgentRequest => ({
    agentId: overrides.agentId ?? testIds.agentId,
    requestId: overrides.requestId ?? 'req-123',
    messages: overrides.messages ?? [
      { role: 'user', content: 'Test message content' },
    ],
    context: {
      organizationId: overrides.context?.organizationId ?? testIds.organization,
      projectId: overrides.context?.projectId ?? testIds.project,
      initiativeId: overrides.context?.initiativeId ?? testIds.initiative,
      conversationId: overrides.context?.conversationId ?? testIds.conversation,
      workflowAboutId:
        overrides.context?.workflowAboutId ?? 'workflow-about-id',
      workflowAboutType: overrides.context?.workflowAboutType ?? 'initiative',
      ...overrides.context,
    },
    maxExecutionTime: overrides.maxExecutionTime ?? 300000,
    temperature: overrides.temperature ?? 0.7,
  });

  beforeEach(async () => {
    // Reset fetch mock
    (fetch as jest.MockedFunction<typeof fetch>).mockReset();
    const configOverrides = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const configMap: Record<string, unknown> = {
          MASTRA_BASE_URL: 'https://api.mastra.ai',
          MASTRA_TIMEOUT: 300000,
          MASTRA_CIRCUIT_BREAKER_THRESHOLD: 5,
          MASTRA_MAX_CONCURRENT_EXECUTIONS: 10,
        };
        return configMap[key] ?? defaultValue;
      }),
      getOrThrow: jest.fn(),
      set: jest.fn(),
      has: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    relationshipResolverMock = {
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

    configService = mocks.configService;
    jwtService = mocks.jwtKeysService;
    llmTrackingService = mocks.llmTrackingService;
    llmTrackingService.recordPromptResponse.mockResolvedValue('tracking-id');

    // Setup default API key behavior
    jwtService.getToken.mockReturnValue('test-api-key');

    service = module.get<MastraClientService>(MastraClientService);
  });

  describe('executeAgent', () => {
    it('should execute agent successfully with valid request', async () => {
      // Arrange
      const mockRequest = createMockAgentRequest();
      // Use the actual Mastra API response format
      const mockMastraResponse = {
        success: true,
        data: {
          text: 'Agent execution completed successfully',
          summary: 'Did stuff',
        },
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockMastraResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(mockMastraResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      // Create test schema
      const testSchema = z
        .object({
          summary: z.string(),
        })
        .passthrough() as z.ZodType<
        import('../mastra-client.service').AgentResponseShape
      >;

      // Act
      const result = await service.executeAgent(mockRequest, testSchema);

      // Assert
      expect(result).toMatchObject({
        executionId: expect.stringMatching(/^mastra-\d+-\w+$/),
        status: 'completed',
        result: {
          agentId: mockRequest.agentId,
          data: {
            text: 'Agent execution completed successfully',
            summary: 'Did stuff',
          },
          confidence: 0.9,
        },
        executionTime: expect.any(Number),
      });
      expect(fetch).toHaveBeenCalledWith(
        `https://api.mastra.ai/${encodeURIComponent(mockRequest.agentId)}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
            'User-Agent': 'hey-hey-api/1.0',
          }),
          body: JSON.stringify({
            messages: mockRequest.messages,
            temperature: mockRequest.temperature,
            maxExecutionTime: mockRequest.maxExecutionTime,
          }),
        }),
      );

      expect(jwtService.getToken).toHaveBeenCalledWith(
        {
          organizationId: mockRequest.context.organizationId,
          projectId: mockRequest.context.projectId,
        },
        { expiresIn: '1h' },
      );

      expect(llmTrackingService.recordPromptResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'mastra',
          model: mockRequest.agentId,
          prompt: expect.stringContaining('Test message content'),
          success: true,
          organizationId: mockRequest.context.organizationId,
        }),
      );
    });

    it('should execute agent with structured input payload', async () => {
      const structuredRequest = {
        agentId: testIds.agentId,
        requestId: 'req-structured-001',
        input: {
          activeSection: { name: 'Context', content: 'Current section body' },
          taskBrief: {
            task: 'EDIT_ACTIVE_SECTION',
            activeSection: 'Context',
          },
        },
        context: createMockAgentRequest().context,
        maxExecutionTime: 120000,
        temperature: 0.4,
      } as const;

      const mockMastraResponse = {
        success: true,
        data: {
          text: 'Structured run complete',
          summary: 'Structured summary',
        },
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockMastraResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(mockMastraResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      const schema = z
        .object({ summary: z.string() })
        .passthrough() as z.ZodType<
        import('../mastra-client.service').AgentResponseShape
      >;

      const result = await service.executeAgentStructured(
        structuredRequest,
        schema,
      );

      expect(result.status).toBe('completed');
      expect(fetch).toHaveBeenCalledWith(
        `https://api.mastra.ai/${encodeURIComponent(structuredRequest.agentId)}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            ...structuredRequest.input,
            temperature: structuredRequest.temperature,
            maxExecutionTime: structuredRequest.maxExecutionTime,
          }),
        }),
      );

      expect(jwtService.getToken).toHaveBeenCalledWith(
        {
          organizationId: structuredRequest.context.organizationId,
          projectId: structuredRequest.context.projectId,
        },
        { expiresIn: '1h' },
      );
    });

    it('should throw error for invalid agent request', async () => {
      // Arrange
      const invalidRequest = {
        agentId: '', // Invalid empty agentId
        requestId: 'req-invalid-001',
        context: createMockAgentRequest().context,
      } as MastraAgentRequest;

      // Act & Assert
      await expect(
        service.executeAgent(
          invalidRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(/Invalid agent request: agentId:/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should throw error for invalid agent ID format', async () => {
      // Arrange
      const invalidRequest = createMockAgentRequest({
        agentId: 'invalid@agent$id', // Contains invalid characters
      });

      // Act & Assert
      await expect(
        service.executeAgent(
          invalidRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(
        'Invalid agent request: agentId: Agent ID must contain only alphanumeric characters, hyphens, and underscores',
      );
    });

    it('should handle API error responses', async () => {
      // Arrange
      const mockRequest = createMockAgentRequest();
      const mockFetchResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid agent configuration'),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      // Act & Assert
      await expect(
        service.executeAgent(
          mockRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(/Mastra\.ai API error: 400 Bad Request/);

      expect(llmTrackingService.recordPromptResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'mastra',
          model: mockRequest.agentId,
          success: false,
          errorType: 'NON_RETRYABLE',
        }),
      );
    });

    it('should handle timeout errors', async () => {
      // Arrange
      const mockRequest = createMockAgentRequest({
        maxExecutionTime: 1000,
      });

      (fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('The operation was aborted due to timeout'),
      );

      // Act & Assert
      await expect(
        service.executeAgent(
          mockRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(
        'Agent execution failed: The operation was aborted due to timeout (Type: TIMEOUT)',
      );
    });

    it('should validate and reject invalid response format', async () => {
      // Arrange
      const mockRequest = createMockAgentRequest();
      const invalidResponse = {
        // Missing required fields like success, data
        status: 'completed',
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(invalidResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(invalidResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      // Act & Assert
      await expect(
        service.executeAgent(
          mockRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(/Invalid Mastra API response format/);
    });

    it('tracks usage and cost on invalid response format failures', async () => {
      const mockRequest = createMockAgentRequest();
      const invalidResponseWithUsage = {
        status: 'completed',
        usage: {
          promptTokens: 210,
          completionTokens: 140,
          totalTokens: 350,
          estimatedCostUsd: 0.0145,
        },
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(invalidResponseWithUsage),
        text: jest
          .fn()
          .mockResolvedValue(JSON.stringify(invalidResponseWithUsage)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      await expect(
        service.executeAgent(
          mockRequest,
          z.object({ summary: z.string() }).passthrough() as z.ZodType<{
            summary: string;
            [key: string]: unknown;
          }> as z.ZodType<
            import('../mastra-client.service').AgentResponseShape
          >,
        ),
      ).rejects.toThrow(/Invalid Mastra API response format/);

      expect(llmTrackingService.recordPromptResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: mockRequest.requestId,
          provider: 'mastra',
          model: mockRequest.agentId,
          success: false,
          promptTokens: 210,
          completionTokens: 140,
          totalTokens: 350,
          totalCost: 0.0145,
        }),
      );
    });

    it('stores serializable validation metadata for union schema failures', async () => {
      const mockRequest = createMockAgentRequest();
      const invalidUnionResponse = {
        success: true,
        data: {
          unexpected: true,
        },
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(invalidUnionResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(invalidUnionResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      const unionSchema = z.union([
        z.object({
          mode: z.literal('planning'),
        }),
        z.object({
          messages: z.array(z.string()),
        }),
      ]) as z.ZodType<import('../mastra-client.service').AgentResponseShape>;

      await expect(
        service.executeAgent(mockRequest, unionSchema),
      ).rejects.toThrow(/Invalid agent response data/);

      const validationTrackingCall =
        llmTrackingService.recordPromptResponse.mock.calls.find(
          ([payload]) => payload.errorType === 'VALIDATION_ERROR',
        );

      expect(validationTrackingCall).toBeDefined();
      const trackedMetadata = validationTrackingCall?.[0].metadata as
        | Record<string, unknown>
        | undefined;
      expect(trackedMetadata).toBeDefined();
      expect(trackedMetadata).toEqual(
        expect.objectContaining({
          validationSummary: expect.any(Object),
          validationIssues: expect.arrayContaining([
            expect.objectContaining({
              code: expect.any(String),
              path: expect.any(String),
              message: expect.any(String),
            }),
          ]),
        }),
      );
      expect(() => JSON.stringify(trackedMetadata)).not.toThrow();
    });

    it('accepts direct response format when data wrapper is missing', async () => {
      const mockRequest = createMockAgentRequest();
      const directResponse = {
        status: 'suspended',
        runId: 'run-123',
        clarifyingQuestions: ['Question 1?'],
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(directResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(directResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      const response = await service.executeAgent(
        mockRequest,
        z.object({
          status: z.literal('suspended'),
          runId: z.string(),
          clarifyingQuestions: z.array(z.string()),
        }) as z.ZodType<import('../mastra-client.service').AgentResponseShape>,
      );

      expect(response.result?.data).toEqual(directResponse);
    });

    it('should calculate execution time from API call', async () => {
      // Arrange
      const mockRequest = createMockAgentRequest();
      const mockMastraResponse = {
        success: true,
        data: {
          text: 'Agent execution completed successfully',
          summary: 'Did stuff',
        },
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };

      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockMastraResponse),
        text: jest.fn().mockResolvedValue(JSON.stringify(mockMastraResponse)),
      } as Partial<Response>;

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(
        mockFetchResponse as Response,
      );

      // Mock Date.now to simulate actual execution time
      const mockDateNow = jest.spyOn(Date, 'now');
      mockDateNow
        .mockReturnValueOnce(500) // Outer executeAgent start time
        .mockReturnValueOnce(1000) // executeAgentInternal start time capture
        .mockReturnValueOnce(1500) // End time for executionTime calculation
        .mockReturnValue(1500); // Subsequent calls (e.g., executionId generation)

      // Create test schema
      const testSchema = z
        .object({
          summary: z.string(),
        })
        .passthrough() as z.ZodType<
        import('../mastra-client.service').AgentResponseShape
      >;

      // Act
      const result = await service.executeAgent(mockRequest, testSchema);

      // Assert
      expect(result.executionTime).toBe(500);
      expect(typeof result.executionTime).toBe('number');

      // Cleanup
      mockDateNow.mockRestore();
    });
  });

  describe('classifyError', () => {
    it('should classify timeout errors correctly', () => {
      // Use reflection to access private method
      const classifyError = (
        service as unknown as { classifyError: (error: unknown) => string }
      ).classifyError.bind(service);

      expect(classifyError(new Error('Request timeout'))).toBe('TIMEOUT');
      expect(classifyError(new Error('Operation aborted'))).toBe('TIMEOUT');
    });

    it('should classify rate limit errors correctly', () => {
      const classifyError = (
        service as unknown as { classifyError: (error: unknown) => string }
      ).classifyError.bind(service);

      expect(classifyError(new Error('Rate limit exceeded'))).toBe(
        'RATE_LIMITED',
      );
      expect(classifyError(new Error('HTTP 429 Too Many Requests'))).toBe(
        'RATE_LIMITED',
      );
    });

    it('should classify authentication errors as non-retryable', () => {
      const classifyError = (
        service as unknown as { classifyError: (error: unknown) => string }
      ).classifyError.bind(service);

      expect(classifyError(new Error('Authentication failed'))).toBe(
        'NON_RETRYABLE',
      );
      expect(classifyError(new Error('HTTP 401 Unauthorized'))).toBe(
        'NON_RETRYABLE',
      );
      expect(classifyError(new Error('HTTP 403 Forbidden'))).toBe(
        'NON_RETRYABLE',
      );
    });

    it('should classify server errors as retryable', () => {
      const classifyError = (
        service as unknown as { classifyError: (error: unknown) => string }
      ).classifyError.bind(service);

      expect(classifyError(new Error('HTTP 500 Internal Server Error'))).toBe(
        'RETRYABLE',
      );
      expect(classifyError(new Error('HTTP 503 Service Unavailable'))).toBe(
        'RETRYABLE',
      );
    });

    it('should default to retryable for unknown errors', () => {
      const classifyError = (
        service as unknown as { classifyError: (error: unknown) => string }
      ).classifyError.bind(service);

      expect(classifyError(new Error('Unknown network error'))).toBe(
        'RETRYABLE',
      );
      expect(classifyError('Non-error object')).toBe('RETRYABLE');
    });
  });

  describe('circuit breaker methods', () => {
    it('should generate correct circuit breaker key', () => {
      const key = service.getCircuitBreakerKey(
        testIds.agentId,
        testIds.organization,
      );
      expect(key).toBe(`agent_${testIds.agentId}_${testIds.organization}`);
    });
  });

  describe('validateAgentConfig', () => {
    it('should validate valid agent configuration', () => {
      const validMessages = [
        { role: 'user' as const, content: 'Test message' },
      ];
      expect(() => {
        service.validateAgentConfig(testIds.agentId, validMessages, {
          key: 'value',
        });
      }).not.toThrow();
    });

    it('should throw error for invalid agent ID', () => {
      const validMessages = [
        { role: 'user' as const, content: 'Test message' },
      ];
      expect(() => {
        service.validateAgentConfig('', validMessages);
      }).toThrow('Agent ID must be a non-empty string');

      expect(() => {
        service.validateAgentConfig(null as unknown as string, validMessages);
      }).toThrow('Agent ID must be a non-empty string');
    });

    it('should throw error for invalid messages', () => {
      expect(() => {
        service.validateAgentConfig(testIds.agentId, [] as const);
      }).toThrow('Agent messages must be a non-empty array');

      expect(() => {
        service.validateAgentConfig(
          testIds.agentId,
          null as unknown as never[],
        );
      }).toThrow('Agent messages must be a non-empty array');
    });

    it('should throw error for invalid context', () => {
      const validMessages = [
        { role: 'user' as const, content: 'Test message' },
      ];
      expect(() => {
        service.validateAgentConfig(
          testIds.agentId,
          validMessages,
          null as unknown as Record<string, unknown>,
        );
      }).toThrow('Agent context must be an object');

      expect(() => {
        service.validateAgentConfig(
          testIds.agentId,
          validMessages,
          'not an object' as unknown as Record<string, unknown>,
        );
      }).toThrow('Agent context must be an object');
    });

    it('should warn about large context size', () => {
      const loggerSpy = jest.spyOn(
        (service as unknown as { logger: Logger }).logger,
        'warn',
      );
      const validMessages = [
        { role: 'user' as const, content: 'Test message' },
      ];
      const largeContext = { data: 'x'.repeat(100001) }; // > 100KB

      service.validateAgentConfig(testIds.agentId, validMessages, largeContext);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large agent payload detected'),
      );
    });
  });

  describe('configuration and initialization', () => {
    it('should initialize with default values when config missing', () => {
      configService.get.mockImplementation(
        (key: string, defaultValue?: unknown) => defaultValue,
      );

      const newService = new MastraClientService(
        configService,
        jwtService,
        llmTrackingService,
        relationshipResolverMock,
      );

      expect(configService.get).toHaveBeenCalledWith(
        'MASTRA_BASE_URL',
        'https://api.mastra.ai',
      );
      expect(configService.get).toHaveBeenCalledWith('MASTRA_TIMEOUT', 300000);
    });

    it('coerces numeric string config values to numbers', () => {
      configService.get.mockImplementation(
        (key: string, defaultValue?: unknown) => {
          const configMap: Record<string, unknown> = {
            MASTRA_BASE_URL: 'https://api.mastra.ai',
            MASTRA_TIMEOUT: '300000',
            MASTRA_CIRCUIT_BREAKER_THRESHOLD: '5',
            MASTRA_MAX_CONCURRENT_EXECUTIONS: '10',
          };
          return configMap[key] ?? defaultValue;
        },
      );

      const newService = new MastraClientService(
        configService,
        jwtService,
        llmTrackingService,
        relationshipResolverMock,
      );

      expect((newService as unknown as { timeout: unknown }).timeout).toBe(
        300000,
      );
      expect(
        (newService as unknown as { circuitBreakerThreshold: unknown })
          .circuitBreakerThreshold,
      ).toBe(5);
      expect(
        (newService as unknown as { maxConcurrentExecutions: unknown })
          .maxConcurrentExecutions,
      ).toBe(10);
    });
  });

  describe('getJwt', () => {
    const getJwt = () =>
      (
        service as unknown as {
          getJwt: (
            organizationId: string,
            projectId: string,
          ) => Promise<string>;
        }
      ).getJwt.bind(service);

    it('should return JWT when available', async () => {
      jwtService.getToken.mockReturnValueOnce('signed-token');

      const token = await getJwt()(testIds.organization, testIds.project);

      expect(token).toBe('signed-token');
      expect(jwtService.getToken).toHaveBeenCalledWith(
        { organizationId: testIds.organization, projectId: testIds.project },
        { expiresIn: '1h' },
      );
    });

    it('should throw when JWT service returns falsy value', async () => {
      jwtService.getToken.mockReturnValueOnce('');

      await expect(
        getJwt()(testIds.organization, testIds.project),
      ).rejects.toThrow(
        `Failed to get API key for organization ${testIds.organization}: Mastra API key is unavailable`,
      );
    });

    it('should surface underlying errors', async () => {
      jwtService.getToken.mockImplementationOnce(() => {
        throw new Error('signing failed');
      });

      await expect(
        getJwt()(testIds.organization, testIds.project),
      ).rejects.toThrow(
        `Failed to get API key for organization ${testIds.organization}: signing failed`,
      );
    });
  });
});
