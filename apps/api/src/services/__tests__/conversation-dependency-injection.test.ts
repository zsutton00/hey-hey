describe('conversation workflow dependency injection', () => {
  it.each([
    '../message.service',
    '../conversation.service',
    '../reports/report.service',
    '../workflows/flow-execution.service',
  ])('resolves the service cycle when %s loads first', async (entryPoint) => {
    await jest.isolateModulesAsync(async () => {
      require(entryPoint);
      const { Test } = require('@nestjs/testing');
      const { ConfigService } = require('@nestjs/config');
      const { ConversationService } = require('../conversation.service');
      const { MessageService } = require('../message.service');
      const { ReportService } = require('../reports/report.service');
      const {
        FlowExecutionService,
      } = require('../workflows/flow-execution.service');
      const module = await Test.createTestingModule({
        providers: [
          ConversationService,
          MessageService,
          ReportService,
          FlowExecutionService,
        ],
      })
        .useMocker((token: unknown) =>
          token === ConfigService ? { get: jest.fn() } : {},
        )
        .compile();
      try {
        expect(module.get(ConversationService).messageService).toBe(
          module.get(MessageService),
        );
        expect(module.get(MessageService).reportService).toBe(
          module.get(ReportService),
        );
        expect(module.get(ReportService).flowExecutionService).toBe(
          module.get(FlowExecutionService),
        );
        expect(module.get(FlowExecutionService).conversationService).toBe(
          module.get(ConversationService),
        );
      } finally {
        await module.close();
      }
    });
  });
});
