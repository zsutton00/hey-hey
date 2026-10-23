import { Injectable, Logger } from '@nestjs/common';
import type { WebSocketLeaveRoomRequest } from 'src/generated';
import { Socket } from 'socket.io';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import {
  ClientConnection,
  EventSubscription,
} from '../events/types/event.types';

@Injectable()
export class WebsocketConnectionManager {
  private readonly logger = new Logger(WebsocketConnectionManager.name);
  private connections = new Map<string, ClientConnection>();
  private sockets = new Map<string, Socket>();
  private subscriptions = new Map<string, EventSubscription>();

  private openItemsProjects = new Map<string, Set<string>>();

  async addOpenItemsSubscription(
    socketId: string,
    projectId: string,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);
    if (!connection?.userId || !socket || connection.clientType !== 'browser')
      throw new Error('access_denied');
    await socket.join(`open-items:${connection.userId}:${projectId}`);
    if (
      this.connections.get(socketId) !== connection ||
      this.sockets.get(socketId) !== socket ||
      socket.disconnected
    )
      throw new Error('access_denied');
    const projects = this.openItemsProjects.get(socketId) ?? new Set<string>();
    projects.add(projectId);
    this.openItemsProjects.set(socketId, projects);
  }

  private roomOperations = new Map<string, Promise<unknown>>();

  async serializeRoomOperation<T>(
    socketId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queuedAt = Date.now();
    const previous = this.roomOperations.get(socketId);
    this.logger.debug('Room operation queued', {
      socketId,
      waiting: !!previous,
    });
    const pending = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const startedAt = Date.now();
        this.logger.debug('Room operation started', {
          socketId,
          waitMs: startedAt - queuedAt,
        });
        try {
          return await operation();
        } finally {
          this.logger.debug('Room operation settled', {
            socketId,
            durationMs: Date.now() - startedAt,
          });
        }
      });
    this.roomOperations.set(socketId, pending);
    try {
      return await pending;
    } finally {
      if (this.roomOperations.get(socketId) === pending)
        this.roomOperations.delete(socketId);
    }
  }

  async leaveRoom(
    socketId: string,
    request: WebSocketLeaveRoomRequest,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);
    if (
      !connection ||
      !socket ||
      connection.clientType !== 'browser' ||
      !connection.userId
    )
      throw new Error('access_denied');
    if (request.roomType === 'open_items') {
      await socket.leave(`open-items:${connection.userId}:${request.roomId}`);
      if (
        this.connections.get(socketId) !== connection ||
        this.sockets.get(socketId) !== socket ||
        socket.disconnected
      )
        throw new Error('access_denied');
      this.openItemsProjects.get(socketId)?.delete(request.roomId);
      return;
    }
    const field = {
      project: 'projectIds',
      conversation: 'conversationIds',
      initiative: 'initiativeIds',
      design_doc: 'designDocIds',
    } as const;
    const key = field[request.roomType];
    await socket.leave(
      `${request.roomType === 'design_doc' ? 'design-doc' : request.roomType}:${request.roomId}`,
    );
    if (
      this.connections.get(socketId) !== connection ||
      this.sockets.get(socketId) !== socket ||
      socket.disconnected
    )
      throw new Error('access_denied');
    const remove = (ids: string[]) => {
      const index = ids.indexOf(request.roomId);
      if (index !== -1) ids.splice(index, 1);
    };
    remove(connection[key]);
    const subscription = this.subscriptions.get(socketId);
    if (subscription?.[key]) remove(subscription[key]);
  }

  /**
   * Register a new WebSocket connection
   */
  async addConnection(
    socket: Socket,
    userId?: UserId,
    organizationIds: OrganizationId[] = [],
    projectIds: ProjectId[] = [],
    conversationIds: ConversationId[] = [],
    initiativeIds: InitiativeId[] = [],
    designDocIds: DesignDocId[] = [],
    clientType?: 'cli' | 'browser',
    machineId?: MachineId,
    verifiedMachine = false,
    authorizationProtocolVersion: 1 | 2 = 1,
    agentSessionIds: string[] = [],
    taskMonitorIds: string[] = [],
  ): Promise<void> {
    const connection: ClientConnection = {
      id: socket.id,
      userId,
      projectIds,
      organizationIds,
      conversationIds,
      initiativeIds,
      designDocIds,
      clientType,
      machineId,
      verifiedMachine,
      authorizationProtocolVersion,
      agentSessionIds,
      taskMonitorIds,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.connections.set(socket.id, connection);
    this.sockets.set(socket.id, socket);

    const joins: Array<void | Promise<void>> = [];
    // Join organization, project, conversation, and initiative rooms
    organizationIds.forEach((organizationId) => {
      joins.push(socket.join(`organization:${organizationId}`));
    });
    projectIds.forEach((projectId) => {
      joins.push(socket.join(`project:${projectId}`));
    });
    conversationIds.forEach((conversationId) => {
      joins.push(socket.join(`conversation:${conversationId}`));
    });
    initiativeIds.forEach((initiativeId) => {
      joins.push(socket.join(`initiative:${initiativeId}`));
    });
    designDocIds.forEach((designDocId) => {
      joins.push(socket.join(`design-doc:${designDocId}`));
    });

    if (userId) {
      joins.push(socket.join(`user:${userId}`));
    }

    // A verified machine connection (CLI that completed the challenge-response
    // handshake) joins its own `machine:${machineId}` room. Signed trigger
    // frames are addressed exclusively to this room, so only the proven
    // machine receives execution-bearing triggers — UI/browser connections
    // never join it and therefore never receive trigger envelopes. Only the
    // machine-challenge path registers a machineId; the cookie path never
    // does, so a browser socket cannot claim a machine's identity.
    if (verifiedMachine && authorizationProtocolVersion === 2 && machineId) {
      joins.push(socket.join(`machine:${machineId}`));
    }

    await Promise.all(joins);

    this.logger.verbose(`Connection added: ${socket.id}`, {
      userId,
      projectIds,
      conversationIds,
      initiativeIds,
      designDocIds,
      clientType,
      machineId,
    });
  }

  /**
   * Returns true when at least one stored connection belongs to the given
   * user and self-identified as a CLI client at authentication time.
   * Drives the conversation cli-status presence check.
   */
  hasCliConnectionForUser(userId: UserId): boolean {
    const matching = Array.from(this.connections.values()).filter(
      (conn) =>
        conn.clientType === 'cli' &&
        conn.verifiedMachine === true &&
        conn.authorizationProtocolVersion === 2 &&
        conn.userId === userId,
    );
    const connected = matching.length > 0;
    this.logger.verbose('[ConnectionManager] hasCliConnectionForUser', {
      userId,
      matchingConnectionCount: matching.length,
      connected,
    });
    return connected;
  }

  /**
   * Remove a WebSocket connection
   */
  removeConnection(socketId: string): void {
    this.openItemsProjects.delete(socketId);
    const connection = this.connections.get(socketId);
    if (connection) {
      this.connections.delete(socketId);
      this.sockets.delete(socketId);
      this.subscriptions.delete(socketId);

      this.logger.verbose(`Connection removed: ${socketId}`, {
        userId: connection.userId,
        duration: Date.now() - connection.connectedAt.getTime(),
      });
    }
  }

  /**
   * Remove every authorization-controlled room from a live socket before
   * replacing or denying its browser authentication state. Socket.IO room
   * membership survives ordinary map cleanup, so reauthentication must leave
   * the physical rooms explicitly.
   *
   * The socket's private id room is intentionally retained. Machine
   * credential-profile transitions disconnect instead of calling this method
   * so machine presence cleanup remains owned by handleDisconnect.
   * The caller owns serializeRoomOperation for the entire authentication
   * transition. Never await the queue here: it includes that same operation
   * (and may already include later operations waiting for it).
   */
  async resetAuthorizationState(socketId: string): Promise<void> {
    this.logger.debug('Connection authorization reset started', { socketId });
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);

    this.connections.delete(socketId);
    this.sockets.delete(socketId);
    this.subscriptions.delete(socketId);

    if (!connection || !socket) {
      return;
    }

    const openItems = this.openItemsProjects.get(socketId) ?? new Set<string>();
    this.openItemsProjects.delete(socketId);
    const rooms = new Set<string>([
      ...[...openItems].map((id) => `open-items:${connection.userId}:${id}`),
      ...connection.organizationIds.map((id) => `organization:${id}`),
      ...connection.projectIds.map((id) => `project:${id}`),
      ...connection.conversationIds.map((id) => `conversation:${id}`),
      ...connection.initiativeIds.map((id) => `initiative:${id}`),
      ...connection.designDocIds.map((id) => `design-doc:${id}`),
      ...(connection.userId ? [`user:${connection.userId}`] : []),
      ...(connection.machineId ? [`machine:${connection.machineId}`] : []),
    ]);

    await Promise.all(
      Array.from(rooms, async (room) => {
        await socket.leave(room);
      }),
    );

    this.logger.verbose(`Connection authorization reset: ${socketId}`, {
      userId: connection.userId,
      clientType: connection.clientType,
      roomsLeft: rooms.size,
    });
  }

  /**
   * Update connection activity timestamp
   */
  updateActivity(socketId: string): void {
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  /**
   * Subscribe a connection to specific event types
   */
  async subscribe(
    socketId: string,
    eventTypes: string[],
    projectIds?: ProjectId[],
    conversationIds?: ConversationId[],
    initiativeIds?: InitiativeId[],
    designDocIds?: DesignDocId[],
  ): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      this.logger.warn(`Socket not found for subscription: ${socketId}`);
      return;
    }

    const subscription: EventSubscription = {
      connectionId: socketId,
      eventTypes,
      projectIds,
      conversationIds,
      initiativeIds,
      designDocIds,
    };

    this.subscriptions.set(socketId, subscription);

    // Keep the connection's authorized room scope aligned with its dynamic
    // subscription scope. CLI machine authentication intentionally starts
    // without project/conversation ids and attaches them after authentication,
    // so joining Socket.IO rooms without updating the connection record leaves
    // later authorization checks with stale empty scope.
    if (projectIds) {
      for (const projectId of projectIds) {
        await this.addProjectSubscription(socketId, projectId);
      }
    }

    if (conversationIds) {
      for (const conversationId of conversationIds) {
        await this.addConversationSubscription(socketId, conversationId);
      }
    }

    if (initiativeIds) {
      for (const initiativeId of initiativeIds) {
        await this.addInitiativeSubscription(socketId, initiativeId);
      }
    }

    if (designDocIds) {
      for (const designDocId of designDocIds) {
        await this.addDesignDocSubscription(socketId, designDocId);
      }
    }

    this.logger.verbose(`Subscription updated: ${socketId}`, {
      eventTypes,
      projectIds,
      conversationIds,
      initiativeIds,
      designDocIds,
    });
  }

  /**
   * Add a project to a connection's subscriptions
   */
  async addProjectSubscription(
    socketId: string,
    projectId: ProjectId,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);

    if (connection && socket) {
      if (!connection.projectIds.includes(projectId)) {
        connection.projectIds.push(projectId);
        const subscription = this.subscriptions.get(socketId);
        if (subscription) {
          subscription.projectIds ??= [];
          if (!subscription.projectIds.includes(projectId))
            subscription.projectIds.push(projectId);
        }
        await socket.join(`project:${projectId}`);

        this.logger.verbose(
          `Added project subscription: ${socketId} -> ${projectId}`,
        );
      }
    }
  }

  /**
   * Add a conversation to a connection's subscriptions
   */
  async addConversationSubscription(
    socketId: string,
    conversationId: ConversationId,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);

    if (connection && socket) {
      if (!connection.conversationIds.includes(conversationId)) {
        connection.conversationIds.push(conversationId);
        const subscription = this.subscriptions.get(socketId);
        if (subscription) {
          subscription.conversationIds ??= [];
          if (!subscription.conversationIds.includes(conversationId))
            subscription.conversationIds.push(conversationId);
        }
        await socket.join(`conversation:${conversationId}`);

        this.logger.verbose(
          `Added conversation subscription: ${socketId} -> ${conversationId}`,
        );
      }
    }
  }

  /**
   * Add an initiative to a connection's subscriptions
   */
  async addInitiativeSubscription(
    socketId: string,
    initiativeId: InitiativeId,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);

    if (connection && socket) {
      if (!connection.initiativeIds.includes(initiativeId)) {
        connection.initiativeIds.push(initiativeId);
        const subscription = this.subscriptions.get(socketId);
        if (subscription) {
          subscription.initiativeIds ??= [];
          if (!subscription.initiativeIds.includes(initiativeId))
            subscription.initiativeIds.push(initiativeId);
        }
        await socket.join(`initiative:${initiativeId}`);

        this.logger.log('[ConnectionManager] Added initiative subscription', {
          socketId,
          initiativeId,
          channel: `initiative:${initiativeId}`,
          userId: connection.userId,
          totalInitiativeSubscriptions: connection.initiativeIds.length,
        });
      } else {
        this.logger.verbose(
          `Initiative subscription already exists: ${socketId} -> ${initiativeId}`,
        );
      }
    } else {
      this.logger.warn(
        '[ConnectionManager] Cannot add initiative subscription - connection or socket not found',
        {
          socketId,
          initiativeId,
          hasConnection: !!connection,
          hasSocket: !!socket,
        },
      );
    }
  }

  /**
   * Add a design doc to a connection's subscriptions
   */
  async addDesignDocSubscription(
    socketId: string,
    designDocId: DesignDocId,
  ): Promise<void> {
    const connection = this.connections.get(socketId);
    const socket = this.sockets.get(socketId);

    if (connection && socket) {
      if (!connection.designDocIds.includes(designDocId)) {
        connection.designDocIds.push(designDocId);
        const subscription = this.subscriptions.get(socketId);
        if (subscription) {
          subscription.designDocIds ??= [];
          if (!subscription.designDocIds.includes(designDocId))
            subscription.designDocIds.push(designDocId);
        }
        await socket.join(`design-doc:${designDocId}`);

        this.logger.verbose(
          `Added design doc subscription: ${socketId} -> ${designDocId}`,
        );
      }
    }
  }

  /**
   * Get all connections for a specific project
   */
  getProjectConnections(projectId: ProjectId): ClientConnection[] {
    return Array.from(this.connections.values()).filter((conn) =>
      conn.projectIds.includes(projectId),
    );
  }

  /**
   * Get all connections for a specific conversation
   */
  getConversationConnections(
    conversationId: ConversationId,
  ): ClientConnection[] {
    return Array.from(this.connections.values()).filter((conn) =>
      conn.conversationIds.includes(conversationId),
    );
  }

  /**
   * Get all connections for a specific initiative
   */
  getInitiativeConnections(initiativeId: InitiativeId): ClientConnection[] {
    return Array.from(this.connections.values()).filter((conn) =>
      conn.initiativeIds.includes(initiativeId),
    );
  }

  /**
   * Get all connections for a specific design doc
   */
  getDesignDocConnections(designDocId: DesignDocId): ClientConnection[] {
    return Array.from(this.connections.values()).filter((conn) =>
      conn.designDocIds.includes(designDocId),
    );
  }

  /**
   * Get all connections for a specific user
   */
  getUserConnections(userId: UserId): ClientConnection[] {
    return Array.from(this.connections.values()).filter(
      (conn) => conn.userId === userId,
    );
  }

  /**
   * Get connection by socket ID
   */
  getConnection(socketId: string): ClientConnection | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Get socket by ID
   */
  getSocket(socketId: string): Socket | undefined {
    return this.sockets.get(socketId);
  }

  async revalidateRooms(
    authorize: (
      connection: ClientConnection,
      room: { kind: string; id: string },
    ) => Promise<boolean>,
    userId?: string,
  ): Promise<void> {
    for (const socketId of new Set([
      ...this.connections.keys(),
      ...this.roomOperations.keys(),
    ])) {
      await this.serializeRoomOperation(socketId, async () => {
        // Authentication can replace the record while this eviction is queued.
        const connection = this.connections.get(socketId);
        const socket = this.sockets.get(socketId);
        if (
          !socket ||
          !connection?.userId ||
          (userId && connection.userId !== userId)
        )
          return;
        for (const id of [...(this.openItemsProjects.get(socketId) ?? [])]) {
          let allowed = false;
          try {
            allowed = await authorize(connection, { kind: 'project', id });
          } catch {
            // An unavailable authorization source cannot retain private-room access.
          }
          if (!allowed) {
            await socket.leave(`open-items:${connection.userId}:${id}`);
            this.openItemsProjects.get(socketId)?.delete(id);
          }
        }
        const fields = [
          ['organizationIds', 'organization'],
          ['projectIds', 'project'],
          ['conversationIds', 'conversation'],
          ['initiativeIds', 'initiative'],
          ['designDocIds', 'design-doc'],
        ] as const;
        for (const [field, kind] of fields) {
          for (const id of [...connection[field]]) {
            let allowed = false;
            try {
              allowed = await authorize(connection, { kind, id });
            } catch {
              /* An unavailable authorization source cannot retain access. */
            }
            if (allowed) continue;
            await socket.leave(kind + ':' + id);
            const remove = (ids: string[]) => {
              const index = ids.indexOf(id);
              if (index >= 0) ids.splice(index, 1);
            };
            remove(connection[field]);
            const subscription = this.subscriptions.get(connection.id);
            if (field !== 'organizationIds' && subscription?.[field])
              remove(subscription[field]);
          }
        }
      });
    }
  }

  /**
   * Get subscription by socket ID
   */
  getSubscription(socketId: string): EventSubscription | undefined {
    return this.subscriptions.get(socketId);
  }

  /**
   * Get all active connections
   */
  getAllConnections(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalConnections: number;
    connectionsByProject: Record<string, number>;
    connectionsByUser: Record<string, number>;
  } {
    const connections = this.getAllConnections();
    const connectionsByProject: Record<string, number> = {};
    const connectionsByUser: Record<string, number> = {};

    connections.forEach((conn) => {
      conn.projectIds.forEach((projectId) => {
        connectionsByProject[projectId] =
          (connectionsByProject[projectId] || 0) + 1;
      });

      if (conn.userId) {
        connectionsByUser[conn.userId] =
          (connectionsByUser[conn.userId] || 0) + 1;
      }
    });

    return {
      totalConnections: connections.length,
      connectionsByProject,
      connectionsByUser,
    };
  }

  /**
   * Force-close every active socket bound to a machine.
   *
   * Distinct from `cleanupInactiveConnections`, which only mops up sockets that
   * already died: this proactively disconnects a *live* connection — the path
   * machine revocation takes to evict an open CLI within ~1s instead of waiting
   * for it to drop on its own. Connections are matched on the tracked
   * `machineId` (a verified machine connection also sits in the
   * `machine:${machineId}` room). `socket.disconnect(true)` closes the
   * underlying transport, which fires the gateway's disconnect handler and
   * removes the connection from the maps. Returns the number of sockets closed.
   */
  forceDisconnectMachine(machineId: MachineId): number {
    const targets = this.getAllConnections().filter(
      (conn) => conn.machineId === machineId,
    );

    let closed = 0;
    for (const conn of targets) {
      const socket = this.sockets.get(conn.id);
      if (socket) {
        socket.disconnect(true);
        closed++;
      }
    }

    this.logger.log('[ConnectionManager] forceDisconnectMachine', {
      machineId,
      matched: targets.length,
      closed,
    });

    return closed;
  }

  /** Force-close browser and verified-machine channels scoped to one organization. */
  forceDisconnectOrganization(organizationId: OrganizationId): number {
    const targets = this.getAllConnections().filter((connection) =>
      connection.organizationIds.includes(organizationId),
    );
    let closed = 0;
    for (const connection of targets) {
      const socket = this.sockets.get(connection.id);
      if (socket) {
        socket.disconnect(true);
        closed += 1;
      }
    }
    this.logger.log('[ConnectionManager] forceDisconnectOrganization', {
      organizationId,
      matched: targets.length,
      closed,
    });
    return closed;
  }

  /**
   * Garbage-collect connections whose underlying socket is no longer alive.
   *
   * The only safe signal that a connection is dead is the socket.io transport
   * state, NOT application-level `lastActivity`: a long-lived CLI that simply
   * sits listening for triggers (without emitting subscribe/join/ping) is
   * still genuinely connected, and evicting it here would orphan it from the
   * presence map — `removeConnection` does not close the socket, so it never
   * re-authenticates and `hasCliConnectionForUser` reports a false negative
   * for the rest of the socket's life. Real disconnects already fire
   * `handleDisconnect` -> `removeConnection`; this sweep only mops up entries
   * for sockets that died without that callback firing.
   */
  cleanupInactiveConnections(): void {
    const deadConnections = Array.from(this.connections.entries()).filter(
      ([socketId]) => {
        const socket = this.sockets.get(socketId);
        return !socket || socket.disconnected;
      },
    );

    this.logger.verbose(
      '[ConnectionManager] cleanupInactiveConnections sweep',
      {
        totalConnections: this.connections.size,
        deadConnectionCount: deadConnections.length,
      },
    );

    deadConnections.forEach(([socketId, conn]) => {
      this.logger.warn(`Cleaning up dead connection: ${socketId}`, {
        userId: conn.userId,
        clientType: conn.clientType,
        lastActivity: conn.lastActivity,
      });
      this.removeConnection(socketId);
    });
  }

  /**
   * Debug method: Log all current channel subscriptions
   */
  logAllChannelSubscriptions(): void {
    const connections = this.getAllConnections();
    const channelSubscriptions: Record<string, string[]> = {};

    connections.forEach((conn) => {
      const socketId = conn.id;
      const channels: string[] = [];

      // Add all channel types
      conn.organizationIds.forEach((id) => channels.push(`organization:${id}`));
      conn.projectIds.forEach((id) => channels.push(`project:${id}`));
      conn.conversationIds.forEach((id) => channels.push(`conversation:${id}`));
      conn.initiativeIds.forEach((id) => channels.push(`initiative:${id}`));
      conn.designDocIds.forEach((id) => channels.push(`design-doc:${id}`));
      if (conn.userId) channels.push(`user:${conn.userId}`);

      channelSubscriptions[socketId] = channels;
    });

    this.logger.log('[ConnectionManager] Current channel subscriptions', {
      totalConnections: connections.length,
      subscriptions: channelSubscriptions,
      channelCounts: this.getChannelCounts(),
    });
  }

  /**
   * Get count of subscribers per channel type
   */
  private getChannelCounts(): Record<string, number> {
    const connections = this.getAllConnections();
    const counts: Record<string, number> = {};

    connections.forEach((conn) => {
      conn.organizationIds.forEach((id) => {
        const channel = `organization:${id}`;
        counts[channel] = (counts[channel] || 0) + 1;
      });
      conn.projectIds.forEach((id) => {
        const channel = `project:${id}`;
        counts[channel] = (counts[channel] || 0) + 1;
      });
      conn.conversationIds.forEach((id) => {
        const channel = `conversation:${id}`;
        counts[channel] = (counts[channel] || 0) + 1;
      });
      conn.initiativeIds.forEach((id) => {
        const channel = `initiative:${id}`;
        counts[channel] = (counts[channel] || 0) + 1;
      });
      conn.designDocIds.forEach((id) => {
        const channel = `design-doc:${id}`;
        counts[channel] = (counts[channel] || 0) + 1;
      });
      if (conn.userId) {
        const channel = `user:${conn.userId}`;
        counts[channel] = (counts[channel] || 0) + 1;
      }
    });

    return counts;
  }
}
