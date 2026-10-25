describe('websocket gateway startup dependencies', () => {
  it.each([
    '../../../services/agent-session.service',
    '../websocket.gateway',
    '../websockets.module',
  ])(
    'resolves gateway dependencies when %s loads first',
    async (entryPoint) => {
      await jest.isolateModulesAsync(async () => {
        require(entryPoint);
        const { Test } = require('@nestjs/testing');
        const { WebsocketGateway } = require('../websocket.gateway');
        const {
          AgentSessionService,
        } = require('../../../services/agent-session.service');
        const dependencies = [
          ...Reflect.getMetadata('design:paramtypes', WebsocketGateway),
        ];
        for (const { index, param } of Reflect.getMetadata(
          'self:paramtypes',
          WebsocketGateway,
        ) ?? []) {
          dependencies[index] = param;
        }
        expect(
          dependencies[6]?.forwardRef
            ? dependencies[6].forwardRef()
            : dependencies[6],
        ).toBe(AgentSessionService);
        const module = await Test.createTestingModule({
          providers: [WebsocketGateway],
        })
          .useMocker(() => ({}))
          .compile();
        try {
          expect(module.get(WebsocketGateway).agentSessionService).toBe(
            module.get(AgentSessionService),
          );
        } finally {
          await module.close();
        }
      });
    },
  );
});
