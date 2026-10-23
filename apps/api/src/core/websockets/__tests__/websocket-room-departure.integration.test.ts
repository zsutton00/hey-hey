import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';
import { UserId, ConversationId } from '../../../types';

describe('Socket.IO departure isolation', () => {
  it('stops departed-room delivery while retained rooms and rejoining still work', async () => {
    const http = createServer();
    const server = new Server(http);
    const manager = new WebsocketConnectionManager();
    server.on('connection', (socket) => {
      void manager.addConnection(
        socket,
        'user' as UserId,
        [],
        [],
        ['departed', 'retained'] as ConversationId[],
        [],
        [],
        'browser',
      );
      socket.on(
        'leave',
        async (_request: unknown, ack: (value: unknown) => void) => {
          await manager.serializeRoomOperation(socket.id, () =>
            manager.leaveRoom(socket.id, {
              roomType: 'conversation',
              roomId: 'departed',
            }),
          );
          ack({ status: 'success' });
          server.to('conversation:departed').emit('probe', 'departed');
          server.to('conversation:retained').emit('probe', 'retained');
        },
      );
      socket.on('rejoin', async () => {
        await manager.addConversationSubscription(
          socket.id,
          'departed' as ConversationId,
        );
        server.to('conversation:departed').emit('probe', 'rejoined');
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing listening address');
    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`,
    );
    const received: string[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        client.addEventListener('error', () =>
          reject(new Error('Socket connection failed')),
        );
        client.addEventListener('message', (event) => {
          const packet = String(event.data);
          if (packet.startsWith('0')) client.send('40');
          else if (packet.startsWith('40')) client.send('420["leave",{}]');
          else if (packet.startsWith('430')) received.push('ack');
          else if (packet === '42["probe","retained"]') {
            received.push('retained');
            client.send('42["rejoin"]');
          } else if (packet === '42["probe","departed"]')
            received.push('departed');
          else if (packet === '42["probe","rejoined"]') {
            received.push('rejoined');
            resolve();
          }
        });
      });
      expect(received).toEqual(['ack', 'retained', 'rejoined']);
    } finally {
      client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10000);
  it.each(['browser', 'cli'] as const)(
    'stops revoked project and child delivery for a %s socket',
    async (clientType) => {
      const http = createServer();
      const server = new Server(http);
      const manager = new WebsocketConnectionManager();
      server.on('connection', (socket) => {
        const registered = manager.addConnection(
          socket,
          'alice' as UserId,
          [],
          ['revoked', 'retained'] as never,
          ['revoked-child'] as ConversationId[],
          [],
          [],
          clientType,
        );
        socket.on('revoke', async () => {
          await registered;
          await manager.revalidateRooms(
            async (_connection, room) => room.id === 'retained',
            'alice',
          );
          server.to('project:revoked').emit('probe', 'private-project');
          server
            .to('conversation:revoked-child')
            .emit('probe', 'private-child');
          server.to('project:retained').emit('probe', 'retained');
        });
      });
      await new Promise<void>((resolve) =>
        http.listen(0, '127.0.0.1', resolve),
      );
      const address = http.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing listening address');
      const client = new WebSocket(
        `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`,
      );
      const received: string[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          client.addEventListener('error', () =>
            reject(new Error('Socket connection failed')),
          );
          client.addEventListener('message', (event) => {
            const packet = String(event.data);
            if (packet.startsWith('0')) client.send('40');
            else if (packet.startsWith('40')) client.send('42["revoke"]');
            else if (packet.startsWith('42["probe"')) {
              received.push(JSON.parse(packet.slice(2))[1]);
              if (received.at(-1) === 'retained') resolve();
            }
          });
        });
        expect(received).toEqual(['retained']);
      } finally {
        client.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    10000,
  );
});
