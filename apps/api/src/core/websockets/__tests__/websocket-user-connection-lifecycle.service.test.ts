import { Socket } from 'socket.io';
import { UserId } from '../../../types';
import { WebsocketUserConnectionLifecycleService } from '../websocket-user-connection-lifecycle.service';
import { WebsocketUserConnectionRegistration } from '../websocket-user-connection-lifecycle.service';

describe('WebsocketUserConnectionLifecycleService', () => {
  let service: WebsocketUserConnectionLifecycleService;
  const sockets: Socket[] = [];

  const makeSocket = (id: string): Socket => {
    const socket = {
      id,
      disconnected: false,
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
    sockets.push(socket);
    return socket;
  };

  const context = (
    overrides: Record<string, unknown> = {},
  ): WebsocketUserConnectionRegistration => ({
    userId: 'user-1' as UserId,
    expiresAt: new Date(Date.now() + 10_000),
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    service = new WebsocketUserConnectionLifecycleService();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      service.unregister(socket.id);
    }
    jest.useRealTimers();
  });

  it.each([
    ['missing', { expiresAt: undefined }],
    ['invalid', { expiresAt: 'not-a-date' }],
    ['expired', { expiresAt: new Date(Date.now() - 1) }],
  ])(
    'rejects a %s lifecycle context without retaining state',
    (_case, overrides) => {
      const socket = makeSocket('socket-1');

      expect(() => service.register(socket, context(overrides))).toThrow();
      expect(service.hasRegistration(socket.id)).toBe(false);
    },
  );

  it('disconnects at expiry with the generic typed terminal acknowledgement', () => {
    const socket = makeSocket('socket-1');
    service.register(
      socket,
      context({ expiresAt: new Date(Date.now() + 1_000) }),
    );

    jest.advanceTimersByTime(1_001);

    expect(socket.emit).toHaveBeenCalledWith('authenticated', {
      status: 'error',
      reason: 'authentication_required',
      message: 'Authentication required',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(service.hasRegistration(socket.id)).toBe(false);
  });

  it('replaces a duplicate registration and only the replacement timer can close the socket', () => {
    const socket = makeSocket('socket-1');
    service.register(
      socket,
      context({ expiresAt: new Date(Date.now() + 1_000) }),
    );
    service.register(
      socket,
      context({ expiresAt: new Date(Date.now() + 2_000) }),
    );

    jest.advanceTimersByTime(1_100);
    expect(socket.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(900);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clears registration and timer on disconnect cleanup', () => {
    const socket = makeSocket('socket-1');
    service.register(socket, context());

    service.unregister(socket.id);
    jest.advanceTimersByTime(20_000);

    expect(service.hasRegistration(socket.id)).toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('invalidates only matching session-bound sockets', () => {
    const matching = makeSocket('matching');
    const unrelated = makeSocket('unrelated');
    const unbound = makeSocket('unbound');
    service.register(matching, context({ sessionId: 'session-1' }));
    service.register(unrelated, context({ sessionId: 'session-2' }));
    service.register(unbound, context());

    expect(service.invalidateSession('session-1')).toBe(1);

    expect(matching.disconnect).toHaveBeenCalledWith(true);
    expect(unrelated.disconnect).not.toHaveBeenCalled();
    expect(unbound.disconnect).not.toHaveBeenCalled();
  });

  it('invalidates older authorization versions for the matching user only', () => {
    const stale = makeSocket('stale');
    const current = makeSocket('current');
    const unbound = makeSocket('unbound');
    const otherUser = makeSocket('other-user');
    service.register(stale, context({ authorizationVersion: 1 }));
    service.register(current, context({ authorizationVersion: 2 }));
    service.register(unbound, context());
    service.register(
      otherUser,
      context({ userId: 'user-2', authorizationVersion: 1 }),
    );

    expect(service.invalidateAuthorizationVersion('user-1' as UserId, 2)).toBe(
      1,
    );

    expect(stale.disconnect).toHaveBeenCalledWith(true);
    expect(current.disconnect).not.toHaveBeenCalled();
    expect(unbound.disconnect).not.toHaveBeenCalled();
    expect(otherUser.disconnect).not.toHaveBeenCalled();
  });

  it('invalidates every browser socket for a user without affecting another user', () => {
    const first = makeSocket('first');
    const second = makeSocket('second');
    const unrelated = makeSocket('unrelated');
    service.register(first, context());
    service.register(second, context({ sessionId: 'session-2' }));
    service.register(unrelated, context({ userId: 'user-2' }));

    expect(service.invalidateUser('user-1' as UserId)).toBe(2);

    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.disconnect).toHaveBeenCalledWith(true);
    expect(unrelated.disconnect).not.toHaveBeenCalled();
  });

  it('cleans up an already-disconnected socket without emitting or disconnecting again', () => {
    const socket = makeSocket('socket-1');
    (socket as unknown as { disconnected: boolean }).disconnected = true;
    expect(service.register(socket, context())).toBe(false);

    expect(service.invalidateUser('user-1' as UserId)).toBe(0);

    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(service.hasRegistration(socket.id)).toBe(false);
  });
});
