import { MessageProcessor } from '../../src/core/processing/message-processor.service';

export function createMessageProcessorMock() {
  return {
    provide: MessageProcessor,
    useValue: {
      processMessage: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock message processed',
      }),
      handleMessageCreated: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock message created',
      }),
      handleMessageUpdated: jest.fn().mockResolvedValue({
        success: true,
        message: 'Mock message updated',
      }),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    },
  };
}
