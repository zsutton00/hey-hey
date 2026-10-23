import { Socket } from 'socket.io';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';

describe('WebsocketConnectionManager.hasCliConnectionForUser', () => {
  function fakeSocket(id: string, disconnected = false): Socket {
    return {
      id,
      disconnected,
      join: jest.fn(),
    } as unknown as Socket;
  }

  it('returns false when no connections are registered', () => {
    const manager = new WebsocketConnectionManager();

    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(false);
  });

  it('returns false when only browser connections exist for the user', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1'),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'browser',
      undefined,
    );

    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(false);
  });

  it('returns false when a CLI connection exists but for a different user', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1'),
      'user-2' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
    );

    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(false);
  });

  it('returns true when a CLI connection matches the user', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1'),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'browser',
      undefined,
    );
    manager.addConnection(
      fakeSocket('s2'),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
      2,
    );

    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(true);
  });
});

describe('WebsocketConnectionManager.addConnection machine room', () => {
  function fakeSocket(id: string): Socket {
    return {
      id,
      disconnected: false,
      join: jest.fn(),
    } as unknown as Socket;
  }

  it('joins the machine room for a verified CLI machine connection', () => {
    const manager = new WebsocketConnectionManager();
    const socket = fakeSocket('s1');
    manager.addConnection(
      socket,
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
      2,
    );

    const joinedRooms = (socket.join as unknown as jest.Mock).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(joinedRooms).toContain('machine:machine-1');
  });

  it('does NOT join the machine room for an unverified CLI cookie-path connection', () => {
    // The cookie path passes clientType 'cli' and a caller-supplied machineId
    // (for cli-status presence) but verifiedMachine defaults to false. It must
    // never join the machine room, or any authenticated socket could subscribe
    // to an arbitrary machine's trigger envelopes without proving the credential.
    const manager = new WebsocketConnectionManager();
    const socket = fakeSocket('s1');
    manager.addConnection(
      socket,
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
    );

    const joinedRooms = (socket.join as unknown as jest.Mock).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(joinedRooms.some((room) => room.startsWith('machine:'))).toBe(false);
  });

  it('does not join any machine room for a browser connection', () => {
    const manager = new WebsocketConnectionManager();
    const socket = fakeSocket('s1');
    manager.addConnection(
      socket,
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'browser',
      undefined,
    );

    const joinedRooms = (socket.join as unknown as jest.Mock).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(joinedRooms.some((room) => room.startsWith('machine:'))).toBe(false);
  });
});

describe('WebsocketConnectionManager.subscribe', () => {
  it('adds dynamically subscribed scope to the authenticated connection', async () => {
    const manager = new WebsocketConnectionManager();
    const join = jest.fn();
    const socket = {
      id: 's1',
      disconnected: false,
      join,
    } as unknown as Socket;
    manager.addConnection(
      socket,
      'user-1' as UserId,
      ['org-1' as OrganizationId],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
    );

    await manager.subscribe(
      's1',
      ['conversation.updated'],
      ['project-1' as ProjectId],
      ['conversation-1' as ConversationId],
      ['initiative-1' as InitiativeId],
      ['design-doc-1' as DesignDocId],
    );

    expect(manager.getConnection('s1')).toEqual(
      expect.objectContaining({
        projectIds: ['project-1'],
        conversationIds: ['conversation-1'],
        initiativeIds: ['initiative-1'],
        designDocIds: ['design-doc-1'],
      }),
    );
    expect(join).toHaveBeenCalledWith('project:project-1');
    expect(join).toHaveBeenCalledWith('conversation:conversation-1');
    expect(join).toHaveBeenCalledWith('initiative:initiative-1');
    expect(join).toHaveBeenCalledWith('design-doc:design-doc-1');
  });

  it('does not duplicate scope when the client repeats its full subscription', () => {
    const manager = new WebsocketConnectionManager();
    const socket = {
      id: 's1',
      disconnected: false,
      join: jest.fn(),
    } as unknown as Socket;
    manager.addConnection(
      socket,
      'user-1' as UserId,
      ['org-1' as OrganizationId],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
    );

    manager.subscribe(
      's1',
      ['conversation.updated'],
      ['project-1' as ProjectId],
    );
    manager.subscribe(
      's1',
      ['conversation.updated'],
      ['project-1' as ProjectId],
    );

    expect(manager.getConnection('s1')?.projectIds).toEqual(['project-1']);
  });
});

describe('WebsocketConnectionManager.resetAuthorizationState', () => {
  it('leaves every authorization-controlled room while retaining the transport', async () => {
    const manager = new WebsocketConnectionManager();
    const socket = {
      id: 's1',
      disconnected: false,
      join: jest.fn(),
      leave: jest.fn().mockResolvedValue(undefined),
    } as unknown as Socket;

    manager.addConnection(
      socket,
      'user-1' as UserId,
      ['org-1' as OrganizationId],
      ['project-1' as ProjectId],
      ['conversation-1' as ConversationId],
      ['initiative-1' as InitiativeId],
      ['design-doc-1' as DesignDocId],
      'browser',
    );

    await manager.resetAuthorizationState('s1');

    expect(
      (socket.leave as jest.Mock).mock.calls.map(([room]) => room),
    ).toEqual(
      expect.arrayContaining([
        'organization:org-1',
        'project:project-1',
        'conversation:conversation-1',
        'initiative:initiative-1',
        'design-doc:design-doc-1',
        'user:user-1',
      ]),
    );
    expect(socket.leave).not.toHaveBeenCalledWith('s1');
    expect(manager.getConnection('s1')).toBeUndefined();
  });
});

describe('WebsocketConnectionManager.forceDisconnectMachine', () => {
  function fakeSocket(id: string): Socket {
    return {
      id,
      disconnected: false,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
  }

  it('force-closes every live socket bound to the machine and counts them', () => {
    const manager = new WebsocketConnectionManager();
    const s1 = fakeSocket('s1');
    const s2 = fakeSocket('s2');
    const other = fakeSocket('s3');

    manager.addConnection(
      s1,
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
    );
    manager.addConnection(
      s2,
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
    );
    manager.addConnection(
      other,
      'user-2' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-2' as MachineId,
      true,
    );

    const closed = manager.forceDisconnectMachine('machine-1' as MachineId);

    expect(closed).toBe(2);
    expect((s1.disconnect as jest.Mock).mock.calls).toHaveLength(1);
    expect((s2.disconnect as jest.Mock).mock.calls).toHaveLength(1);
    // A different machine's socket is untouched.
    expect((other.disconnect as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('returns 0 when no connection is bound to the machine', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1'),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
    );

    expect(manager.forceDisconnectMachine('machine-2' as MachineId)).toBe(0);
  });
});

describe('WebsocketConnectionManager.forceDisconnectOrganization', () => {
  function fakeSocket(id: string): Socket {
    return {
      id,
      disconnected: false,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
  }

  it('disconnects only sockets scoped to the closed organization', () => {
    const manager = new WebsocketConnectionManager();
    const closedSocket = fakeSocket('closed-socket');
    const unrelatedSocket = fakeSocket('unrelated-socket');
    manager.addConnection(closedSocket, undefined, [
      'closed-organization' as any,
    ]);
    manager.addConnection(unrelatedSocket, undefined, [
      'unrelated-organization' as any,
    ]);

    expect(
      manager.forceDisconnectOrganization('closed-organization' as any),
    ).toBe(1);
    expect(closedSocket.disconnect).toHaveBeenCalledWith(true);
    expect(unrelatedSocket.disconnect).not.toHaveBeenCalled();
  });
});

describe('WebsocketConnectionManager.cleanupInactiveConnections', () => {
  function fakeSocket(id: string, disconnected = false): Socket {
    return {
      id,
      disconnected,
      join: jest.fn(),
    } as unknown as Socket;
  }

  it('keeps a still-connected CLI connection so presence is never orphaned', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1', false),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
      true,
      2,
    );

    manager.cleanupInactiveConnections();

    // The transport socket is still alive, so the connection must survive the
    // sweep even though it has had no application-level activity — otherwise a
    // long-lived idle CLI would be reported as disconnected.
    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(true);
  });

  it('removes a connection whose socket has disconnected', () => {
    const manager = new WebsocketConnectionManager();
    manager.addConnection(
      fakeSocket('s1', true),
      'user-1' as UserId,
      [],
      [],
      [],
      [],
      [],
      'cli',
      'machine-1' as MachineId,
    );

    manager.cleanupInactiveConnections();

    expect(manager.hasCliConnectionForUser('user-1' as UserId)).toBe(false);
  });
});

describe('confirmed browser departure', () => {
  it('awaits the adapter, removes delivery bookkeeping, and permits rejoin', async () => {
    const manager = new WebsocketConnectionManager();
    let finish!: () => void;
    const socket = {
      id: 'departure',
      join: jest.fn(),
      leave: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    } as unknown as Socket;
    const id = 'conversation' as ConversationId;
    await manager.addConnection(
      socket,
      'user' as UserId,
      [],
      [],
      [id],
      [],
      [],
      'browser',
    );
    await manager.subscribe(
      socket.id,
      ['conversation.phase.changed'],
      [],
      [id],
    );
    let settled = false;
    const departure = manager
      .leaveRoom(socket.id, { roomType: 'conversation', roomId: id })
      .then(() => {
        settled = true;
      });
    expect(settled).toBe(false);
    expect(manager.getConversationConnections(id)).toHaveLength(1);
    finish();
    await departure;
    expect(manager.getConversationConnections(id)).toHaveLength(0);
    expect(manager.getSubscription(socket.id)?.conversationIds).toEqual([]);
    await manager.addConversationSubscription(socket.id, id);
    expect(manager.getConversationConnections(id)).toHaveLength(1);
    expect(socket.join).toHaveBeenLastCalledWith('conversation:conversation');
  });

  it('does not mutate a replacement connection after an old leave completes', async () => {
    const manager = new WebsocketConnectionManager();
    let finish!: () => void;
    const socket = {
      id: 'departure',
      join: jest.fn(),
      leave: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    } as unknown as Socket;
    const id = 'project' as ProjectId;
    await manager.addConnection(
      socket,
      'user' as UserId,
      [],
      [id],
      [],
      [],
      [],
      'browser',
    );
    const departure = manager.leaveRoom(socket.id, {
      roomType: 'project',
      roomId: id,
    });
    await manager.addConnection(
      socket,
      'user' as UserId,
      [],
      [id],
      [],
      [],
      [],
      'browser',
    );
    finish();
    await expect(departure).rejects.toThrow('access_denied');
    expect(manager.getProjectConnections(id)).toHaveLength(1);
  });
});

describe('room operation ordering', () => {
  it('does not let departure overtake an asynchronous join', async () => {
    const manager = new WebsocketConnectionManager();
    let finish!: () => void;
    const join = jest.fn((room: string) =>
      room === 'project:project'
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    const leave = jest.fn();
    const socket = { id: 'ordered', join, leave } as unknown as Socket;
    await manager.addConnection(
      socket,
      'user' as UserId,
      [],
      [],
      [],
      [],
      [],
      'browser',
    );
    const admission = manager.serializeRoomOperation(socket.id, () =>
      manager.addProjectSubscription(socket.id, 'project' as ProjectId),
    );
    const departure = manager.serializeRoomOperation(socket.id, () =>
      manager.leaveRoom(socket.id, { roomType: 'project', roomId: 'project' }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(leave).not.toHaveBeenCalled();
    finish();
    await Promise.all([admission, departure]);
    expect(leave).toHaveBeenCalledWith('project:project');
    expect(manager.getProjectConnections('project' as ProjectId)).toHaveLength(
      0,
    );
  });
});

describe('private Open Items room lifecycle', () => {
  it('derives the room user and removes membership on hide, revocation and reauthentication', async () => {
    const socket = {
      id: 'private-socket',
      disconnected: false,
      join: jest.fn(),
      leave: jest.fn(),
    } as unknown as Socket;
    const manager = new WebsocketConnectionManager();
    await manager.addConnection(
      socket,
      'owner' as UserId,
      [],
      [],
      [],
      [],
      [],
      'browser',
    );
    await manager.addOpenItemsSubscription(socket.id, 'project');
    expect(socket.join).toHaveBeenCalledWith('open-items:owner:project');
    await manager.leaveRoom(socket.id, {
      roomType: 'open_items',
      roomId: 'project',
    });
    expect(socket.leave).toHaveBeenCalledWith('open-items:owner:project');
    await manager.addOpenItemsSubscription(socket.id, 'project');
    await manager.revalidateRooms(
      async (_connection, room) => room.kind !== 'project',
    );
    expect(socket.leave).toHaveBeenCalledTimes(2);
    await manager.addOpenItemsSubscription(socket.id, 'project');
    await manager.resetAuthorizationState(socket.id);
    expect(socket.leave).toHaveBeenCalledWith('open-items:owner:project');
  });
});
