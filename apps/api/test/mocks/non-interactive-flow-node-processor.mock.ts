import { NonInteractiveFlowNodeProcessor } from '../../src/core/processing/non-interactive-flow-node-processor.service';

export function createNonInteractiveFlowNodeProcessorMock() {
  return {
    provide: NonInteractiveFlowNodeProcessor,
    useValue: {
      processNonInteractiveFlowNode: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock non-interactive flow node processed',
      }),
    },
  };
}
