import { LlmProcessor } from '../../src/core/processing/llm-processor.service';

export function createLlmProcessorMock() {
  return {
    provide: LlmProcessor,
    useValue: {
      processLLMRequest: jest.fn().mockResolvedValue({
        success: true,
        result: {
          content: 'Mock LLM response',
          usage: { tokens: 100 },
        },
      }),
      handleLLMCompletion: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock LLM completion handled',
      }),
      processLLMWorkflow: jest.fn().mockResolvedValue({
        success: true,
        result: {
          content: 'Mock LLM workflow response',
          usage: { tokens: 100 },
        },
      }),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    },
  };
}
