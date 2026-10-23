import { MachineConnectionEvictionService } from '../machine-connection-eviction.service';

describe('MachineConnectionEvictionService', () => {
  const machineId = '11111111-1111-4111-8111-111111111111';

  function setup() {
    let messageHandler:
      | ((channel: string, payload: string) => void)
      | undefined;
    const subscriber = {
      on: jest.fn(
        (
          _event: string,
          handler: (channel: string, payload: string) => void,
        ) => {
          messageHandler = handler;
        },
      ),
      subscribe: jest.fn().mockResolvedValue(1),
      removeListener: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const publisher = {
      duplicate: jest.fn().mockReturnValue(subscriber),
      publish: jest.fn().mockResolvedValue(2),
    };
    const redis = { getClient: jest.fn().mockReturnValue(publisher) };
    const connections = {
      forceDisconnectMachine: jest.fn().mockReturnValue(1),
    };
    const service = new MachineConnectionEvictionService(
      redis as any,
      connections as any,
    );
    return {
      service,
      publisher,
      subscriber,
      connections,
      emitMessage: (channel: string, payload: string) =>
        messageHandler?.(channel, payload),
    };
  }

  it('disconnects locally and broadcasts a machine eviction', async () => {
    const { service, publisher, connections } = setup();

    await service.onModuleInit();
    await expect(service.evictMachine(machineId as any)).resolves.toBe(1);

    expect(connections.forceDisconnectMachine).toHaveBeenCalledWith(machineId);
    expect(publisher.publish).toHaveBeenCalledWith(
      'hey-hey:websockets:machine-eviction',
      machineId,
    );
  });

  it('applies a valid eviction received from another replica', async () => {
    const { service, connections, emitMessage } = setup();
    await service.onModuleInit();

    emitMessage('hey-hey:websockets:machine-eviction', machineId);

    expect(connections.forceDisconnectMachine).toHaveBeenCalledWith(machineId);
  });

  it('rejects malformed machine identifiers from Redis', async () => {
    const { service, connections, emitMessage } = setup();
    await service.onModuleInit();

    emitMessage('hey-hey:websockets:machine-eviction', 'not-an-id');

    expect(connections.forceDisconnectMachine).not.toHaveBeenCalled();
  });
});
