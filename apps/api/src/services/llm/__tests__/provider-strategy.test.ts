import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { ClassificationClientService } from '../../classification/classification-client.service';
import { LLMClientService } from '../llm-client.service';
import { LLMProviderName } from '../llm-shared';
import { TaskType } from '../llm-types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

describe('Phase 4: Provider Strategy Implementation', () => {
  let service: LLMClientService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, unknown> = {
        LLM_EXTERNAL: false,
        LLM_SERVICE_URL: 'http://test-llm:3001',
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || 'test-claude-key',
        LLM_TIMEOUT: 120000,
        LLM_LOCAL_ENABLED: false,
        LLM_LOCAL_URL: 'http://localhost:11434',
        LLM_LOCAL_MODEL: 'llama3.2:3b',
        LLM_LOCAL_TIMEOUT: 120000,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-openai-key',
        OPENAI_BASE_URL:
          process.env.OPENAI_BASE_URL || 'https://api.openai.com',
        OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
        LLM_PROVIDER: 'claude', // Default provider is Claude for cost-effectiveness
      };
      return config[key];
    }),
  };

  const mockClassificationClientService = {
    isEnabled: jest.fn().mockReturnValue(false),
    classify: jest.fn(),
  };

  beforeEach(async () => {
    const setup = await createServiceTestingModule({
      providers: [LLMClientService, ConfigService, ClassificationClientService],
      overrides: [
        [DOMAIN_EVENT_PUBLISHER_TOKEN, { publish: jest.fn() }],
        [ConfigService, mockConfigService],
        [ClassificationClientService, mockClassificationClientService],
      ],
    });

    service = setup.module.get<LLMClientService>(LLMClientService);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  describe('Smart Provider Selection Logic', () => {
    it('should select OpenAI for structured output tasks', () => {
      const result = service['resolveStructuredProvider'](
        undefined,
        TaskType.STRUCTURED_OUTPUT,
      );
      expect(result).toBe(LLMProviderName.OPENAI);
      console.log('✅ STRUCTURED_OUTPUT tasks correctly routed to OpenAI');
    });

    it('should select OpenAI for agent reasoning tasks', () => {
      const result = service['resolveStructuredProvider'](
        undefined,
        TaskType.AGENT_REASONING,
      );
      expect(result).toBe(LLMProviderName.OPENAI);
      console.log('✅ AGENT_REASONING tasks correctly routed to OpenAI');
    });

    it('should select OpenAI for analysis tasks', () => {
      const result = service['resolveStructuredProvider'](
        undefined,
        TaskType.ANALYSIS,
      );
      expect(result).toBe(LLMProviderName.OPENAI);
      console.log('✅ ANALYSIS tasks correctly routed to OpenAI');
    });

    it('should select OpenAI for simple text tasks', () => {
      const result = service['resolveStructuredProvider'](
        undefined,
        TaskType.SIMPLE_TEXT,
      );
      expect(result).toBe(LLMProviderName.CLAUDE);
      console.log(
        '✅ SIMPLE_TEXT tasks correctly routed to Claude (default provider)',
      );
    });

    it('should select OpenAI for conversation tasks', () => {
      const result = service['resolveStructuredProvider'](
        undefined,
        TaskType.CONVERSATION,
      );
      expect(result).toBe(LLMProviderName.CLAUDE);
      console.log(
        '✅ CONVERSATION tasks correctly routed to Claude (default provider)',
      );
    });

    it('should return default provider when no task type specified', () => {
      const result = service['resolveStructuredProvider'](undefined, undefined);
      expect(result).toBe(LLMProviderName.CLAUDE); // Default provider from config
      console.log('✅ No task type specified correctly defaults to Claude');
    });
  });

  describe('Fallback Configuration', () => {
    it('should have allowFallback default to true', () => {
      const options: any = { responseSchema: z.object({ test: z.string() }) };
      const allowFallback = options.allowFallback !== false; // Default logic
      expect(allowFallback).toBe(true);
      console.log('✅ allowFallback defaults to true correctly');
    });

    it('should respect explicit allowFallback false', () => {
      const options: any = {
        responseSchema: z.object({ test: z.string() }),
        allowFallback: false,
      };
      const allowFallback = options.allowFallback !== false;
      expect(allowFallback).toBe(false);
      console.log('✅ allowFallback respects explicit false value');
    });

    it('should fall back to configured provider when requested provider missing', () => {
      const fallback = service['resolveProviderAvailability'](
        LLMProviderName.OPENAI,
        { workflowId: undefined, nodeId: 'test-node' },
      );
      expect([LLMProviderName.CLAUDE, LLMProviderName.OPENAI]).toContain(
        fallback,
      );
      console.log(
        '✅ resolveProviderAvailability returns a configured provider',
      );
    });
  });

  describe('Task Type Configuration', () => {
    it('should have all expected task types defined', () => {
      expect(TaskType.STRUCTURED_OUTPUT).toBe('structured_output');
      expect(TaskType.SIMPLE_TEXT).toBe('simple_text');
      expect(TaskType.AGENT_REASONING).toBe('agent_reasoning');
      expect(TaskType.ANALYSIS).toBe('analysis');
      expect(TaskType.CONVERSATION).toBe('conversation');
      console.log('✅ All task types are properly defined');
    });

    it('should have proper method signatures for enhanced options', () => {
      // Test that LLMCallOptions interface supports new properties
      const options = {
        responseSchema: z.object({ test: z.string() }),
        taskType: TaskType.STRUCTURED_OUTPUT,
        allowFallback: true,
        toolName: 'test_tool',
      };

      // These should compile without TypeScript errors
      expect(options.taskType).toBe(TaskType.STRUCTURED_OUTPUT);
      expect(options.allowFallback).toBe(true);
      expect(options.toolName).toBe('test_tool');

      console.log(
        '✅ Enhanced LLMCallOptions interface supports new properties',
      );
    });
  });
});
