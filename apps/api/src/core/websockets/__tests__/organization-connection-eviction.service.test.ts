import { OrganizationConnectionEvictionService } from '../organization-connection-eviction.service';

describe('OrganizationConnectionEvictionService', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';

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
      forceDisconnectOrganization: jest.fn().mockReturnValue(1),
    };
    const service = new OrganizationConnectionEvictionService(
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

  it('disconnects locally and broadcasts an organization eviction', async () => {
    const { service, publisher, connections } = setup();

    await service.onModuleInit();
    await expect(
      service.evictOrganization(organizationId as any),
    ).resolves.toBe(1);

    expect(connections.forceDisconnectOrganization).toHaveBeenCalledWith(
      organizationId,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      'hey-hey:websockets:organization-eviction',
      organizationId,
    );
  });

  it('applies a valid eviction received from another replica', async () => {
    const { service, connections, emitMessage } = setup();
    await service.onModuleInit();

    emitMessage('hey-hey:websockets:organization-eviction', organizationId);

    expect(connections.forceDisconnectOrganization).toHaveBeenCalledWith(
      organizationId,
    );
  });

  it('rejects malformed organization identifiers from Redis', async () => {
    const { service, connections, emitMessage } = setup();
    await service.onModuleInit();

    emitMessage('hey-hey:websockets:organization-eviction', 'not-an-id');

    expect(connections.forceDisconnectOrganization).not.toHaveBeenCalled();
  });
});
