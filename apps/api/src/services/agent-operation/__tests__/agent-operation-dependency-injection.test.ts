describe('agent operation startup dependencies', () => {
  it.each([
    '../../../core/websockets/agent-operation-dispatch.service',
    '../agent-operation-workflow-answer.service',
    '../agent-operation.module',
    '../../../core/websockets/websockets.module',
    '../agent-operation-submission.service',
  ])('resolves providers when %s loads first', async (entryPoint) => {
    await jest.isolateModulesAsync(async () => {
      require(entryPoint);
      const { Test } = require('@nestjs/testing');
      const { AgentOperationModule } = require('../agent-operation.module');
      const {
        AgentOperationDispatchService,
      } = require('../../../core/websockets/agent-operation-dispatch.service');
      const {
        AgentOperationWorkflowAnswerService,
      } = require('../agent-operation-workflow-answer.service');
      const {
        AgentOperationSubmissionService,
      } = require('../agent-operation-submission.service');
      const providers = [
        ...Reflect.getMetadata('providers', AgentOperationModule),
        AgentOperationDispatchService,
      ];
      const unresolved: string[] = [];
      for (const provider of providers) {
        const dependencies = [
          ...(Reflect.getMetadata('design:paramtypes', provider) ?? []),
        ];
        for (const { index, param } of Reflect.getMetadata(
          'self:paramtypes',
          provider,
        ) ?? []) {
          dependencies[index] = param;
        }
        dependencies.forEach((dependency, index) => {
          const token = dependency?.forwardRef
            ? dependency.forwardRef()
            : dependency;
          if (!token || token === Object)
            unresolved.push(`${provider.name}[${index}]`);
        });
      }
      expect(unresolved).toEqual([]);
      const module = await Test.createTestingModule({ providers })
        .useMocker(() => ({}))
        .compile();
      try {
        expect(
          module.get(AgentOperationWorkflowAnswerService).dispatchService,
        ).toBe(module.get(AgentOperationDispatchService));
        expect(
          module.get(AgentOperationSubmissionService).dispatchService,
        ).toBe(module.get(AgentOperationDispatchService));
      } finally {
        await module.close();
      }
    });
  });
});
