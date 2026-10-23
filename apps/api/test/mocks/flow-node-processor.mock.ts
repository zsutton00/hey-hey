import { FlowNodeProcessor } from '../../src/core/processing/flow-node-processor.service';

export function createFlowNodeProcessorMock() {
  return {
    provide: FlowNodeProcessor,
    useValue: {
      requiresLLM: jest.fn().mockReturnValue(false),
      processFlowNode: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock flow node processed',
      }),
      completeLLMNode: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock LLM node completed',
      }),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    },
  };
}
