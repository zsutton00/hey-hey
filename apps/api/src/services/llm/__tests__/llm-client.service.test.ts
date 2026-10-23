import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../../types';
import { FlowUserMessage } from '../../../types/flow-internal.types';
import { ClassificationClientService } from '../../classification/classification-client.service';
import { uiElementSchema } from '../../../flows/utils/shared-schemas';
import z from 'zod';
import { LLMClientService } from '../llm-client.service';
import {
  ALL_MODEL_TIERS,
  ClaudeModel,
  LLMProviderName,
  OpenAIModel,
  SyntheticModel,
} from '../llm-shared';
import type { LLMCallOptions, ModelSelectionCriteria } from '../llm-types';
import { LLMTrackingService } from '../llm-tracking.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../utils/testUtils';

// Mock fetch globally
global.fetch = jest.fn();

describe('LLMClientService', () => {
  let service: LLMClientService;
  let providerMock: {
    callStructured: jest.Mock;
    streamStructured: jest.Mock;
  };
  let llmTrackingService: LLMTrackingService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockClassificationClientService = {
    isEnabled: jest.fn().mockReturnValue(false),
    classify: jest.fn(),
  };

  const mockLLMResponse = {
    content: [{ text: JSON.stringify({ text: 'Mock response content' }) }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
    id: 'test-request-id',
  };

  const mockAnalysisData = {
    type: 'QUESTIONS',
    response: 'Test analysis response',
    detectedIntent: 'test_intent',
    intentConfidence: 0.9,
    questions: [] as string[],
    initialUnderstanding: {
      projectType: 'test_project',
      complexity: 'medium',
      keyTerms: ['test'],
    },
    uiElements: [] as string[],
  };

  const defaultResponseSchema = z.object({}).passthrough();
  const analysisResponseSchema = z
    .object({
      type: z.string().optional(),
      response: z.string().optional(),
    })
    .passthrough();
  const streamingResponseSchema = z
    .object({
      response: z.string().optional(),
      otherField: z.boolean().optional(),
      arrayField: z
        .array(
          z.object({
            subField: z.string().optional(),
          }),
        )
        .optional(),
    })
    .passthrough();
  const localStructuredSchema = z
    .object({
      type: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough();

  const baseConfig: Record<string, unknown> = {
    LLM_EXTERNAL: false,
    LLM_SERVICE_URL: 'http://test-llm:3001',
    CLAUDE_API_KEY: 'test-api-key',
    LLM_TIMEOUT: 120000,
    LLM_LOCAL_ENABLED: false,
    LLM_LOCAL_URL: 'http://localhost:11434',
    LLM_LOCAL_MODEL: 'llama3.2:3b',
    OPENAI_API_KEY: 'openai-api-key',
    SYNTHETIC_CLAUDE_API_KEY: 'synthetic-api-key',
    SYNTHETIC_BASE_URL_OPENAI: 'https://api.synthetic.new/openai/v1',
    SYNTHETIC_BASE_URL_ANTHROPIC: 'https://api.synthetic.new/anthropic',
    SYNTHETIC_MODEL: 'hf:deepseek-ai/DeepSeek-V3.2',
  };

  const defaultSource = {
    organizationId: 'org-1' as OrganizationId,
    workflowId: 'wf-1' as WorkflowId,
    projectId: 'proj-1' as ProjectId,
    conversationId: 'conv-1' as ConversationId,
    nodeId: 'node-1',
    nodeType: 'test-node',
    requestId: 'req-1',
  };

  const buildService = async (
    configOverrides: Record<string, unknown> = {},
  ) => {
    const config = { ...baseConfig, ...configOverrides };
    mockConfigService.get.mockImplementation(
      (key: string, defaultValue?: unknown) => config[key] ?? defaultValue,
    );

    const setup = await createServiceTestingModule({
      providers: [LLMClientService, ClassificationClientService],
      overrides: [
        [DOMAIN_EVENT_PUBLISHER_TOKEN, { publish: jest.fn() }],
        [ConfigService, mockConfigService],
        [ClassificationClientService, mockClassificationClientService],
      ],
    });

    const llmTrackingService = setup.mocks.llmTrackingService;
    llmTrackingService.recordPromptStart.mockResolvedValue(
      'tracking-id-1' as any,
    );
    llmTrackingService.finalizePromptResponse.mockResolvedValue(
      undefined as any,
    );
    llmTrackingService.recordPromptResponse.mockResolvedValue(undefined as any);

    const baseProviderResponse = {
      content: { text: 'Mock response content' },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      costData: {
        model: ClaudeModel.CLAUDE_4_HAIKU_5,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputCost: 0.1,
        outputCost: 0.2,
        totalCost: 0.3,
      },
      requestId: 'mock-request-id',
    };

    const providerMock = {
      callStructured: jest.fn().mockResolvedValue(baseProviderResponse),
      streamStructured: jest.fn().mockResolvedValue({
        content: { response: 'streamed' },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        requestId: 'stream-id',
      }),
    };

    const serviceInstance =
      setup.module.get<LLMClientService>(LLMClientService);
    (serviceInstance as any).providers = new Map([
      [LLMProviderName.CLAUDE, providerMock],
      [LLMProviderName.OPENAI, providerMock],
      [LLMProviderName.SYNTHETIC, providerMock],
      [LLMProviderName.LOCAL, providerMock],
    ]);

    return {
      service: serviceInstance,
      llmTrackingService,
      providerMock,
    };
  };

  const localBaseConfig = {
    ...baseConfig,
    LLM_PROVIDER: 'local',
    LLM_LOCAL_ENABLED: 'true',
    LLM_LOCAL_URL: 'http://localhost:11434',
    LLM_LOCAL_MODEL: 'llama3.2:3b',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();

    ({ service, providerMock, llmTrackingService } = await buildService());

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  describe('Model Selection Helpers', () => {
    describe('selectModelByCriteria', () => {
      it('should select model by Anthropic tier', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        };
        const model = LLMClientService.selectModelByCriteria(criteria);
        expect(model).toBe(ClaudeModel.CLAUDE_4_HAIKU_5);
      });

      it('should select model by OpenAI tier', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.OPENAI,
          openaiTier: 'mini',
        };
        const model = LLMClientService.selectModelByCriteria(criteria);
        expect(model).toBe(OpenAIModel.GPT_5_MINI);
      });

      it('should select model by explicit model', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.OPENAI,
          model: OpenAIModel.GPT_5_1_CODEX,
        };
        const model = LLMClientService.selectModelByCriteria(criteria);
        expect(model).toBe(OpenAIModel.GPT_5_1_CODEX);
      });

      it('should reject provider/model mismatches', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.CLAUDE,
          model: OpenAIModel.GPT_5_MINI,
        };
        expect(() => LLMClientService.selectModelByCriteria(criteria)).toThrow(
          'does not match provider',
        );
      });

      it('should reject criteria that exceed cost constraints', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.OPENAI,
          openaiTier: 'nano',
          maxInputCostPer1M: 0.01,
        };
        expect(() => LLMClientService.selectModelByCriteria(criteria)).toThrow(
          'maxInputCostPer1M',
        );
      });

      it('should require explicit model selection for synthetic provider', () => {
        const criteria: ModelSelectionCriteria = {
          provider: LLMProviderName.SYNTHETIC,
        };
        expect(() => LLMClientService.selectModelByCriteria(criteria)).toThrow(
          'Synthetic provider requires explicit model selection',
        );
      });
    });

    describe('calculateCost', () => {
      it('should calculate cost correctly for Claude 4 Haiku', () => {
        const cost = LLMClientService.calculateCost(
          ClaudeModel.CLAUDE_4_HAIKU_5,
          1000000,
          500000,
        );
        const tier = ALL_MODEL_TIERS[ClaudeModel.CLAUDE_4_HAIKU_5];
        const expectedInput =
          (1_000_000 / 1_000_000) * tier.inputCostPer1M +
          ((tier.cachedInputCostPer1M ?? 0) * 0) / 1_000_000;
        const expectedOutput = (500_000 / 1_000_000) * tier.outputCostPer1M;

        expect(cost.model).toBe(ClaudeModel.CLAUDE_4_HAIKU_5);
        expect(cost.inputTokens).toBe(1000000);
        expect(cost.outputTokens).toBe(500000);
        expect(cost.totalTokens).toBe(1500000);
        expect(cost.inputCost).toBeCloseTo(expectedInput);
        expect(cost.outputCost).toBeCloseTo(expectedOutput);
        expect(cost.totalCost).toBeCloseTo(expectedInput + expectedOutput);
      });

      it('should calculate cost correctly for Claude 4 Sonnet', () => {
        const cost = LLMClientService.calculateCost(
          ClaudeModel.CLAUDE_4_SONNET_6,
          100000,
          50000,
        );

        expect(cost.inputCost).toBeCloseTo(0.3, 2); // 0.1M * $3.0/1M
        expect(cost.outputCost).toBeCloseTo(0.75, 2); // 0.05M * $15.0/1M
        expect(cost.totalCost).toBeCloseTo(1.05, 2);
      });

      it('should calculate cost correctly for small token amounts', () => {
        const cost = LLMClientService.calculateCost(
          ClaudeModel.CLAUDE_4_HAIKU_5,
          1000,
          500,
        );
        const tier = ALL_MODEL_TIERS[ClaudeModel.CLAUDE_4_HAIKU_5];
        const expectedInput = (1000 / 1_000_000) * tier.inputCostPer1M;
        const expectedOutput = (500 / 1_000_000) * tier.outputCostPer1M;

        expect(cost.inputCost).toBeCloseTo(expectedInput);
        expect(cost.outputCost).toBeCloseTo(expectedOutput);
        expect(cost.totalCost).toBeCloseTo(expectedInput + expectedOutput);
      });
    });

    it('should infer synthetic provider from hf model naming', () => {
      expect(
        service['inferProviderFromModel']('hf:deepseek-ai/DeepSeek-V3.2'),
      ).toBe(LLMProviderName.SYNTHETIC);
    });
  });

  describe('Unified callStructured() method', () => {
    beforeEach(() => {
      // Mock successful fetch response
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLLMResponse),
      });
    });

    it('should make LLM call with model criteria for Anthropic tier', async () => {
      const options: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        },
        temperature: 0.7,
        maxTokens: 1000,
        responseSchema: defaultResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      expect(response.content).toEqual({ text: 'Mock response content' });
      expect(response.usage?.promptTokens).toBe(100);
      expect(response.usage?.completionTokens).toBe(50);
      expect(response.costData?.model).toBe(ClaudeModel.CLAUDE_4_HAIKU_5);
      expect(response.costData?.totalCost).toBeGreaterThan(0);
    });

    it('forwards a mock session only when routing and provider base URL are explicit', async () => {
      const mockSetup = await buildService({
        LLM_PROVIDER: 'claude',
        NODE_ENV: 'test',
        MOCK_LLM_SESSION_ROUTING_ENABLED: 'true',
        MOCK_LLM_SERVER_URL: 'http://127.0.0.1:3001',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3001',
        OPENAI_BASE_URL: 'http://127.0.0.1:3001/v1',
      });

      await mockSetup.service.callStructured(
        'Test prompt',
        { responseSchema: defaultResponseSchema },
        {
          ...defaultSource,
          mockLlmSessionId:
            '9db93370-808f-4bba-a38c-84c72cd35937' as import('../../../types').MockLlmSessionId,
        },
      );

      expect(mockSetup.providerMock.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          mockLlmSessionId: '9db93370-808f-4bba-a38c-84c72cd35937',
        }),
      );
    });

    it('does not forward a mock session to a real provider base URL', async () => {
      const realSetup = await buildService({
        LLM_PROVIDER: 'claude',
        NODE_ENV: 'test',
        MOCK_LLM_SESSION_ROUTING_ENABLED: 'true',
        MOCK_LLM_SERVER_URL: 'http://127.0.0.1:3001',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      });

      await realSetup.service.callStructured(
        'Test prompt',
        { responseSchema: defaultResponseSchema },
        {
          ...defaultSource,
          mockLlmSessionId:
            '9db93370-808f-4bba-a38c-84c72cd35937' as import('../../../types').MockLlmSessionId,
        },
      );

      expect(realSetup.providerMock.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ mockLlmSessionId: undefined }),
      );
    });

    it('should make LLM call with model criteria', async () => {
      const options: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.OPENAI,
          openaiTier: 'mini',
        },
        temperature: 0.5,
        responseSchema: defaultResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      expect(response.content).toEqual({ text: 'Mock response content' });
      expect(llmTrackingService.recordPromptStart).toHaveBeenCalledWith(
        expect.objectContaining({
          model: OpenAIModel.GPT_5_MINI,
        }),
      );
    });

    it('should use default model when no model or criteria specified', async () => {
      const response = await service.callStructured(
        'Test prompt',
        {
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(response.content).toEqual({ text: 'Mock response content' });
      expect(response.costData?.model).toBeDefined();
    });

    it('should use configured synthetic model when provider is synthetic', async () => {
      const syntheticSetup = await buildService({
        LLM_PROVIDER: 'synthetic',
        SYNTHETIC_LLM_API_KEY: 'synthetic-llm-api-key',
      });
      const syntheticService = syntheticSetup.service;
      const syntheticProviderMock = syntheticSetup.providerMock;

      await syntheticService.callStructured(
        'Test prompt',
        {
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(syntheticProviderMock.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model: 'hf:deepseek-ai/DeepSeek-V3.2',
        }),
        expect.any(Object),
      );
    });

    it('forwards synthetic tuning options to provider calls', async () => {
      await service.callStructured(
        'Test prompt',
        {
          modelCriteria: {
            provider: LLMProviderName.SYNTHETIC,
            model: SyntheticModel.KIMI_K2_5,
          },
          temperature: 0.1,
          topP: 0.9,
          reasoningEffort: 'low',
          responseFormat: null,
          maxTokens: 5000,
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(providerMock.callStructured).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model: SyntheticModel.KIMI_K2_5,
          temperature: 0.1,
          topP: 0.9,
          reasoningEffort: 'low',
          responseFormat: null,
          maxTokens: 5000,
        }),
        expect.any(Object),
      );
    });

    it('should calculate cost data when provider omits it', async () => {
      providerMock.callStructured.mockResolvedValueOnce({
        content: { text: 'Response without cost data' },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        costData: undefined,
        requestId: 'no-cost-id',
      });

      const options: LLMCallOptions = {
        model: ClaudeModel.CLAUDE_4_HAIKU_5,
        responseSchema: defaultResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      const expectedCost = LLMClientService.calculateCost(
        ClaudeModel.CLAUDE_4_HAIKU_5,
        100,
        50,
      );

      expect(response.costData).toEqual(expectedCost);
      expect(llmTrackingService.finalizePromptResponse).toHaveBeenCalledWith(
        'tracking-id-1',
        expect.objectContaining({
          inputCost: expectedCost.inputCost,
          outputCost: expectedCost.outputCost,
          totalCost: expectedCost.totalCost,
        }),
      );
    });

    it('should handle analysis response type', async () => {
      // Mock response that returns JSON
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockLLMResponse,
            content: [{ text: JSON.stringify(mockAnalysisData) }],
          }),
      });

      const options: LLMCallOptions = {
        responseType: 'analysis',
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'sonnet',
        },
        responseSchema: analysisResponseSchema,
      };

      providerMock.callStructured.mockResolvedValueOnce({
        content: mockAnalysisData,
        usage: mockLLMResponse.usage,
        costData: {
          model: ClaudeModel.CLAUDE_4_SONNET_6,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputCost: 0.1,
          outputCost: 0.2,
          totalCost: 0.3,
        },
        requestId: 'analysis-id',
      });

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      expect(response.content).toEqual(mockAnalysisData);
      expect(response.usage).toBeDefined();
      expect(response.costData).toBeDefined();
    });

    it('should handle "hey hey" mocking in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const userMessage: FlowUserMessage = TestUtils.createMockFlowUserMessage({
        data: { message: 'hey hey test' },
      });

      const options: LLMCallOptions = {
        responseType: 'analysis',
        userMessage,
        responseSchema: analysisResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      // Should return mock data - in development mode with "hey hey" in message
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should emit progress as soon as structured fields become complete', async () => {
      const onProgress = jest.fn();

      (service as unknown as { isExternal: boolean }).isExternal = true;
      (service as unknown as { baseUrl: string }).baseUrl = 'http://test-llm';
      (service as unknown as { apiKey: string }).apiKey = 'test-api-key';

      const encoder = new TextEncoder();
      const fragments = [
        '{ "response": "hey ',
        'that\'s great",',
        '\n  "otherField": t',
        'rue,\n  "arrayField": [{ "subField": ',
        '"hey" }, { "sub',
        'Field": "there" }]}',
      ];

      const sseChunks = fragments.map((fragment) =>
        encoder.encode(`data: ${fragment}\n\n`),
      );

      let readIndex = 0;
      const reader = {
        read: jest.fn().mockImplementation(async () => {
          if (readIndex < sseChunks.length) {
            return { value: sseChunks[readIndex++], done: false };
          }

          if (readIndex === sseChunks.length) {
            readIndex++;
            return { value: encoder.encode('data: [DONE]\n\n'), done: false };
          }

          return { value: undefined, done: true };
        }),
        releaseLock: jest.fn(),
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: {
          getReader: () => reader,
        },
      });

      providerMock.streamStructured.mockImplementationOnce(
        (_req, _opts, handler) => {
          handler({ response: "hey that's great" } as any);
          handler({ otherField: true } as any);
          handler({
            arrayField: [{ subField: 'hey' }, { subField: 'there' }],
          } as any);

          return Promise.resolve({
            content: {
              response: "hey that's great",
              otherField: true,
              arrayField: [{ subField: 'hey' }, { subField: 'there' }],
            },
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          });
        },
      );

      const response = await service.callStructured(
        'Test prompt',
        {
          stream: true,
          onProgress,
          responseSchema: streamingResponseSchema,
        },
        defaultSource,
      );

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ response: "hey that's great" }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ otherField: true }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          arrayField: [{ subField: 'hey' }, { subField: 'there' }],
        }),
      );

      expect(response.content).toEqual({
        response: "hey that's great",
        otherField: true,
        arrayField: [{ subField: 'hey' }, { subField: 'there' }],
      });
    });

    it('should validate streaming structured responses against schema', async () => {
      const onProgress = jest.fn();
      const responseSchema = z.object({
        response: z.string(),
        uiElements: z.array(uiElementSchema),
      });

      const validElement: z.infer<typeof uiElementSchema> = {
        id: 'ui-1',
        type: 'textarea',
        label: 'First question',
        influences: [] as z.infer<typeof uiElementSchema>['influences'],
      };

      const streamSpy = jest
        .spyOn(service as any, 'streamWithResponseSchema')
        .mockImplementation(async (_req, opts: any) => {
          const firstSnapshot = { response: 'Hello there' };
          opts.onProgress?.(
            { field: 'response', value: 'Hello there' } as any,
            {
              response: 'Hello there',
            } as any,
          );

          const secondSnapshot = {
            response: 'Hello there',
            uiElements: [validElement],
          };
          opts.onProgress?.(
            {
              field: 'uiElements',
              index: 0,
              value: validElement,
            } as any,
            secondSnapshot as any,
          );

          return {
            content: secondSnapshot,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          };
        });

      const response = await service.callStructured(
        'Test prompt',
        {
          stream: true,
          onProgress,
          responseSchema,
        },
        defaultSource,
      );

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(
        1,
        { field: 'response', value: 'Hello there' },
        { response: 'Hello there' },
      );
      expect(onProgress).toHaveBeenNthCalledWith(
        2,
        {
          field: 'uiElements',
          index: 0,
          value: validElement,
        },
        {
          response: 'Hello there',
          uiElements: [validElement],
        },
      );

      expect(response.content).toEqual({
        response: 'Hello there',
        uiElements: [validElement],
      });

      streamSpy.mockRestore();
    });

    it('should handle API errors gracefully', async () => {
      providerMock.callStructured.mockRejectedValueOnce(
        new Error('Rate Limited'),
      );

      await expect(
        service.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow();
    });

    it('should handle invalid JSON in analysis response', async () => {
      providerMock.callStructured.mockRejectedValueOnce(
        new Error('Claude returned invalid JSON response'),
      );

      const options: LLMCallOptions = {
        responseType: 'analysis',
        responseSchema: analysisResponseSchema,
      };

      await expect(
        service.callStructured('Test prompt', options, defaultSource),
      ).rejects.toThrow('Claude returned invalid JSON response');
    });

    it('should finalize tracking with usage and cost on provider validation failures', async () => {
      const validationError = Object.assign(new Error('Validation failed'), {
        responseContent: '{"invalid":true}',
        validationErrors: [
          {
            code: 'custom',
            message: 'Bad shape',
            path: ['field'],
          },
        ],
        requestId: 'validation-failure-id',
        usage: {
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
        },
      });

      providerMock.callStructured.mockRejectedValueOnce(validationError);

      const options: LLMCallOptions = {
        model: ClaudeModel.CLAUDE_4_HAIKU_5,
        responseSchema: analysisResponseSchema,
      };

      await expect(
        service.callStructured('Test prompt', options, defaultSource),
      ).rejects.toThrow('Validation failed');

      const expectedCost = LLMClientService.calculateCost(
        ClaudeModel.CLAUDE_4_HAIKU_5,
        120,
        80,
      );

      expect(llmTrackingService.finalizePromptResponse).toHaveBeenCalledWith(
        'tracking-id-1',
        expect.objectContaining({
          requestId: 'validation-failure-id',
          responseContent: '{"invalid":true}',
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
          inputCost: expectedCost.inputCost,
          outputCost: expectedCost.outputCost,
          totalCost: expectedCost.totalCost,
          success: false,
          errorType: 'VALIDATION_ERROR',
          metadata: {
            validationErrors: validationError.validationErrors,
          },
        }),
      );
    });

    it('should use specific model criteria for tiered selection', async () => {
      const options: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'opus',
        },
        responseSchema: defaultResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      expect(response.costData).toBeDefined();
    });
  });

  describe('Cost tracking integration', () => {
    beforeEach(() => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLLMResponse),
      });
    });

    it('should include cost data in all responses', async () => {
      const options: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.OPENAI,
          openaiTier: 'nano',
        },
        responseSchema: defaultResponseSchema,
      };

      const response = await service.callStructured(
        'Test prompt',
        options,
        defaultSource,
      );

      expect(response.costData).toBeDefined();
      expect(response.costData?.inputTokens).toBe(100);
      expect(response.costData?.outputTokens).toBe(50);
      expect(response.costData?.totalCost).toBeGreaterThan(0);
    });

    it('should calculate costs for different models correctly', async () => {
      const expensiveOptions: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'opus',
        },
        responseSchema: defaultResponseSchema,
      };

      const cheapOptions: LLMCallOptions = {
        modelCriteria: {
          provider: LLMProviderName.CLAUDE,
          anthropicTier: 'haiku',
        },
        responseSchema: defaultResponseSchema,
      };

      providerMock.callStructured
        .mockResolvedValueOnce({
          content: { text: 'expensive' },
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          costData: {
            model: ClaudeModel.CLAUDE_4_SONNET_6,
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            inputCost: 1,
            outputCost: 1,
            totalCost: 2,
          },
          requestId: 'expensive',
        })
        .mockResolvedValueOnce({
          content: { text: 'cheap' },
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          costData: {
            model: ClaudeModel.CLAUDE_4_HAIKU_5,
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            inputCost: 0.05,
            outputCost: 0.05,
            totalCost: 0.1,
          },
          requestId: 'cheap',
        });

      const expensiveResponse = await service.callStructured(
        'Test prompt',
        expensiveOptions,
        defaultSource,
      );
      const cheapResponse = await service.callStructured(
        'Test prompt',
        cheapOptions,
        defaultSource,
      );

      expect(expensiveResponse.costData?.totalCost).toBeGreaterThan(
        cheapResponse.costData?.totalCost || 0,
      );
    });
  });

  describe('Error handling', () => {
    it('should handle network timeouts', async () => {
      providerMock.callStructured.mockRejectedValueOnce(
        new Error('Network timeout'),
      );

      await expect(
        service.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow('Network timeout');
    });

    it('should handle malformed API responses', async () => {
      providerMock.callStructured.mockRejectedValueOnce(
        new Error('Invalid JSON'),
      );

      await expect(
        service.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow();
    });

    it('should handle missing usage data gracefully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { text: JSON.stringify({ text: 'Response without usage data' }) },
            ],
            id: 'test-id',
          }),
      });

      providerMock.callStructured.mockResolvedValueOnce({
        content: { text: 'Response without usage data' },
        usage: undefined,
        costData: undefined,
        requestId: 'no-usage',
      });

      const response = await service.callStructured(
        'Test prompt',
        {
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(response.content).toEqual({ text: 'Response without usage data' });
      expect(response.costData).toBeUndefined();
    });
  });

  describe('Local LLM Integration', () => {
    const mockLocalLLMResponse = {
      response: 'Local LLM test response',
      prompt_eval_count: 25,
      eval_count: 15,
      total_duration: 1500000000,
      load_duration: 1000000000,
    };

    beforeEach(() => {
      // Reset environment variable
      delete process.env.NODE_ENV;
    });

    it('should route to local LLM when enabled', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService(localBaseConfig);

      localProviderMock.callStructured.mockResolvedValueOnce({
        content: 'Local LLM test response',
        usage: {
          promptTokens: 25,
          completionTokens: 15,
          totalTokens: 40,
        },
        requestId: 'local-response',
      });

      const response = await localService.callStructured(
        'Test prompt',
        {
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(response.content).toBe('Local LLM test response');
      expect(response.usage).toEqual({
        promptTokens: 25,
        completionTokens: 15,
        totalTokens: 40,
      });
    });

    it('should handle local LLM server unavailable', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService(localBaseConfig);

      localProviderMock.callStructured.mockRejectedValueOnce(
        new Error('Local LLM server connection refused - server may be down'),
      );

      await expect(
        localService.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow(
        'Local LLM server connection refused - server may be down',
      );
    });

    it('should handle local LLM timeout', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService({
          ...localBaseConfig,
          LLM_LOCAL_TIMEOUT: 1000,
        });

      // Mock fetch to simulate abort signal being triggered
      (fetch as jest.Mock).mockImplementation(
        (url: string, options: any) =>
          new Promise((resolve, reject) => {
            const abortListener = () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            };

            if (options?.signal) {
              options.signal.addEventListener('abort', abortListener);
            }

            // Never resolve, let the timeout trigger the abort
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve({ response: 'slow response' }),
              });
            }, 2000); // Longer than timeout to ensure abort happens
          }),
      );

      localProviderMock.callStructured.mockRejectedValueOnce(
        new Error('Local LLM request timeout'),
      );

      await expect(
        localService.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow('Local LLM request timeout');
    });

    it('should handle local LLM model not found', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService({
          ...localBaseConfig,
          LLM_LOCAL_MODEL: 'nonexistent-model',
        });

      localProviderMock.callStructured.mockRejectedValueOnce(
        new Error(
          "Local LLM model 'nonexistent-model' not found - invalid model name",
        ),
      );

      await expect(
        localService.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow(
        "Local LLM model 'nonexistent-model' not found - invalid model name",
      );
    });

    it('should validate local LLM response format', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService(localBaseConfig);

      localProviderMock.callStructured.mockRejectedValueOnce(
        new Error('Invalid response from local LLM: missing response field'),
      );

      await expect(
        localService.callStructured(
          'Test prompt',
          {
            responseSchema: defaultResponseSchema,
          },
          defaultSource,
        ),
      ).rejects.toThrow(
        'Invalid response from local LLM: missing response field',
      );
    });

    it('should prevent local LLM in production', () => {
      process.env.NODE_ENV = 'production';

      return expect(buildService(localBaseConfig)).rejects.toThrow(
        'Local LLM cannot be enabled in production environments',
      );
    });

    it('should use external providers when local LLM is disabled', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService({
          ...baseConfig,
          LLM_LOCAL_ENABLED: false,
        });

      const response = await localService.callStructured(
        'Test prompt',
        {
          responseSchema: defaultResponseSchema,
        },
        defaultSource,
      );

      expect(localProviderMock.callStructured).toHaveBeenCalled();

      expect(response.content).toEqual({ text: 'Mock response content' });
    });
  });

  describe('Local LLM Configuration Validation', () => {
    beforeEach(() => {
      // Reset environment variable
      delete process.env.NODE_ENV;
    });

    it('should require URL when local LLM is enabled', () => {
      return expect(
        buildService({
          ...localBaseConfig,
          LLM_LOCAL_URL: '',
        }),
      ).rejects.toThrow('LLM_LOCAL_URL is required when using local provider');
    });

    it('should require model when local LLM is enabled', () => {
      return expect(
        buildService({
          ...localBaseConfig,
          LLM_LOCAL_MODEL: '',
        }),
      ).rejects.toThrow(
        'LLM_LOCAL_MODEL is required when using local provider',
      );
    });

    it('should validate URL format', () => {
      return expect(
        buildService({
          ...localBaseConfig,
          LLM_LOCAL_URL: 'invalid-url',
        }),
      ).rejects.toThrow(
        'Invalid LLM_LOCAL_URL: invalid-url. Must be a valid URL',
      );
    });

    it('should validate timeout range', () => {
      return expect(
        buildService({
          ...localBaseConfig,
          LLM_LOCAL_TIMEOUT: 999,
        }),
      ).rejects.toThrow(
        'LLM_LOCAL_TIMEOUT must be between 1000ms and 600000ms',
      );
    });

    it('should allow valid configuration', () => {
      return expect(
        buildService({
          ...localBaseConfig,
          LLM_LOCAL_TIMEOUT: 60000,
        }),
      ).resolves.toBeDefined();
    });

    it('should parse JSON wrapped in code blocks', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService(localBaseConfig);

      localProviderMock.callStructured.mockResolvedValueOnce({
        content: { type: 'QUESTIONS', message: 'Test response' },
        usage: { promptTokens: 25, completionTokens: 15, totalTokens: 40 },
        requestId: 'json-block',
      });

      const response = await localService.callStructured(
        'Test prompt',
        {
          responseSchema: localStructuredSchema,
        },
        defaultSource,
      );

      // Should have the JSON extracted from code blocks and parsed
      expect(response.content).toEqual({
        type: 'QUESTIONS',
        message: 'Test response',
      });
      expect(response.usage).toEqual({
        promptTokens: 25,
        completionTokens: 15,
        totalTokens: 40,
      });
    });

    it('should parse reasoning models with <think> blocks', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService({
          ...localBaseConfig,
          LLM_LOCAL_MODEL: 'qwen3:30b',
        });

      localProviderMock.callStructured.mockResolvedValueOnce({
        content: { type: 'QUESTIONS', message: 'Actual response' },
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        requestId: 'think-block',
      });

      const response = await localService.callStructured(
        'Test prompt',
        {
          responseSchema: localStructuredSchema,
        },
        defaultSource,
      );

      // Should have the JSON extracted after removing think block
      expect(response.content).toEqual({
        type: 'QUESTIONS',
        message: 'Actual response',
      });
      expect(response.usage).toEqual({
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
      });
    });

    it('should handle reasoning models with only <think> blocks (no content after)', async () => {
      const { service: localService, providerMock: localProviderMock } =
        await buildService({
          ...localBaseConfig,
          LLM_LOCAL_MODEL: 'qwen3:30b',
        });

      localProviderMock.callStructured.mockResolvedValueOnce({
        content: {
          type: 'QUESTIONS',
          message: 'Response inside think block',
        },
        usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        requestId: 'think-only',
      });

      const response = await localService.callStructured(
        'Test prompt',
        {
          responseSchema: localStructuredSchema,
        },
        defaultSource,
      );

      // Should extract content from inside think block when no content follows
      expect(response.content).toEqual({
        type: 'QUESTIONS',
        message: 'Response inside think block',
      });
      expect(response.usage).toEqual({
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50,
      });
    });
  });
});
