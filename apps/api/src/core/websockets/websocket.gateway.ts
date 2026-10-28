import { ProjectMembershipRevocationService } from './project-membership-revocation.service';
import * as crypto from 'crypto';
import { Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PendingTriggerService } from '../../services/workflows/pending-trigger.service';
import { TriggerEmitter } from './trigger-emitter.service';
import { AgentOperationDispatchService } from './agent-operation-dispatch.service';
import { ApiMetricsService } from '../metrics/api-metrics.service';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import {
  WebSocketTaskCreatedEvent,
  WebSocketTaskStatusChangedEvent,
  WebSocketTaskUpdatedEvent,
  WebSocketConversationCreatedEvent,
  WebSocketConversationStatusChangedEvent,
  WebSocketConversationUpdatedEvent,
  WebSocketInitiativeCreatedEvent,
  WebSocketInitiativeStatusChangedEvent,
  WebSocketInitiativeUpdatedEvent,
  WebSocketMessageCreatedEvent,
  WebSocketMessageDeletedEvent,
  WebSocketMessageRealtimeEvent,
  WebSocketMessageUpdatedEvent,
  WebSocketProjectCreatedEvent,
  WebSocketProjectStatusChangedEvent,
  WebSocketProjectUpdatedEvent,
  WebSocketSystemNotificationEvent,
  WebSocketMachineSecurityEventEvent,
  WebSocketDesignDocCreatedEvent,
  WebSocketDesignDocUpdatedEvent,
  WebSocketDesignDocStatusChangedEvent,
  WebSocketAgentSessionCreatedEvent,
  WebSocketAgentSessionDeletedEvent,
  WebSocketAgentSessionStatusChangedEvent,
  WebSocketAgentSessionCurrentStateChangedEvent,
  WebSocketConversationPhaseChangedEvent,
  WebSocketAgentSessionOutputAttentionChangedEvent,
  WebSocketProposalApprovedEvent,
  WebSocketProposalGroupLifecycleEvent,
  WebSocketAuthRequest,
  WebSocketAuthResponse,
  WebSocketJoinRoomRequest,
  WebSocketSubscriptionRequest,
  WebSocketConversationReductionEvent,
  WebSocketAuthorityReductionEvent,
  WebSocketMachineChallengeResponse,
  WebSocketMachineAuthenticationErrorResponse,
  WebSocketAccessDeniedResponse,
  WebSocketSubscribedResponse,
  WebSocketJoinedResponse,
  WebSocketLeaveRoomRequest,
  WebSocketLeftResponse,
  WebSocketHeartbeat,
  AgentSessionCurrentStateObservation,
  AgentSessionContextSizeObservation,
  AgentSessionContextSize,
  WebSocketAgentSessionContextSizeChangedEvent,
  ConversationPhaseObservation,
  AgentInputDisposition,
  AgentOperationDispatchAcknowledgement,
  AgentOperationDispatchAcceptedAcknowledgement,
  AgentOperationDispatchRejectedAcknowledgement,
  ProviderIdentityInboundPayload,
  MachineRepoBindingsInboundPayload,
  WebSocketMachineRepoBindingsEvent,
  WebSocketConversationTriggerEvent,
  WebSocketConversationControlEvent,
  WebSocketMonitorCommandEvent,
  SignedMonitorAuthorityNeutralEnvelope,
  WebSocketMonitorReductionEvent,
  WebSocketCliReadRequestEvent,
  WebSocketApplicationEffectEvent,
  WebSocketExactActionEvent,
  AuthorityReductionAcknowledgement,
  AuthorityReductionRejectedAcknowledgement,
  MonitorCommandAcknowledgement,
  MonitorCommandRejectionReason,
  MonitorCommandRejectionStage,
  ServiceRepoBinding,
  WebSocketCliSettingsRequestEvent,
} from '../../generated';
import type {
  EvalAttemptUpdatedEvent,
  EvalRunUpdatedEvent,
} from '../events/types/domain-events';

const parseAgentOperationDispatchAcknowledgement = (
  value: unknown,
): AgentOperationDispatchAcknowledgement | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate['status'] ===
    AgentOperationDispatchAcceptedAcknowledgement.StatusEnum.Accepted
  ) {
    return typeof candidate['operationId'] === 'string' &&
      typeof candidate['operationFingerprint'] === 'string' &&
      typeof candidate['replayed'] === 'boolean' &&
      Object.values(AgentInputDisposition).includes(
        candidate['inputDisposition'] as AgentInputDisposition,
      )
      ? ({
          status: candidate['status'],
          operationId: candidate['operationId'],
          operationFingerprint: candidate['operationFingerprint'],
          replayed: candidate['replayed'],
          inputDisposition: candidate[
            'inputDisposition'
          ] as AgentInputDisposition,
        } satisfies AgentOperationDispatchAcceptedAcknowledgement)
      : null;
  }
  if (
    candidate['status'] ===
      AgentOperationDispatchRejectedAcknowledgement.StatusEnum.Rejected &&
    Object.values(
      AgentOperationDispatchRejectedAcknowledgement.StageEnum,
    ).includes(
      candidate[
        'stage'
      ] as AgentOperationDispatchRejectedAcknowledgement.StageEnum,
    ) &&
    Object.values(
      AgentOperationDispatchRejectedAcknowledgement.ReasonEnum,
    ).includes(
      candidate[
        'reason'
      ] as AgentOperationDispatchRejectedAcknowledgement.ReasonEnum,
    )
  ) {
    return {
      status: candidate['status'],
      stage: candidate[
        'stage'
      ] as AgentOperationDispatchRejectedAcknowledgement.StageEnum,
      reason: candidate[
        'reason'
      ] as AgentOperationDispatchRejectedAcknowledgement.ReasonEnum,
    } satisfies AgentOperationDispatchRejectedAcknowledgement;
  }
  return null;
};
import {
  LegacyWebSocketCliReadRequestEvent,
  LegacyWebSocketConversationControlEvent,
  LegacyWebSocketConversationTriggerEvent,
  LegacyWebSocketMonitorCommandEvent,
} from './legacy-trigger-events';
import { WebsocketConnectionManager } from './websocket-connection-manager.service';
import { MachineChallengeService } from './machine-challenge.service';
import {
  UserAccessTokenValidatorService,
  ValidatedBrowserAccessContext,
} from '../../auth/services/user-access-token-validator.service';
import { AgentSessionService } from '../../services/agent-session.service';
import {
  AgentSessionCurrentStateProjection,
  AgentSessionCurrentStateProjectionEntry,
} from '../../services/agent-session-current-state-projection.service';
import {
  AgentSessionOutputAttentionProjection,
  AgentSessionOutputAttentionProjectionEntry,
} from '../../services/agent-session-output-attention-projection.service';
import {
  ConversationPhaseProjection,
  type ConversationPhaseProjectionEntry,
} from '../../services/conversation-phase-projection.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DemoSandboxActivityService } from '../../services/demo-sandbox/demo-sandbox-activity.service';
import { MachinePresenceService } from './machine-presence.service';
import { WebsocketAuthorizationService } from './websocket-authorization.service';
import { WebsocketUserConnectionLifecycleService } from './websocket-user-connection-lifecycle.service';
import {
  classifyHostAffectingFrame,
  HostAffectingFrame,
} from './host-affecting-frame-policy';

// Use generated WebSocket types instead of local interfaces

const gateways = new Set<WebsocketGateway>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseMonitorCommandAcknowledgement = (
  value: unknown,
  commandId: string,
): MonitorCommandAcknowledgement | null => {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (value.status === 'ADMITTED') {
    if (
      keys.some((key) => !['status', 'commandId', 'replayed'].includes(key)) ||
      value.commandId !== commandId ||
      typeof value.replayed !== 'boolean'
    ) {
      return null;
    }
    return value as unknown as MonitorCommandAcknowledgement;
  }
  if (value.status !== 'REJECTED') return null;
  if (
    keys.some(
      (key) =>
        !['status', 'commandId', 'stage', 'reason', 'message'].includes(key),
    ) ||
    (value.commandId !== undefined && value.commandId !== commandId) ||
    !Object.values(MonitorCommandRejectionStage).includes(
      value.stage as MonitorCommandRejectionStage,
    ) ||
    !Object.values(MonitorCommandRejectionReason).includes(
      value.reason as MonitorCommandRejectionReason,
    ) ||
    (value.message !== undefined &&
      (typeof value.message !== 'string' || value.message.length > 1000))
  ) {
    return null;
  }
  return value as unknown as MonitorCommandAcknowledgement;
};

const parseAuthorityReductionAcknowledgement = (
  value: unknown,
  nonce: string,
): AuthorityReductionAcknowledgement | null => {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (value.status === 'APPLIED') {
    if (
      keys.some((key) => !['status', 'nonce'].includes(key)) ||
      value.nonce !== nonce
    ) {
      return null;
    }
    return value as unknown as AuthorityReductionAcknowledgement;
  }
  if (
    value.status !== 'REJECTED' ||
    keys.some((key) => !['status', 'reason'].includes(key)) ||
    !Object.values(
      AuthorityReductionRejectedAcknowledgement.ReasonEnum,
    ).includes(
      value.reason as AuthorityReductionRejectedAcknowledgement.ReasonEnum,
    )
  ) {
    return null;
  }
  return value as unknown as AuthorityReductionAcknowledgement;
};

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/events',
})
export class WebsocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  /**
   * Events emitted by other providers during application bootstrap may arrive
   * before the Socket.IO server instance is attached by NestJS. We buffer
   * those events and flush them once `afterInit()` runs so that no early
   * domain events are lost.
   */
  private readonly pendingEmits: (() => void)[] = [];

  private readonly logger = new Logger(WebsocketGateway.name);

  /**
   * Users with a re-fan walk currently in flight. Keyed on `userId` (not
   * socketId) because re-fan frames target the `user:${id}` room and reach
   * every one of a user's sockets — so when two sockets authenticate together
   * they must coalesce to a single walk rather than each replaying the open
   * triggers into the shared room. Process-local: this coalesces within one
   * API instance, matching the observed single-process burst.
   */
  private readonly refanInFlight = new Set<UserId>();

  /**
   * Outstanding machine-credential challenges, keyed on socket id. An entry
   * is created when a CLI presents a machine credential on `authenticate`
   * (the challenge is issued, auth is NOT yet complete) and consumed when the
   * matching `machine_challenge_response` verifies. It carries the random
   * challenge bytes, the machine being proven, and the subscription context
   * from the original authenticate payload so the connection can be
   * registered identically once the signature checks out. Cleared on
   * disconnect so a socket that drops mid-handshake leaves no dangling state.
   */
  private readonly pendingMachineChallenges = new Map<
    string,
    {
      challenge: Buffer;
      machineId: MachineId;
      credentialDigest: string;
      organizationIds: OrganizationId[];
      projectIds: ProjectId[];
      conversationIds: ConversationId[];
      initiativeIds: InitiativeId[];
      designDocIds: DesignDocId[];
    }
  >();

  constructor(
    private readonly membershipRevocation: ProjectMembershipRevocationService,
    private connectionManager: WebsocketConnectionManager,
    private userAccessTokenValidator: UserAccessTokenValidatorService,
    private pendingTriggerService: PendingTriggerService,
    // forwardRef breaks the WebsocketGateway ↔ TriggerEmitter cycle —
    // TriggerEmitter already injects this gateway to publish frames; we
    // borrow it back here so the authenticate handler can re-fan open
    // triggers without owning the sign/resolve pipeline itself.
    @Inject(forwardRef(() => TriggerEmitter))
    private triggerEmitter: TriggerEmitter,
    private machineChallengeService: MachineChallengeService,
    @Inject(forwardRef(() => AgentSessionService))
    private agentSessionService: AgentSessionService,
    private machinePresenceService: MachinePresenceService,
    private websocketAuthorizationService: WebsocketAuthorizationService,
    private websocketUserConnectionLifecycle: WebsocketUserConnectionLifecycleService,
    @Optional()
    private currentStateProjection?: AgentSessionCurrentStateProjection,
    @Optional()
    private outputAttentionProjection?: AgentSessionOutputAttentionProjection,
    @Optional()
    @Inject(forwardRef(() => AgentOperationDispatchService))
    private agentOperationDispatchService?: AgentOperationDispatchService,
    @Optional()
    private apiMetrics?: ApiMetricsService,
    @Optional()
    private conversationPhaseProjection?: ConversationPhaseProjection,
    @Optional()
    private prisma?: PrismaService,
    @Optional()
    private demoSandboxActivity?: DemoSandboxActivityService,
  ) {
    gateways.add(this);
  }

  /**
   * Extract the verified user id from the JWT stored in the `accessToken`
   * cookie sent on the socket.io handshake. Returns `undefined` if the cookie
   * is missing, the token is invalid, or the subject is a system token.
   */
  private async resolveBrowserAccessContextFromHandshake(
    client: Socket,
  ): Promise<ValidatedBrowserAccessContext | undefined> {
    const cookieHeader = client.handshake.headers.cookie;
    if (!cookieHeader) {
      return undefined;
    }

    const match = cookieHeader.match(/(?:^|;\s*)accessToken=([^;]+)/);
    const rawToken = match?.[1];
    if (!rawToken) {
      return undefined;
    }

    try {
      const token = decodeURIComponent(rawToken);
      return await this.userAccessTokenValidator.verifyAndValidate(token);
    } catch (error) {
      this.logger.warn('Failed to verify accessToken from handshake cookie', {
        socketId: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  afterInit() {
    this.membershipRevocation.registerRevalidation((userId) =>
      this.connectionManager.revalidateRooms(async (connection, room) => {
        const decision = await this.websocketAuthorizationService.authorize({
          userId: connection.userId!,
          organizationIds:
            room.kind === 'organization' ? [room.id as OrganizationId] : [],
          projectIds: room.kind === 'project' ? [room.id as ProjectId] : [],
          conversationIds:
            room.kind === 'conversation' ? [room.id as ConversationId] : [],
          initiativeIds:
            room.kind === 'initiative' ? [room.id as InitiativeId] : [],
          designDocIds:
            room.kind === 'design-doc' ? [room.id as DesignDocId] : [],
        });
        return decision.authorized;
      }, userId),
    );
    this.logger.verbose('WebSocket Gateway initialized');

    // Bind projection fan-out only after Nest has attached the Socket.IO
    // server to this gateway instance. Binding in the constructor can leave
    // the projection pointing at a separately constructed gateway that never
    // receives a server and therefore queues every transition forever.
    this.currentStateProjection?.setTransitionSink((transition) =>
      this.emitAgentSessionCurrentStateChanged(transition.entry),
    );
    this.outputAttentionProjection?.setTransitionSink((transition) =>
      this.emitAgentSessionOutputAttentionChanged(transition.entry),
    );
    this.conversationPhaseProjection?.setTransitionSink((transition) =>
      this.emitConversationPhaseChanged(transition.entry),
    );

    // Flush any events that were queued before the server instance was ready
    if (this.pendingEmits.length > 0) {
      this.logger.verbose(
        `Flushing ${this.pendingEmits.length} pending websocket events`,
      );
      // Execute all queued emit callbacks
      this.pendingEmits.splice(0).forEach((emit) => {
        try {
          emit();
        } catch (err) {
          this.logger.error('Failed to flush pending websocket event', err);
        }
      });
    }

    // Event routing handled by RealtimeBridge service

    // Set up cleanup interval for inactive connections
    setInterval(
      () => {
        this.connectionManager.cleanupInactiveConnections();
      },
      5 * 60 * 1000,
    ); // Every 5 minutes
  }

  async handleConnection(client: Socket) {
    this.logger.verbose(`Client connected: ${client.id}`);

    // Initialize connection without authentication
    // Authentication will happen via the 'authenticate' message
    await this.connectionManager.addConnection(client);
  }

  async handleDisconnect(client: Socket) {
    this.logger.verbose(`Client disconnected: ${client.id}`);

    /*
    we considered a flush user pending messages but the implementation was overengineered for our needs.
    Should we need it later, here's the best approach:
     1. Event-Driven Architecture 

      Use the existing event system to decouple the layers:
      - WebsocketGateway publishes a system.user_disconnected event via DomainEventPublisher
      - Clean separation of concerns - transport layer doesn't know about business logic
    */

    // Drop any half-finished machine handshake so a socket that dies between
    // the challenge and its response leaves no dangling pending state.
    this.pendingMachineChallenges.delete(client.id);
    this.websocketUserConnectionLifecycle.unregister(client.id);

    // Repo bindings eviction: emit empty bindings to every conversation room
    // this machine was serving so browsers know the machine is gone.
    // Guard on sourcingSocketId: if the machine reconnected (new socket) before
    // this disconnect fires, the cache entry belongs to the new socket and must
    // not be cleared here — clearing it would leave subscribers with stale empty
    // bindings until the new socket resends its own update.
    const conn = this.connectionManager.getConnection(client.id);
    if (conn?.machineId) {
      try {
        await this.agentSessionService.clearRuntimeCurrentState({
          connectionId: client.id,
          userId: conn.userId,
          machineId: conn.machineId,
          organizationIds: conn.organizationIds,
        });
      } catch (error) {
        this.logger.error('[current-state] disconnect transition failed', {
          socketId: client.id,
          machineId: conn.machineId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await this.conversationPhaseProjection?.disconnect({
          connectionId: client.id,
        });
      } catch (error) {
        this.logger.error('[conversation-phase] disconnect transition failed', {
          socketId: client.id,
          machineId: conn.machineId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const cached = await this.machinePresenceService.getBindings(
        conn.machineId,
      );
      if (cached && cached.sourcingSocketId === client.id) {
        const event = this.buildMachineRepoBindingsEvent(
          conn.machineId,
          [],
          cached.organizationId,
        );
        for (const conversationId of conn.conversationIds) {
          this.server
            .to(`conversation:${conversationId}`)
            .emit('machine.repo_bindings', event);
        }
        await this.machinePresenceService.removeBindings(conn.machineId);
        if (conn.userId) {
          await this.machinePresenceService.removePresence(
            conn.machineId,
            conn.userId,
          );
        }
      } else if (!cached && conn.userId) {
        // Machine authenticated but never sent repo bindings — no fan-out needed,
        // but the machine:user:{userId} set still has a stale entry to clean up.
        // Skip when the reconnect-race guard fires (cached exists, different socket owns it)
        // because the new socket's presence key is live and its heartbeats will refresh it.
        await this.machinePresenceService.removePresence(
          conn.machineId,
          conn.userId,
        );
      }
    }

    this.connectionManager.removeConnection(client.id);
  }

  /**
   * Handle client authentication
   */
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WebSocketAuthRequest,
  ) {
    return this.connectionManager.serializeRoomOperation(client.id, () =>
      this.handleAuthenticateOperation(client, payload),
    );
  }

  private async handleAuthenticateOperation(
    client: Socket,
    payload: WebSocketAuthRequest,
  ) {
    const startedAt = Date.now();
    this.logger.debug('Authentication operation started', {
      socketId: client.id,
    });
    try {
      const {
        organizationId,
        projectIds = [],
        conversationIds = [],
        initiativeIds = [],
        designDocIds = [],
        clientType,
        machineId,
        machineCredential,
      } = payload;

      const existingConnection = this.connectionManager.getConnection(
        client.id,
      );
      const requestedClientType = clientType === 'cli' ? 'cli' : 'browser';

      // Credential profiles never transition on one live transport. In
      // particular, a verified machine must retain its disconnect-owned
      // presence cleanup, and a browser socket must not carry its rooms or
      // expiry registration into the machine challenge path.
      if (
        existingConnection?.userId &&
        (existingConnection.clientType === 'cli' ||
          existingConnection.clientType !== requestedClientType)
      ) {
        client.emit(
          'authenticated',
          requestedClientType === 'cli'
            ? this.machineAuthError('Machine authentication failed')
            : this.browserAuthError(),
        );
        client.disconnect(true);
        return;
      }

      // Machine-credential path: a CLI that presents a machineId AND a
      // machineCredential must prove possession of the paired Ed25519 key
      // before it is registered. Both the stored credential hash and the
      // fresh Ed25519 proof are required; only the credential digest is kept
      // across the challenge round-trip.
      if (clientType === 'cli') {
        if (machineId && machineCredential) {
          await this.beginMachineChallenge(client, {
            machineId: machineId as MachineId,
            machineCredential,
            organizationIds: (organizationId
              ? [organizationId]
              : []) as OrganizationId[],
            projectIds: projectIds as ProjectId[],
            conversationIds: conversationIds as ConversationId[],
            initiativeIds: initiativeIds as InitiativeId[],
            designDocIds: designDocIds as DesignDocId[],
          });
        } else {
          client.emit(
            'authenticated',
            this.machineAuthError('Machine authentication failed'),
          );
        }
        return;
      }

      const accessContext =
        await this.resolveBrowserAccessContextFromHandshake(client);
      if (!accessContext) {
        await this.clearBrowserAuthenticationState(client.id);
        client.emit('authenticated', this.browserAuthError());
        return;
      }
      const { userId } = accessContext;

      const organizationIds = organizationId ? [organizationId] : [];

      const roomDecision = await this.websocketAuthorizationService.authorize({
        userId,
        organizationIds: organizationIds as OrganizationId[],
        projectIds: projectIds as ProjectId[],
        conversationIds: conversationIds as ConversationId[],
        initiativeIds: initiativeIds as InitiativeId[],
        designDocIds: designDocIds as DesignDocId[],
      });

      if (!roomDecision.authorized) {
        this.logger.warn('[WebSocket] Browser room authorization denied', {
          socketId: client.id,
          userId,
          requestedCounts: {
            organizations: organizationIds.length,
            projects: projectIds.length,
            conversations: conversationIds.length,
            initiatives: initiativeIds.length,
            designDocs: designDocIds.length,
          },
        });
        await this.clearBrowserAuthenticationState(client.id);
        client.emit('authenticated', this.roomAccessDenied());
        return;
      }

      // Socket.IO retains physical room membership independently from the
      // connection-manager maps. Leave the previous browser scope before
      // installing the newly authorized one.
      await this.connectionManager.resetAuthorizationState(client.id);

      // Validate the lifecycle context before replacing an existing
      // registration. A browser socket is not considered authenticated until
      // its verified expiry has been enrolled in the lifecycle service.
      try {
        const registered = this.websocketUserConnectionLifecycle.register(
          client,
          {
            userId,
            expiresAt: accessContext.expiresAt,
            sessionId: accessContext.sessionId,
            authorizationVersion: accessContext.authorizationVersion,
          },
        );
        if (!registered) {
          this.logger.warn(
            '[WebSocket] Browser lifecycle registration skipped',
            {
              socketId: client.id,
              userId,
              reason: 'socket_already_disconnected',
            },
          );
          this.websocketUserConnectionLifecycle.unregister(client.id);
          client.emit('authenticated', this.browserAuthError());
          return;
        }
      } catch (error) {
        this.logger.warn('[WebSocket] Browser lifecycle registration denied', {
          socketId: client.id,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.websocketUserConnectionLifecycle.unregister(client.id);
        client.emit('authenticated', this.browserAuthError());
        return;
      }

      // Add the replacement authentication state after the old rooms have
      // been left and the lifecycle registration has succeeded.
      await this.connectionManager.addConnection(
        client,
        userId,
        organizationIds as OrganizationId[],
        projectIds as ProjectId[],
        conversationIds as ConversationId[],
        initiativeIds as InitiativeId[],
        designDocIds as DesignDocId[],
        'browser',
      );

      // Repository bindings replay from their own Redis boundary. Current
      // state is read through the authenticated HTTP batch surface; a missing
      // projection is intentionally not replaced with an inferred value.
      for (const conversationId of conversationIds) {
        await this.maybeReplayMachineRepoBindings(client, conversationId);
        await this.maybeReplayConversationPhase(client, conversationId);
      }

      const authResponse: WebSocketAuthResponse = {
        status: 'success',
        connectionId: client.id,
        userId,
        organizationId: organizationIds?.[0] || undefined,
        projectIds,
        conversationIds,
        initiativeIds,
        designDocIds,
      };
      client.emit('authenticated', authResponse);

      // Re-publish any open triggers the user owns. Signed trigger frames
      // are addressed to the recipient's `machine:${machineId}` room, so the
      // re-fan reaches a verified machine connection if one is present —
      // this cookie path itself authenticates UI/browser sockets, which do
      // not join machine rooms. Fire-and-forget so the auth response
      // round-trip is not delayed by trigger projection / signing.
      void this.refanPendingTriggersForUser(userId);

      this.logger.verbose(`[WebSocket] Client authenticated successfully`, {
        socketId: client.id,
        userId,
        organizationIds,
        projectIds,
        conversationIds,
        initiativeIds,
        subscriptionsCreated: {
          projects: projectIds.map((id) => `project:${id}`),
          conversations: conversationIds.map((id) => `conversation:${id}`),
          initiatives: initiativeIds.map((id) => `initiative:${id}`),
          designDocs: designDocIds.map((id) => `design-doc:${id}`),
          user: userId ? [`user:${userId}`] : [],
          organizations: organizationIds.map((id) => `organization:${id}`),
        },
      });
    } catch (error) {
      this.logger.error('Authentication failed', error);
      this.websocketUserConnectionLifecycle.unregister(client.id);
      client.emit('authenticated', this.browserAuthError());
      client.disconnect(true);
    } finally {
      this.logger.debug('Authentication operation settled', {
        socketId: client.id,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private async clearBrowserAuthenticationState(
    socketId: string,
  ): Promise<void> {
    this.websocketUserConnectionLifecycle.unregister(socketId);
    await this.connectionManager.resetAuthorizationState(socketId);
  }

  private browserAuthError(): WebSocketAuthResponse {
    return {
      status: 'error',
      reason: 'authentication_required',
      message: 'Authentication required',
    };
  }

  private roomAccessDenied(): WebSocketAccessDeniedResponse {
    return {
      status: WebSocketAccessDeniedResponse.StatusEnum.Error,
      reason: WebSocketAccessDeniedResponse.ReasonEnum.AccessDenied,
      message: WebSocketAccessDeniedResponse.MessageEnum.AccessDenied,
    };
  }

  /**
   * Build the standard rejection `authenticated` frame. Used for every
   * machine-handshake failure (unknown/revoked machine, missing pending
   * challenge, bad signature) so the CLI sees a uniform error shape.
   *
   * `reason` is the enumerated, machine-readable rejection cause. It is set
   * ONLY for a revoked credential (machine_revoked); every other failure mode
   * (unknown machine, missing challenge, bad signature, transient error) omits
   * it so the CLI can distinguish "stop retrying, this machine is revoked" from
   * a recoverable drop — a non-revoked reconnect re-authenticates and never
   * carries machine_revoked. The reason rides the frame as an enumerated field,
   * never sniffed from the free-text `message`.
   */
  private machineAuthError(
    message: string,
    reason?: WebSocketMachineAuthenticationErrorResponse.ReasonEnum,
  ): WebSocketMachineAuthenticationErrorResponse {
    return {
      status: 'error',
      message,
      reason,
    };
  }

  /**
   * First half of the machine-credential handshake: validate the presented
   * machine exists and is not revoked, then issue a fresh random challenge and
   * record the pending state. Auth is NOT completed here — the socket stays
   * unregistered until `machine_challenge_response` verifies the signature. A
   * missing or revoked machine is rejected outright with no challenge issued.
   */
  private async beginMachineChallenge(
    client: Socket,
    context: {
      machineId: MachineId;
      machineCredential: string;
      organizationIds: OrganizationId[];
      projectIds: ProjectId[];
      conversationIds: ConversationId[];
      initiativeIds: InitiativeId[];
      designDocIds: DesignDocId[];
    },
  ): Promise<void> {
    const { machineId, machineCredential } = context;
    const machine = await this.machineChallengeService.lookupMachine(machineId);
    if (
      !machine ||
      machine.revokedAt ||
      !this.machineChallengeService.verifyMachineCredentialHash(
        machine.tokenHash,
        machineCredential,
      )
    ) {
      this.logger.warn(
        '[machine-challenge] rejecting connection at challenge',
        {
          socketId: client.id,
          machineId,
          reason: !machine ? 'unknown_machine' : 'revoked',
        },
      );
      // Typed reason only when the machine exists but is revoked; an unknown
      // machine is left reasonless so a later valid connect is not poisoned.
      client.emit(
        'authenticated',
        this.machineAuthError(
          'Machine credential rejected',
          machine?.revokedAt
            ? WebSocketMachineAuthenticationErrorResponse.ReasonEnum
                .MachineRevoked
            : undefined,
        ),
      );
      return;
    }

    // 32 random bytes is plenty of entropy for a one-shot, replay-bounded
    // proof challenge; the CLI signs the raw bytes and returns the signature.
    const challenge = crypto.randomBytes(32);
    this.machineChallengeService.registerControllerProofChallenge(
      machineId,
      challenge,
    );
    this.pendingMachineChallenges.set(client.id, {
      challenge,
      machineId,
      credentialDigest:
        this.machineChallengeService.hashMachineCredential(machineCredential),
      organizationIds: context.organizationIds,
      projectIds: context.projectIds,
      conversationIds: context.conversationIds,
      initiativeIds: context.initiativeIds,
      designDocIds: context.designDocIds,
    });

    this.logger.verbose('[machine-challenge] issued challenge', {
      socketId: client.id,
      machineId,
      userId: machine.userId,
    });
    // The CLI's frame schema is strict on `{ challenge }` only — emit exactly
    // that base64 string and nothing else.
    client.emit('machine_challenge', {
      challenge: challenge.toString('base64'),
    });
  }

  /**
   * Second half of the machine-credential handshake: verify the CLI's
   * signature over the issued challenge and, on success, register the
   * connection with identity bound to the VERIFIED machine's owner
   * (`machine.userId`) — not any JWT subject. Deriving identity from the
   * Ed25519 proof is what stops a UI token from authenticating a machine
   * connection and a machine credential from standing in for a UI session.
   * Any failure (no pending challenge, machine revoked since issue, bad
   * signature) emits an error and disconnects the socket.
   */
  @SubscribeMessage('machine_challenge_response')
  async handleMachineChallengeResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WebSocketMachineChallengeResponse,
  ) {
    return this.connectionManager.serializeRoomOperation(client.id, () =>
      this.handleMachineChallengeResponseOperation(client, payload),
    );
  }

  private async handleMachineChallengeResponseOperation(
    client: Socket,
    payload: WebSocketMachineChallengeResponse,
  ) {
    const pending = this.pendingMachineChallenges.get(client.id);
    if (!pending) {
      this.logger.warn(
        '[machine-challenge] response with no pending challenge',
        {
          socketId: client.id,
        },
      );
      client.emit(
        'authenticated',
        this.machineAuthError('No pending machine challenge'),
      );
      client.disconnect();
      return;
    }

    // Single-use: consume the pending state up front so a replayed or
    // duplicate response cannot re-run verification against the same nonce.
    this.pendingMachineChallenges.delete(client.id);

    const { machineId } = pending;

    if (payload.machineId !== machineId) {
      this.logger.warn('[machine-challenge] response machine mismatch', {
        socketId: client.id,
        machineId,
      });
      client.emit(
        'authenticated',
        this.machineAuthError('Machine credential rejected'),
      );
      client.disconnect();
      return;
    }

    // Re-check revocation at response time: a credential revoked during the
    // challenge round-trip must not complete auth.
    const machine = await this.machineChallengeService.lookupMachine(machineId);
    if (!machine || machine.revokedAt) {
      this.logger.warn('[machine-challenge] machine gone/revoked at response', {
        socketId: client.id,
        machineId,
        reason: !machine ? 'unknown_machine' : 'revoked',
      });
      // Re-check at response time: a credential revoked mid-handshake carries
      // the typed reason; an unknown machine does not.
      client.emit(
        'authenticated',
        this.machineAuthError(
          'Machine credential rejected',
          machine?.revokedAt
            ? WebSocketMachineAuthenticationErrorResponse.ReasonEnum
                .MachineRevoked
            : undefined,
        ),
      );
      client.disconnect();
      return;
    }

    if (
      !this.machineChallengeService.verifyCredentialDigest(
        machine.tokenHash,
        pending.credentialDigest,
      )
    ) {
      this.logger.warn('[machine-challenge] credential changed during proof', {
        socketId: client.id,
        machineId,
      });
      client.emit(
        'authenticated',
        this.machineAuthError('Machine credential rejected'),
      );
      client.disconnect();
      return;
    }

    const verified = this.machineChallengeService.verifyChallengeSignature(
      machine.publicKey,
      pending.challenge,
      payload.signature,
    );
    if (!verified) {
      this.logger.warn('[machine-challenge] signature rejected', {
        socketId: client.id,
        machineId,
      });
      client.emit(
        'authenticated',
        this.machineAuthError('Machine signature verification failed'),
      );
      client.disconnect();
      return;
    }

    const userId = machine.userId;
    const roomDecision =
      await this.websocketAuthorizationService.authorizeMachine({
        machineId,
        userId,
        organizationIds: pending.organizationIds,
        projectIds: pending.projectIds,
        conversationIds: pending.conversationIds,
        initiativeIds: pending.initiativeIds,
        designDocIds: pending.designDocIds,
      });
    if (!roomDecision.authorized) {
      this.logger.warn('[machine-challenge] requested scope denied', {
        socketId: client.id,
        machineId,
      });
      client.emit('authenticated', this.roomAccessDenied());
      client.disconnect();
      return;
    }

    // Identity proven — register the connection. userId comes from the
    // verified machine binding, and the machine joins its `machine:${id}`
    // room (via addConnection) so signed trigger frames reach only it.
    this.connectionManager.removeConnection(client.id);
    await this.connectionManager.addConnection(
      client,
      userId,
      roomDecision.organizationIds,
      roomDecision.projectIds,
      roomDecision.conversationIds,
      roomDecision.initiativeIds,
      roomDecision.designDocIds,
      'cli',
      machineId,
      // verifiedMachine: this socket proved possession of the paired Ed25519
      // key, so it may join its `machine:${machineId}` room and receive
      // trigger envelopes. The cookie path never passes this.
      true,
      machine.authorizationProtocolVersion,
      roomDecision.agentSessionIds,
      roomDecision.taskMonitorIds,
    );

    if (
      machine.authorizationProtocolVersion === 2 &&
      machine.authorizationState === 'READY'
    ) {
      for (const conversationId of pending.conversationIds) {
        await this.maybeReplayMachineRepoBindings(client, conversationId);
        await this.maybeReplayConversationPhase(client, conversationId);
      }
    }

    const authResponse: WebSocketAuthResponse = {
      status: 'success',
      connectionId: client.id,
      userId,
      organizationId: roomDecision.organizationIds[0] || undefined,
      projectIds: roomDecision.projectIds,
      conversationIds: roomDecision.conversationIds,
      initiativeIds: roomDecision.initiativeIds,
      designDocIds: roomDecision.designDocIds,
    };
    client.emit('authenticated', authResponse);

    this.logger.log('[machine-challenge] connection authenticated', {
      socketId: client.id,
      userId,
      machineId,
    });
    // A verified challenge response is paired-CLI use; heartbeats are not.
    if (machine.isDemoUser) {
      void this.demoSandboxActivity?.recordActivity(userId);
    }

    if (
      machine.authorizationProtocolVersion === 2 &&
      machine.authorizationState === 'READY'
    ) {
      // Stamp lastSeen on the initial announce so the durable presence record
      // is fresh the moment the machine connects — not only after its first
      // heartbeat ~30s later. Fire-and-forget for the same reason as the
      // heartbeat path: presence persistence must not gate authentication.
      void this.machineChallengeService.recordLastSeen(machineId);
      void this.machinePresenceService.setPresence(machineId, userId as UserId);

      // The machine is now in `machine:${machineId}`, so any open trigger we
      // re-publish will actually reach it. Fire-and-forget, matching the
      // cookie path's re-fan.
      void this.refanPendingTriggersForUser(userId);
      void this.agentOperationDispatchService
        ?.nudgeForMachine(machineId)
        .then((claimed) => {
          this.apiMetrics?.recordWake(
            'authentication',
            claimed ? 'claimed' : 'no_eligible_work',
          );
        })
        .catch((error: unknown) => {
          this.apiMetrics?.recordWake('authentication', 'failed');
          this.logger.warn(
            '[AgentOperationDispatchService] failed to wake pending machine dispatches',
            {
              machineId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
      void this.triggerEmitter.refanPendingMonitorCommandsForMachine(machineId);
    } else {
      this.logger.log('[machine-challenge] legacy execution disabled', {
        socketId: client.id,
        machineId,
        userId,
        reasonCode: 'legacy_machine_execution_disabled',
      });
    }
  }

  /**
   * Re-publish every open SYSTEM trigger the user owns so a CLI that
   * reconnected after the original `trigger.conversation` frame was emitted
   * (recipientCount=0 at the time) still picks up the work. Errors per
   * trigger are logged but do not abort the rest — one corrupt row should
   * not silence the user's other pending work.
   */
  private async refanPendingTriggersForUser(userId: UserId): Promise<void> {
    // Coalesce overlapping walks: if a walk for this user is already running,
    // its frames will reach every socket in `user:${id}` — including any that
    // just authenticated — so a second concurrent walk is pure duplication.
    if (this.refanInFlight.has(userId)) {
      this.logger.verbose(
        '[refan-triggers] skip overlapping re-fan, walk already in flight',
        { userId },
      );
      return;
    }
    this.refanInFlight.add(userId);

    try {
      let open: Awaited<
        ReturnType<PendingTriggerService['resolveOpenTriggersForUser']>
      >;
      try {
        open =
          await this.pendingTriggerService.resolveOpenTriggersForUser(userId);
      } catch (error) {
        this.logger.warn('[refan-triggers] projection failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (open.length === 0) {
        this.logger.verbose('[refan-triggers] no open triggers to re-fan', {
          userId,
        });
        return;
      }

      // Defensive dedup on messageId: a single walk must emit each resolved
      // trigger once even if the projection ever returns a duplicate row.
      const seenMessageIds = new Set<MessageId>();
      const deduped = open.filter((entry) => {
        if (seenMessageIds.has(entry.messageId)) {
          return false;
        }
        seenMessageIds.add(entry.messageId);
        return true;
      });

      this.logger.log(
        `[refan-triggers] re-fanning pending triggers userId=${userId} count=${deduped.length}`,
      );

      for (const entry of deduped) {
        try {
          await this.triggerEmitter.emitConversationTriggerForMessage({
            conversationId: entry.conversationId,
            messageId: entry.messageId,
            organizationId: entry.organizationId,
            projectId: entry.projectId,
          });
        } catch (error) {
          this.logger.warn(
            '[refan-triggers] failed to re-emit pending trigger',
            {
              userId,
              conversationId: entry.conversationId,
              messageId: entry.messageId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    } finally {
      // Release the per-user lock no matter how the walk ended so a later
      // authenticate can re-fan again.
      this.refanInFlight.delete(userId);
    }
  }

  /**
   * Handle subscription to specific event types
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WebSocketSubscriptionRequest,
  ) {
    const connection = this.connectionManager.getConnection(client.id);
    return this.connectionManager.serializeRoomOperation(
      client.id,
      async () => {
        if (
          !connection ||
          this.connectionManager.getConnection(client.id) !== connection ||
          client.disconnected
        ) {
          client.emit('subscribed', this.roomAccessDenied());
          return this.roomAccessDenied();
        }
        return this.handleSubscribeOperation(client, payload);
      },
    );
  }

  private async handleSubscribeOperation(
    client: Socket,
    payload: WebSocketSubscriptionRequest,
  ) {
    let disconnectOnFailure = false;
    try {
      const {
        eventTypes,
        projectIds,
        conversationIds,
        initiativeIds,
        designDocIds,
      } = payload;

      const connection = this.connectionManager.getConnection(client.id);
      if (!connection?.userId) {
        this.logger.warn('[WebSocket] Subscription denied before auth', {
          socketId: client.id,
          reason: 'authentication_required',
        });
        client.emit('subscribed', this.roomAccessDenied());
        return this.roomAccessDenied();
      }

      const requestedScope = {
        organizationIds: connection.organizationIds,
        projectIds: (projectIds as ProjectId[]) || [],
        conversationIds: (conversationIds as ConversationId[]) || [],
        initiativeIds: (initiativeIds as InitiativeId[]) || [],
        designDocIds: (designDocIds as DesignDocId[]) || [],
      };
      const roomDecision =
        connection.clientType === 'cli' && connection.machineId
          ? await this.websocketAuthorizationService.authorizeMachine({
              machineId: connection.machineId,
              userId: connection.userId,
              ...requestedScope,
            })
          : await this.websocketAuthorizationService.authorize({
              userId: connection.userId,
              ...requestedScope,
            });

      if (!roomDecision.authorized) {
        this.logger.warn('[WebSocket] Subscription room access denied', {
          socketId: client.id,
          userId: connection.userId,
          requestedCounts: {
            projects: projectIds?.length ?? 0,
            conversations: conversationIds?.length ?? 0,
            initiatives: initiativeIds?.length ?? 0,
            designDocs: designDocIds?.length ?? 0,
          },
        });
        client.emit('subscribed', this.roomAccessDenied());
        return this.roomAccessDenied();
      }

      if (
        this.connectionManager.getConnection(client.id) !== connection ||
        client.disconnected
      )
        return this.roomAccessDenied();

      disconnectOnFailure = connection.clientType === 'browser';
      await this.connectionManager.subscribe(
        client.id,
        eventTypes,
        (projectIds as ProjectId[]) || [],
        (conversationIds as ConversationId[]) || [],
        (initiativeIds as InitiativeId[]) || [],
        (designDocIds as DesignDocId[]) || [],
      );
      this.connectionManager.updateActivity(client.id);

      const response: WebSocketSubscribedResponse = {
        status: 'success',
        eventTypes,
        projectIds: projectIds ?? [],
        conversationIds: conversationIds ?? [],
        initiativeIds: initiativeIds ?? [],
        designDocIds: designDocIds ?? [],
      };
      if (
        this.connectionManager.getConnection(client.id) !== connection ||
        client.disconnected
      )
        return this.roomAccessDenied();
      client.emit('subscribed', response);

      for (const conversationId of conversationIds ?? []) {
        await this.maybeReplayMachineRepoBindings(client, conversationId);
        await this.maybeReplayConversationPhase(client, conversationId);
      }

      this.logger.verbose(`Client subscribed: ${client.id}`, payload);
      return response;
    } catch (error) {
      if (disconnectOnFailure) client.disconnect(true);
      this.logger.error('Subscription authorization failed', error);
      client.emit('subscribed', this.roomAccessDenied());
      return this.roomAccessDenied();
    }
  }

  /**
   * Confirm browser departure only after membership and bookkeeping removal.
   */
  @SubscribeMessage('leave')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WebSocketLeaveRoomRequest,
  ): Promise<WebSocketLeftResponse> {
    const connection = this.connectionManager.getConnection(client.id);
    const valid =
      payload &&
      typeof payload === 'object' &&
      Object.values(WebSocketLeaveRoomRequest.RoomTypeEnum).includes(
        payload.roomType,
      ) &&
      typeof payload.roomId === 'string' &&
      payload.roomId.length > 0 &&
      Object.keys(payload).every(
        (key) => key === 'roomType' || key === 'roomId',
      );
    if (
      !valid ||
      connection?.clientType !== 'browser' ||
      !connection.userId ||
      !this.websocketUserConnectionLifecycle.hasRegistration(client.id)
    )
      return this.roomAccessDenied();
    return this.connectionManager.serializeRoomOperation(
      client.id,
      async () => {
        try {
          if (
            this.connectionManager.getConnection(client.id) !== connection ||
            client.disconnected
          )
            return this.roomAccessDenied();
          await this.connectionManager.leaveRoom(client.id, payload);
          if (!this.websocketUserConnectionLifecycle.hasRegistration(client.id))
            return this.roomAccessDenied();
          return {
            status: 'success',
            roomType: payload.roomType,
            roomId: payload.roomId,
          };
        } catch {
          return this.roomAccessDenied();
        }
      },
    );
  }

  publishOpenItemsChanged(
    userId: string,
    projectId: string,
    revision: number,
  ): void {
    const event = {
      type: 'open_items.changed',
      projectId,
      revision,
    } satisfies import('src/generated').WebSocketOpenItemsChangedEvent;
    this.server
      .to(`open-items:${userId}:${projectId}`)
      .emit('open_items.changed', event);
  }

  @SubscribeMessage('join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WebSocketJoinRoomRequest,
  ) {
    const connection = this.connectionManager.getConnection(client.id);
    return this.connectionManager.serializeRoomOperation(
      client.id,
      async () => {
        if (
          !connection ||
          this.connectionManager.getConnection(client.id) !== connection ||
          client.disconnected
        ) {
          client.emit('joined', this.roomAccessDenied());
          return this.roomAccessDenied();
        }
        return this.handleJoinRoomOperation(client, payload);
      },
    );
  }

  private async handleJoinRoomOperation(
    client: Socket,
    payload: WebSocketJoinRoomRequest,
  ) {
    let disconnectOnFailure = false;
    try {
      const {
        projectId,
        conversationId,
        initiativeId,
        designDocId,
        openItemsProjectId,
      } = payload;

      const connection = this.connectionManager.getConnection(client.id);
      if (!connection?.userId) {
        this.logger.warn('[WebSocket] Join denied before auth', {
          socketId: client.id,
          reason: 'authentication_required',
        });
        client.emit('joined', this.roomAccessDenied());
        return this.roomAccessDenied();
      }

      if (openItemsProjectId && connection.clientType !== 'browser')
        return this.roomAccessDenied();
      const requestedScope = {
        organizationIds: connection.organizationIds,
        projectIds: [
          ...(projectId ? [projectId as ProjectId] : []),
          ...(openItemsProjectId ? [openItemsProjectId as ProjectId] : []),
        ],
        conversationIds: conversationId
          ? [conversationId as ConversationId]
          : [],
        initiativeIds: initiativeId ? [initiativeId as InitiativeId] : [],
        designDocIds: designDocId ? [designDocId as DesignDocId] : [],
      };
      const roomDecision =
        connection.clientType === 'cli' && connection.machineId
          ? await this.websocketAuthorizationService.authorizeMachine({
              machineId: connection.machineId,
              userId: connection.userId,
              ...requestedScope,
            })
          : await this.websocketAuthorizationService.authorize({
              userId: connection.userId,
              ...requestedScope,
            });

      if (!roomDecision.authorized) {
        this.logger.warn('[WebSocket] Join room access denied', {
          socketId: client.id,
          userId: connection.userId,
          requestedCounts: {
            project: projectId ? 1 : 0,
            conversation: conversationId ? 1 : 0,
            initiative: initiativeId ? 1 : 0,
            designDoc: designDocId ? 1 : 0,
          },
        });
        client.emit('joined', this.roomAccessDenied());
        return this.roomAccessDenied();
      }

      if (
        this.connectionManager.getConnection(client.id) !== connection ||
        client.disconnected
      )
        return this.roomAccessDenied();

      disconnectOnFailure = connection.clientType === 'browser';
      if (projectId) {
        await this.connectionManager.addProjectSubscription(
          client.id,
          projectId as ProjectId,
        );
      }

      if (conversationId) {
        await this.connectionManager.addConversationSubscription(
          client.id,
          conversationId as ConversationId,
        );
        await this.maybeReplayMachineRepoBindings(client, conversationId);
        await this.maybeReplayConversationPhase(client, conversationId);
      }

      if (initiativeId) {
        await this.connectionManager.addInitiativeSubscription(
          client.id,
          initiativeId as InitiativeId,
        );
      }

      if (designDocId) {
        await this.connectionManager.addDesignDocSubscription(
          client.id,
          designDocId as DesignDocId,
        );
      }

      if (openItemsProjectId)
        await this.connectionManager.addOpenItemsSubscription(
          client.id,
          openItemsProjectId,
        );
      this.connectionManager.updateActivity(client.id);

      const response: WebSocketJoinedResponse = {
        status: 'success',
        openItemsProjectId,
        projectId,
        conversationId,
        initiativeId,
        designDocId,
      };
      if (
        this.connectionManager.getConnection(client.id) !== connection ||
        client.disconnected
      )
        return this.roomAccessDenied();
      client.emit('joined', response);

      this.logger.verbose(`[WebSocket] Client joined rooms`, {
        socketId: client.id,
        requestedRooms: payload,
        joinedChannels: {
          project: projectId ? `project:${projectId}` : null,
          conversation: conversationId
            ? `conversation:${conversationId}`
            : null,
          initiative: initiativeId ? `initiative:${initiativeId}` : null,
          designDoc: designDocId ? `design-doc:${designDocId}` : null,
        },
      });
      return response;
    } catch (error) {
      if (disconnectOnFailure) client.disconnect(true);
      this.logger.error('Join room authorization failed', error);
      client.emit('joined', this.roomAccessDenied());
      return this.roomAccessDenied();
    }
  }

  /**
   * Handle ping for connection keepalive
   */
  @SubscribeMessage('ping')
  async handlePing(@ConnectedSocket() client: Socket) {
    this.connectionManager.updateActivity(client.id);
    client.emit('pong', { timestamp: new Date().toISOString() });
  }

  /**
   * Consume the CLI's periodic presence heartbeat.
   *
   * The CLI emits this every ~30s over its already-authenticated socket so the
   * platform keeps presence fresh instead of treating the one-time auth as the
   * only signal. Two effects, both idempotent and side-effect-light:
   *  - refresh the connection's in-memory `lastActivity` so the activity
   *    timestamp reflects a live, working CLI; and
   *  - stamp the machine's durable `lastSeen` (the Settings → Machines list
   *    reads it), keyed on the VERIFIED machineId bound to this connection at
   *    auth — never the machineId in the frame body, so a socket can only ever
   *    refresh the machine it actually proved possession of.
   *
   * There is no reply frame: the heartbeat is one-way liveness, not a
   * request/response. A heartbeat from a connection with no bound machine
   * (e.g. a browser) still refreshes in-memory activity but persists nothing.
   */
  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() _payload: WebSocketHeartbeat,
  ) {
    this.connectionManager.updateActivity(client.id);

    const connection = this.connectionManager.getConnection(client.id);
    const machineId = connection?.machineId;
    if (!machineId) {
      this.logger.verbose('[heartbeat] no bound machine; activity-only', {
        socketId: client.id,
        userId: connection?.userId,
      });
      return;
    }

    // Fire-and-forget: a slow or failed lastSeen write must not stall the
    // socket's event loop or surface an error to the CLI. recordLastSeen
    // swallows and logs its own failures.
    void this.machineChallengeService.recordLastSeen(machineId);
    void this.machinePresenceService.setPresence(
      machineId,
      connection.userId as UserId,
    );
    void this.machinePresenceService.refreshBindingsTtl(machineId);
    this.logger.verbose('[heartbeat] refreshed presence', {
      socketId: client.id,
      userId: connection?.userId,
      machineId,
    });
  }

  /**
   * Receive a CLI observation for an Agent Session. Identity and scope are
   * resolved from the authenticated socket and durable Agent Session row;
   * the inbound frame is never allowed to choose its own project or machine.
   */
  @SubscribeMessage('agent_session.current_state_observed')
  async handleAgentSessionCurrentStateObserved(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentSessionCurrentStateObservation,
  ): Promise<void> {
    const connection = this.connectionManager.getConnection(client.id);
    if (
      !connection?.userId ||
      !connection.machineId ||
      connection.clientType !== 'cli'
    ) {
      this.logger.warn('[current-state] rejected from unauthenticated socket', {
        socketId: client.id,
        clientType: connection?.clientType,
        hasUser: Boolean(connection?.userId),
        hasMachine: Boolean(connection?.machineId),
      });
      return;
    }

    try {
      const result = await this.agentSessionService.observeCurrentState(
        {
          connectionId: client.id,
          userId: connection.userId,
          machineId: connection.machineId,
          organizationIds: connection.organizationIds,
          projectIds: connection.projectIds,
        },
        payload,
      );
      this.logger.verbose('[current-state] observation processed', {
        socketId: client.id,
        agentSessionId: payload.agentSessionId,
        currentState: payload.currentState,
        outcome: result.outcome,
      });
    } catch (error) {
      this.logger.warn('[current-state] observation rejected', {
        socketId: client.id,
        agentSessionId: payload.agentSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Receive a CLI turn-end context-size reading for an Agent Session. Like
   * current-state observations, identity and scope come from the
   * authenticated socket and durable Agent Session row; an applied reading is
   * relayed to the project room as `agent_session.context_size_changed`.
   */
  @SubscribeMessage('agent_session.context_size_observed')
  async handleAgentSessionContextSizeObserved(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentSessionContextSizeObservation,
  ): Promise<void> {
    const connection = this.connectionManager.getConnection(client.id);
    if (
      !connection?.userId ||
      !connection.machineId ||
      connection.clientType !== 'cli'
    ) {
      this.logger.warn('[context-size] rejected from unauthenticated socket', {
        socketId: client.id,
        clientType: connection?.clientType,
        hasUser: Boolean(connection?.userId),
        hasMachine: Boolean(connection?.machineId),
      });
      return;
    }

    try {
      const result = await this.agentSessionService.observeContextSize(
        {
          connectionId: client.id,
          userId: connection.userId,
          machineId: connection.machineId,
          organizationIds: connection.organizationIds,
          projectIds: connection.projectIds,
        },
        payload,
      );
      this.logger.verbose('[context-size] observation processed', {
        socketId: client.id,
        agentSessionId: payload.agentSessionId,
        totalTokens: payload.totalTokens,
        outcome: result.outcome,
      });
      if (result.outcome === 'applied') {
        this.emitAgentSessionContextSizeChanged({
          organizationId: result.organizationId,
          projectId: result.projectId,
          userId: result.userId,
          conversationId: result.conversationId,
          agentSessionId: payload.agentSessionId,
          contextSize: result.contextSize,
        });
      }
    } catch (error) {
      this.logger.warn('[context-size] observation rejected', {
        socketId: client.id,
        agentSessionId: payload.agentSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Receive a CLI observation for the conversation-scoped Run phase. The
   * authenticated socket and its authorized conversation rooms provide the
   * boundary; project and organization scope are resolved from the durable
   * conversation row rather than trusted from the frame.
   */
  @SubscribeMessage('conversation.phase_observed')
  async handleConversationPhaseObserved(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationPhaseObservation,
  ): Promise<void> {
    const connection = this.connectionManager.getConnection(client.id);
    if (
      !connection?.userId ||
      !connection.machineId ||
      connection.clientType !== 'cli'
    ) {
      this.logger.warn(
        '[conversation-phase] rejected from unauthenticated socket',
        {
          socketId: client.id,
          clientType: connection?.clientType,
          hasUser: Boolean(connection?.userId),
          hasMachine: Boolean(connection?.machineId),
        },
      );
      return;
    }
    if (
      !connection.conversationIds.includes(
        payload.conversationId as ConversationId,
      )
    ) {
      this.logger.warn(
        '[conversation-phase] rejected outside authorized conversation scope',
        {
          socketId: client.id,
          conversationId: payload.conversationId,
          machineId: connection.machineId,
        },
      );
      return;
    }
    if (!this.conversationPhaseProjection || !this.prisma) {
      this.logger.error(
        '[conversation-phase] projection dependencies are unavailable',
        {
          socketId: client.id,
          conversationId: payload.conversationId,
        },
      );
      return;
    }

    try {
      const conversation = await this.prisma.db.conversation.findFirst({
        where: {
          id: payload.conversationId,
          organizationId: { in: connection.organizationIds },
          status: { not: 'DELETED' },
        },
        select: { id: true, organizationId: true, projectId: true },
      });
      if (!conversation?.projectId) {
        this.logger.warn('[conversation-phase] conversation scope not found', {
          socketId: client.id,
          conversationId: payload.conversationId,
        });
        return;
      }

      const result = await this.conversationPhaseProjection.observe(
        {
          connectionId: client.id,
          userId: connection.userId,
          machineId: connection.machineId,
          organizationId: conversation.organizationId,
          projectId: conversation.projectId,
          conversationId: conversation.id,
        },
        payload.phase,
        payload.observedAt,
      );
      this.logger.verbose('[conversation-phase] observation processed', {
        socketId: client.id,
        conversationId: payload.conversationId,
        phase: payload.phase,
        outcome: result.outcome,
      });
    } catch (error) {
      this.logger.warn('[conversation-phase] observation rejected', {
        socketId: client.id,
        conversationId: payload.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @SubscribeMessage('provider.identity')
  async handleProviderIdentity(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ProviderIdentityInboundPayload,
  ): Promise<void> {
    const connection = this.connectionManager.getConnection(client.id);
    if (!connection?.machineId) {
      this.logger.warn('[provider.identity] rejected from non-machine socket', {
        socketId: client.id,
      });
      return;
    }

    const organizationId = connection.organizationIds[0];
    if (!organizationId) {
      this.logger.warn(
        '[provider.identity] rejected — machine socket has no organization',
        { socketId: client.id },
      );
      return;
    }

    const { agentSessionId, providerSessionId, providerConversationId } =
      payload;

    // The platform stores a single canonical provider id. Prefer the
    // conversation id when the provider exposes one (Codex), else the session
    // id (Claude) — identical to the resolution the host browser used in
    // `bindProviderSessionId` before the CLI took over authorship.
    const canonicalProviderId =
      providerConversationId?.trim() || providerSessionId.trim();
    if (!canonicalProviderId) {
      this.logger.warn('[provider.identity] rejected — no provider id', {
        socketId: client.id,
        agentSessionId,
      });
      return;
    }

    try {
      await this.agentSessionService.update(
        organizationId as OrganizationId,
        agentSessionId,
        {
          agentSessionId: canonicalProviderId,
          machineId: connection.machineId,
        },
      );
      this.logger.verbose('[provider.identity] persisted', {
        socketId: client.id,
        agentSessionId,
        canonicalProviderId,
      });
    } catch (error) {
      this.logger.error('[provider.identity] persist failed', {
        socketId: client.id,
        agentSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @SubscribeMessage('machine.repo_bindings.updated')
  async handleMachineRepoBindingsUpdated(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MachineRepoBindingsInboundPayload,
  ): Promise<void> {
    const connection = this.connectionManager.getConnection(client.id);
    if (!connection?.machineId) {
      this.logger.warn(
        '[machine.repo_bindings.updated] rejected from non-machine socket',
        { socketId: client.id },
      );
      return;
    }

    const organizationId = connection.organizationIds[0];
    if (!organizationId) {
      this.logger.warn(
        '[machine.repo_bindings.updated] rejected — machine socket has no organization',
        { socketId: client.id },
      );
      return;
    }

    const machineId = connection.machineId;
    const { bindings } = payload;

    await this.machinePresenceService.setBindings(
      machineId,
      bindings,
      organizationId,
      client.id,
    );

    const event = this.buildMachineRepoBindingsEvent(
      machineId,
      bindings,
      organizationId,
    );
    for (const conversationId of connection.conversationIds) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('machine.repo_bindings', event);
    }

    this.logger.verbose(
      '[machine.repo_bindings.updated] cached and fanned out',
      {
        socketId: client.id,
        machineId,
        bindingCount: bindings.length,
        conversationCount: connection.conversationIds.length,
      },
    );
  }

  @SubscribeMessage('auth_revoked')
  async handleAuthRevoked(@ConnectedSocket() client: Socket): Promise<void> {
    const conn = this.connectionManager.getConnection(client.id);
    if (!conn?.machineId || !conn?.userId) {
      this.logger.warn(
        '[auth_revoked] received from non-machine or unauthenticated socket',
        {
          socketId: client.id,
        },
      );
      return;
    }

    const machineId = conn.machineId;
    const userId = conn.userId;

    try {
      await this.agentSessionService.clearRuntimeCurrentState({
        connectionId: client.id,
        userId,
        machineId,
        organizationIds: conn.organizationIds,
      });
    } catch (error) {
      this.logger.error(
        '[current-state] credential-revocation transition failed',
        {
          socketId: client.id,
          machineId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const cached = await this.machinePresenceService.getBindings(machineId);
    const organizationId = cached?.organizationId ?? conn.organizationIds[0];

    if (organizationId) {
      const event = this.buildMachineRepoBindingsEvent(
        machineId,
        [],
        organizationId,
      );
      for (const conversationId of conn.conversationIds) {
        this.server
          .to(`conversation:${conversationId}`)
          .emit('machine.repo_bindings', event);
      }
    }

    await this.machinePresenceService.removeBindings(machineId);
    await this.machinePresenceService.removePresence(machineId, userId);

    this.connectionManager.removeConnection(client.id);
    client.disconnect();

    this.logger.log('[auth_revoked] evicted machine presence and bindings', {
      socketId: client.id,
      machineId,
      userId,
    });
  }

  private async maybeReplayMachineRepoBindings(
    socket: Socket,
    conversationId: string,
  ): Promise<void> {
    const connections = this.connectionManager.getConversationConnections(
      conversationId as ConversationId,
    );
    const machineConn = connections.find((conn) => conn.machineId);
    if (!machineConn?.machineId) return;

    const cached = await this.machinePresenceService.getBindings(
      machineConn.machineId,
    );
    if (!cached) return;

    const event = this.buildMachineRepoBindingsEvent(
      machineConn.machineId,
      cached.bindings,
      cached.organizationId,
    );
    socket.emit('machine.repo_bindings', event);
    this.logger.verbose('[machine.repo_bindings] replayed cached bindings', {
      socketId: socket.id,
      conversationId,
      machineId: machineConn.machineId,
      bindingCount: cached.bindings.length,
    });
  }

  private async maybeReplayConversationPhase(
    socket: Socket,
    conversationId: string,
  ): Promise<void> {
    if (!this.conversationPhaseProjection || !this.prisma) return;
    const connection = this.connectionManager.getConnection(socket.id);
    if (!connection?.userId) return;

    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: { in: connection.organizationIds },
        status: { not: 'DELETED' },
      },
      select: { id: true, organizationId: true, projectId: true },
    });
    if (!conversation?.projectId) return;

    const entry = await this.conversationPhaseProjection.read(conversationId);
    const event = entry
      ? this.buildConversationPhaseChangedEvent(entry)
      : this.buildIdleConversationPhaseEvent({
          organizationId: conversation.organizationId,
          projectId: conversation.projectId,
          conversationId: conversation.id,
        });
    socket.emit('conversation.phase_changed', event);
    this.logger.verbose('[conversation-phase] replayed room snapshot', {
      socketId: socket.id,
      conversationId,
      phase: event.phase,
      revision: event.revision,
      source: entry ? 'projection' : 'idle_fallback',
    });
  }

  private buildConversationPhaseChangedEvent(
    entry: ConversationPhaseProjectionEntry,
  ): WebSocketConversationPhaseChangedEvent {
    return {
      type: WebSocketConversationPhaseChangedEvent.TypeEnum
        .ConversationPhaseChanged,
      timestamp: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      conversationId: entry.conversationId,
      phase: entry.phase,
      revision: entry.revision,
      transitionedAt: entry.transitionedAt,
    };
  }

  private buildIdleConversationPhaseEvent(input: {
    organizationId: string;
    projectId: string;
    conversationId: string;
  }): WebSocketConversationPhaseChangedEvent {
    const now = new Date().toISOString();
    return {
      type: WebSocketConversationPhaseChangedEvent.TypeEnum
        .ConversationPhaseChanged,
      timestamp: now,
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      phase: 'idle',
      revision: 0,
      transitionedAt: now,
    };
  }

  private buildMachineRepoBindingsEvent(
    machineId: string,
    bindings: ServiceRepoBinding[],
    organizationId: string,
  ): WebSocketMachineRepoBindingsEvent {
    return {
      type: WebSocketMachineRepoBindingsEvent.TypeEnum.MachineRepoBindings,
      timestamp: new Date().toISOString(),
      organizationId,
      machineId,
      bindings,
    };
  }

  /**
   * Get connection statistics
   */
  @SubscribeMessage('stats')
  async handleStats(@ConnectedSocket() client: Socket) {
    try {
      const stats = this.connectionManager.getStats();
      client.emit('stats', stats);
    } catch (error) {
      this.logger.error('Stats request failed', error);
      client.emit('stats', { error: 'Failed to get stats' });
    }
  }

  /**
   * Debug method: Log all current WebSocket channel subscriptions
   */
  @SubscribeMessage('debug_channels')
  async handleDebugChannels(@ConnectedSocket() client: Socket) {
    try {
      this.connectionManager.logAllChannelSubscriptions();
      client.emit('debug_channels', {
        status: 'success',
        message: 'Channel subscriptions logged to server console',
      });
    } catch (error) {
      this.logger.error('Debug channels request failed', error);
      client.emit('debug_channels', { error: 'Failed to log channels' });
    }
  }

  /**
   * Typed event emission methods - Message Events
   */
  public emitMessageCreated(event: WebSocketMessageCreatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('message.created', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('message.created', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitMessageUpdated(event: WebSocketMessageUpdatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('message.updated', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('message.updated', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitMessageRealtime(event: WebSocketMessageRealtimeEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('message.realtime', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('message.realtime', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitMessageDeleted(event: WebSocketMessageDeletedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('message.deleted', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('message.deleted', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Conversation Events
   */
  public emitConversationCreated(
    event: WebSocketConversationCreatedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('conversation.created', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('conversation.created', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitConversationUpdated(
    event: WebSocketConversationUpdatedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('conversation.updated', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('conversation.updated', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitConversationStatusChanged(
    event: WebSocketConversationStatusChangedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('conversation.status_changed', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('conversation.status_changed', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Project Events
   */
  public emitProjectCreated(event: WebSocketProjectCreatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('project.created', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitProjectUpdated(event: WebSocketProjectUpdatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('project.updated', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitProjectStatusChanged(
    event: WebSocketProjectStatusChangedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('project.status_changed', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Initiative Events
   */
  public emitInitiativeCreated(event: WebSocketInitiativeCreatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('initiative.created', event);
      }
      if (event.initiativeId) {
        this.server
          .to(`initiative:${event.initiativeId}`)
          .emit('initiative.created', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Task Events
   */
  public emitTaskCreated(event: WebSocketTaskCreatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('task.created', event);
      }

      const initiativeChannel = `initiative:${event.initiativeId}`;
      this.server.to(initiativeChannel).emit('task.created', event);
    };

    this.bufferOrEmit(emitFunc);
  }

  public emitTaskUpdated(event: WebSocketTaskUpdatedEvent): void {
    const emitFunc = () => {
      const channels: string[] = [];

      if (event.projectId) {
        const projectChannel = `project:${event.projectId}`;
        channels.push(projectChannel);
        this.server.to(projectChannel).emit('task.updated', event);
      }

      const initiativeChannel = `initiative:${event.initiativeId}`;
      channels.push(initiativeChannel);

      this.logger.verbose('[WebSocket] Emitting task.updated event', {
        eventType: 'task.updated',
        taskId: event.taskId,
        initiativeId: event.initiativeId,
        projectId: event.projectId,
        channels,
        eventTimestamp: event.timestamp,
        changedFields: event.changedFields || [],
        totalFieldsChanged: event.totalFieldsChanged,
      });

      this.server.to(initiativeChannel).emit('task.updated', event);
    };

    this.bufferOrEmit(emitFunc);
  }

  public emitTaskStatusChanged(event: WebSocketTaskStatusChangedEvent): void {
    const emitFunc = async () => {
      const projectRoom = event.projectId ? `project:${event.projectId}` : null;
      const initiativeRoom = event.initiativeId
        ? `initiative:${event.initiativeId}`
        : null;
      const projectSocketIds = projectRoom
        ? [...(await this.server.in(projectRoom).allSockets())]
        : [];
      const initiativeSocketIds = initiativeRoom
        ? [...(await this.server.in(initiativeRoom).allSockets())]
        : [];
      this.logger.debug('emitTaskStatusChanged', {
        taskId: event.taskId,
        projectId: event.projectId,
        initiativeId: event.initiativeId,
        newStatus: event.newStatus,
        projectRoom,
        initiativeRoom,
        projectRoomSize: projectSocketIds.length,
        initiativeRoomSize: initiativeSocketIds.length,
      });
      if (projectRoom) {
        this.server.to(projectRoom).emit('task.status_changed', event);
      }
      if (initiativeRoom) {
        this.server.to(initiativeRoom).emit('task.status_changed', event);
      }
    };

    this.bufferOrEmit(() => void emitFunc());
  }

  /**
   * Typed event emission methods - Design Doc Events
   */
  public emitDesignDocCreated(event: WebSocketDesignDocCreatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('design_doc.created', event);
      }

      const designDocChannel = `design-doc:${event.designDocId}`;
      this.server.to(designDocChannel).emit('design_doc.created', event);
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitDesignDocUpdated(event: WebSocketDesignDocUpdatedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('design_doc.updated', event);
      }

      const designDocChannel = `design-doc:${event.designDocId}`;
      this.server.to(designDocChannel).emit('design_doc.updated', event);
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitDesignDocStatusChanged(
    event: WebSocketDesignDocStatusChangedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('design_doc.status_changed', event);
      }

      const designDocChannel = `design-doc:${event.designDocId}`;
      this.server.to(designDocChannel).emit('design_doc.status_changed', event);
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitInitiativeUpdated(event: WebSocketInitiativeUpdatedEvent): void {
    const emitFunc = () => {
      const channels: string[] = [];

      // TODO: we don't need this yet, let's re-examine when we do
      // Send lightweight notification to project channels
      // if (event.projectId) {
      //   const lightPayload = {
      //     type: 'initiative.updated',
      //     timestamp: event.timestamp,
      //     initiativeId: event.initiativeId,
      //     name: 'initiative name', // Would need to be fetched from API
      //     lastModifiedBy: {
      //       userId: event.userId,
      //       // Extract name from event if available
      //       name: event.userId, // TODO: Get actual name from user service
      //     },
      //     lastModifiedAt: event.timestamp,
      //     changedFields: event.changedFields || [],
      //   };

      //   const projectChannel = `project:${event.projectId}`;
      //   channels.push(projectChannel);
      //   this.server
      //     .to(projectChannel)
      //     .emit('initiative.updated.light', lightPayload);
      // }

      // Send full payload to initiative channels
      if (event.initiativeId) {
        const fullPayload = {
          ...event,
        };

        const initiativeChannel = `initiative:${event.initiativeId}`;
        channels.push(initiativeChannel);

        this.logger.verbose('[WebSocket] Emitting initiative.updated event', {
          eventType: 'initiative.updated',
          initiativeId: event.initiativeId,
          projectId: event.projectId,
          channels: channels,
          targetChannel: initiativeChannel,
          payloadKeys: Object.keys(fullPayload),
          eventTimestamp: event.timestamp,
        });

        this.server
          .to(initiativeChannel)
          .emit('initiative.updated', fullPayload);

        // Log which clients are connected to this channel
        const connectedClients = this.server.in(initiativeChannel).allSockets();
        connectedClients.then((socketIds) => {
          this.logger.verbose('[WebSocket] Channel subscriber info', {
            channel: initiativeChannel,
            subscriberCount: socketIds.size,
            socketIds: Array.from(socketIds),
          });
        });
      } else {
        this.logger.warn(
          '[WebSocket] No initiativeId provided for initiative.updated event',
          {
            event: event,
            eventKeys: Object.keys(event),
          },
        );
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitInitiativeStatusChanged(
    event: WebSocketInitiativeStatusChangedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('initiative.status_changed', event);
      }
      if (event.initiativeId) {
        this.server
          .to(`initiative:${event.initiativeId}`)
          .emit('initiative.status_changed', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Agent Session Events
   */
  public emitAgentSessionCreated(
    event: WebSocketAgentSessionCreatedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('agent_session.created', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('agent_session.created', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitAgentSessionDeleted(
    event: WebSocketAgentSessionDeletedEvent,
  ): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('agent_session.deleted', event);
      }
      if (event.conversationId) {
        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('agent_session.deleted', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitAgentSessionStatusChanged(
    event: WebSocketAgentSessionStatusChangedEvent,
  ): void {
    const emitFunc = async () => {
      const projectRoom = event.projectId ? `project:${event.projectId}` : null;
      const conversationRoom = event.conversationId
        ? `conversation:${event.conversationId}`
        : null;
      const projectSocketIds = projectRoom
        ? [...(await this.server.in(projectRoom).allSockets())]
        : [];
      const conversationSocketIds = conversationRoom
        ? [...(await this.server.in(conversationRoom).allSockets())]
        : [];
      this.logger.debug('emitAgentSessionStatusChanged', {
        agentSessionId: event.agentSessionId,
        projectId: event.projectId,
        conversationId: event.conversationId,
        newStatus: event.newStatus,
        projectRoom,
        conversationRoom,
        projectRoomSize: projectSocketIds.length,
        conversationRoomSize: conversationSocketIds.length,
      });
      if (projectRoom) {
        this.server.to(projectRoom).emit('agent_session.status_changed', event);
      }
      if (conversationRoom) {
        this.server
          .to(conversationRoom)
          .emit('agent_session.status_changed', event);
      }
    };
    this.bufferOrEmit(() => void emitFunc());
  }

  public emitAgentSessionCurrentStateChanged(
    entry: AgentSessionCurrentStateProjectionEntry,
  ): void {
    const event: WebSocketAgentSessionCurrentStateChangedEvent = {
      type: WebSocketAgentSessionCurrentStateChangedEvent.TypeEnum
        .AgentSessionCurrentStateChanged,
      timestamp: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      conversationId: entry.conversationId ?? undefined,
      userId: entry.userId,
      agentSessionId: entry.agentSessionId,
      currentState: entry.currentState,
      revision: entry.revision,
      transitionedAt: entry.transitionedAt,
    };
    this.bufferOrEmit(() => {
      const projectRoom = `project:${entry.projectId}`;
      this.server
        .to(projectRoom)
        .emit(
          WebSocketSubscriptionRequest.EventTypesEnum
            .AgentSessionCurrentStateChanged,
          event,
        );
      this.logger.debug('[current-state] project fan-out', {
        projectRoom,
        agentSessionId: entry.agentSessionId,
        revision: entry.revision,
        currentState: entry.currentState,
      });
    });
  }

  public emitAgentSessionContextSizeChanged(entry: {
    organizationId: string;
    projectId: string;
    userId: string;
    conversationId: string | null;
    agentSessionId: string;
    contextSize: AgentSessionContextSize;
  }): void {
    const event: WebSocketAgentSessionContextSizeChangedEvent = {
      type: WebSocketAgentSessionContextSizeChangedEvent.TypeEnum
        .AgentSessionContextSizeChanged,
      timestamp: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      conversationId: entry.conversationId ?? undefined,
      userId: entry.userId,
      agentSessionId: entry.agentSessionId,
      contextSize: entry.contextSize,
    };
    this.bufferOrEmit(() => {
      const projectRoom = `project:${entry.projectId}`;
      this.server
        .to(projectRoom)
        .emit(
          WebSocketSubscriptionRequest.EventTypesEnum
            .AgentSessionContextSizeChanged,
          event,
        );
      this.logger.debug('[context-size] project fan-out', {
        projectRoom,
        agentSessionId: entry.agentSessionId,
        totalTokens: entry.contextSize.totalTokens,
      });
    });
  }

  public emitConversationPhaseChanged(
    entry: ConversationPhaseProjectionEntry,
  ): void {
    const event: WebSocketConversationPhaseChangedEvent = {
      type: WebSocketConversationPhaseChangedEvent.TypeEnum
        .ConversationPhaseChanged,
      timestamp: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      conversationId: entry.conversationId,
      phase: entry.phase,
      revision: entry.revision,
      transitionedAt: entry.transitionedAt,
    };
    this.bufferOrEmit(() => {
      this.server
        .to(`conversation:${entry.conversationId}`)
        .emit('conversation.phase_changed', event);
      this.logger.debug('[conversation-phase] conversation fan-out', {
        conversationId: entry.conversationId,
        phase: entry.phase,
        revision: entry.revision,
      });
    });
  }

  public emitAgentSessionOutputAttentionChanged(
    entry: AgentSessionOutputAttentionProjectionEntry,
  ): void {
    const event: WebSocketAgentSessionOutputAttentionChangedEvent = {
      type: WebSocketAgentSessionOutputAttentionChangedEvent.TypeEnum
        .AgentSessionOutputAttentionChanged,
      timestamp: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      userId: entry.userId,
      agentSessionId: entry.agentSessionId,
      state: entry.state,
      revision: entry.revision,
      changedAt: entry.changedAt,
    };
    this.bufferOrEmit(() => {
      this.server
        .to(`user:${entry.userId}`)
        .emit(
          WebSocketSubscriptionRequest.EventTypesEnum
            .AgentSessionOutputAttentionChanged,
          event,
        );
      this.logger.debug('[output-attention] user fan-out', {
        agentSessionId: entry.agentSessionId,
        userId: entry.userId,
        revision: entry.revision,
        state: entry.state,
      });
    });
  }

  /**
   * Typed event emission methods - Proposal Events
   */
  public emitProposalApproved(event: WebSocketProposalApprovedEvent): void {
    const emitFunc = () => {
      if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('proposal.approved', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitProposalGroupLifecycle(
    event: WebSocketProposalGroupLifecycleEvent,
  ): void {
    this.bufferOrEmit(() => {
      this.server
        .to(`project:${event.projectId}`)
        .emit('proposal_group.lifecycle', event);
    });
  }

  /**
   * Eval progress events keep the standard event envelope and go to the
   * project room, which only authorized project members can join.
   */
  public emitEvalRunUpdated(event: EvalRunUpdatedEvent): void {
    this.bufferOrEmit(() => {
      this.server
        .to(`project:${event.payload.projectId}`)
        .emit('eval_run.updated', event);
    });
  }

  public emitEvalAttemptUpdated(event: EvalAttemptUpdatedEvent): void {
    this.bufferOrEmit(() => {
      this.server
        .to(`project:${event.payload.projectId}`)
        .emit('eval_attempt.updated', event);
    });
  }

  /**
   * System Events
   */
  public emitSystemNotification(event: WebSocketSystemNotificationEvent): void {
    const emitFunc = () => {
      if (event.userId) {
        this.server
          .to(`user:${event.userId}`)
          .emit('system.notification', event);
      } else if (event.projectId) {
        this.server
          .to(`project:${event.projectId}`)
          .emit('system.notification', event);
      } else {
        this.server.emit('system.notification', event);
      }
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Announce a newly recorded machine security event to the machine's owner.
   * Machines are user-scoped, so this routes purely to the `user:${userId}`
   * room — the same delivery path system notifications use — and never to a
   * project/org room. Display/cache-only: it carries no signed envelope and the
   * client treats it as a feed update, never as an execution trigger.
   */
  public emitMachineSecurityEvent(
    event: WebSocketMachineSecurityEventEvent,
  ): void {
    const emitFunc = () => {
      this.server
        .to(`user:${event.userId}`)
        .emit('machine_security_event', event);
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Typed event emission methods - Signed Trigger Frames
   *
   * Trigger frames carry a server-signed, machine-addressed envelope. Unlike
   * every domain-event emitter above, they are routed ONLY to the recipient's
   * `machine:${machineId}` room — never the `user:`, `project:`, or
   * `conversation:` rooms — so a machine-addressed command reaches only the
   * verified CLI machine connection, and UI/browser connections (which never
   * join a machine room) do not receive trigger envelopes at all. The room is
   * keyed on `envelope.machineId`, the cryptographically-bound recipient, so
   * routing cannot drift from the binding. Only a connection that completed
   * the challenge-response handshake joins this room.
   */
  public emitConversationTrigger(
    event:
      | WebSocketConversationTriggerEvent
      | LegacyWebSocketConversationTriggerEvent,
  ): void {
    if (!this.hasProtocol2Authorization(event)) {
      this.logger.warn(
        '[trigger-emit] dropped non-protocol-2 conversation frame',
      );
      return;
    }
    classifyHostAffectingFrame(event);
    const emitFunc = async () => {
      const room = `machine:${event.envelope.machineId}`;
      // `this.server` is the `/events` Namespace (NestJS injects the
      // Namespace for a namespaced gateway), so room membership must be
      // read through the namespace-scoped `in(room)` API — same call the
      // sibling emitters use. The previous `server.sockets.adapter` peek
      // dereferenced the Namespace's socketId→socket Map as if it were the
      // root Server's main namespace, so its `.adapter` was always
      // undefined and recipientCount read 0 even on healthy deliveries
      // (while `server.to(room).emit()`, also namespace-scoped, delivered).
      const recipientCount = (await this.server.in(room).allSockets()).size;

      this.server.to(room).emit('trigger.conversation', event);
      // recipientCount=0 is the silent-drop case the authenticate-time
      // re-fan exists to recover from. Escalate to warn so it shows up
      // in operator dashboards; keep info for the healthy >0 path.
      if (recipientCount === 0) {
        const triggerMessageId = (
          event.envelope.event as { triggerMessageId?: unknown } | undefined
        )?.triggerMessageId;
        this.logger.warn(
          '[trigger-emit] no recipient for trigger.conversation',
          {
            room,
            conversationId: event.conversationId,
            userId: event.envelope.userId,
            machineId: event.envelope.machineId,
            triggerMessageId,
          },
        );
      } else {
        this.logger.log(
          `[trigger-emit] gateway emit room=${room} recipientCount=${recipientCount} conversationId=${event.conversationId} machineId=${event.envelope.machineId}`,
        );
      }
    };
    this.bufferOrEmit(() => void emitFunc());
  }

  public async emitConversationTriggerWithAck(
    event:
      | WebSocketConversationTriggerEvent
      | LegacyWebSocketConversationTriggerEvent,
    timeoutMs: number,
  ): Promise<
    | {
        acknowledged: true;
        acknowledgement: AgentOperationDispatchAcceptedAcknowledgement;
      }
    | {
        acknowledged: false;
        reason: string;
        acknowledgement?: AgentOperationDispatchRejectedAcknowledgement;
      }
  > {
    if (!this.hasProtocol2Authorization(event)) {
      return { acknowledged: false, reason: 'legacy_protocol' };
    }
    classifyHostAffectingFrame(event);
    const room = `machine:${event.envelope.machineId}`;
    const recipientCount = (await this.server.in(room).allSockets()).size;

    if (recipientCount === 0) {
      this.logger.debug(
        '[trigger-emit-ack] no recipient for trigger.conversation ack dispatch',
        {
          room,
          conversationId: event.conversationId,
          machineId: event.envelope.machineId,
        },
      );
      return { acknowledged: false, reason: 'no_recipient' };
    }

    try {
      const responses: unknown = await this.server
        .to(room)
        .timeout(timeoutMs)
        .emitWithAck('trigger.conversation', event);
      const acknowledgement = Array.isArray(responses)
        ? parseAgentOperationDispatchAcknowledgement(responses[0])
        : null;
      if (!acknowledgement) {
        this.logger.debug('[trigger-emit-ack] invalid CLI acknowledgement', {
          room,
          conversationId: event.conversationId,
          machineId: event.envelope.machineId,
        });
        return { acknowledged: false, reason: 'invalid_acknowledgement' };
      }
      if (acknowledgement.status === 'REJECTED') {
        return {
          acknowledged: false,
          reason: 'cli_rejected',
          acknowledgement,
        };
      }
      this.logger.log(
        `[trigger-emit-ack] ack received room=${room} conversationId=${event.conversationId} machineId=${event.envelope.machineId}`,
      );
      return { acknowledged: true, acknowledgement };
    } catch (error) {
      this.logger.debug(
        '[trigger-emit-ack] timeout waiting for trigger.conversation ack',
        {
          room,
          conversationId: event.conversationId,
          machineId: event.envelope.machineId,
          timeoutMs,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { acknowledged: false, reason: 'timeout' };
    }
  }

  public async emitMonitorCommandWithAck(
    event: WebSocketMonitorCommandEvent | LegacyWebSocketMonitorCommandEvent,
    timeoutMs: number,
  ): Promise<MonitorCommandAcknowledgement | null> {
    if (this.isAuthorityNeutralMonitorEvent(event)) {
      // Platform authentication and signature binding are the complete
      // authorization boundary for this non-host-affecting input.
    } else if (this.hasProtocol2Authorization(event)) {
      classifyHostAffectingFrame(event);
    } else {
      return null;
    }
    const room = `machine:${event.envelope.machineId}`;
    const socketIds = await this.server.in(room).allSockets();
    const recipientCount = socketIds.size;

    if (recipientCount === 0) {
      this.logger.warn('[monitor-command] no verified machine recipient', {
        room,
        commandId: event.envelope.event.commandId,
        monitorId: event.envelope.event.target.workItemId,
      });
      return null;
    }

    // A machine room can briefly contain both an old and a replacement CLI
    // connection. Broadcasting a command to both would cross the process-local
    // receipt boundary and could admit the same lifecycle command twice. Socket
    // ids are rooms too, so target exactly one verified member.
    const targetSocketId = socketIds.values().next().value as string;

    try {
      const responses = (await this.server
        .to(targetSocketId)
        .timeout(timeoutMs)
        .emitWithAck('trigger.monitor_command', event)) as unknown[];
      const acknowledgement = parseMonitorCommandAcknowledgement(
        responses[0],
        event.envelope.event.commandId,
      );
      if (!acknowledgement) {
        this.logger.warn('[monitor-command] invalid domain acknowledgement', {
          room,
          targetSocketId,
          commandId: event.envelope.event.commandId,
        });
        return null;
      }
      this.logger.log('[monitor-command] domain acknowledgement received', {
        commandId: event.envelope.event.commandId,
        status: acknowledgement.status,
        targetSocketId,
      });
      return acknowledgement;
    } catch {
      this.logger.warn('[monitor-command] domain acknowledgement timeout', {
        room,
        commandId: event.envelope.event.commandId,
        timeoutMs,
      });
      return null;
    }
  }

  public async emitMonitorReduction(
    event: WebSocketMonitorReductionEvent,
  ): Promise<boolean> {
    if (event.envelope.protocolVersion !== 2) return false;
    const room = `machine:${event.envelope.machineId}`;
    const recipientCount = (await this.server.in(room).allSockets()).size;
    if (recipientCount === 0) {
      this.logger.warn('[monitor-reduction] no verified machine recipient', {
        room,
        commandId: event.envelope.event.commandId,
        monitorId: event.envelope.event.target.workItemId,
      });
      return false;
    }

    this.bufferOrEmit(() => {
      this.server.to(room).emit('trigger.monitor_reduction', event);
      this.logger.log('[monitor-reduction] emitted', {
        commandId: event.envelope.event.commandId,
        machineId: event.envelope.machineId,
        cause: event.envelope.event.command.cause,
      });
    });
    return true;
  }

  public async emitCliReadWithAck(
    event: WebSocketCliReadRequestEvent | LegacyWebSocketCliReadRequestEvent,
    timeoutMs: number,
  ): Promise<
    | { kind: 'ack'; value: unknown }
    | { kind: 'no_recipient' }
    | { kind: 'timeout' }
  > {
    if (!this.hasProtocol2Authorization(event)) {
      return { kind: 'no_recipient' };
    }
    classifyHostAffectingFrame(event);
    const room = `machine:${event.envelope.machineId}`;
    const recipientCount = (await this.server.in(room).allSockets()).size;

    this.logger.debug('[cli-read] checked recipient room', {
      room,
      requestId: event.envelope.event.requestId,
      recipientCount,
    });
    if (recipientCount === 0) {
      this.logger.warn('[cli-read] no recipient', {
        room,
        requestId: event.envelope.event.requestId,
      });
      return { kind: 'no_recipient' };
    }

    try {
      const acknowledgements: unknown = await this.server
        .to(room)
        .timeout(timeoutMs)
        .emitWithAck('cli.read.request', event);
      this.logger.log('[cli-read] acknowledgement received', {
        room,
        requestId: event.envelope.event.requestId,
      });
      return { kind: 'ack', value: acknowledgements };
    } catch (error) {
      this.logger.warn('[cli-read] acknowledgement timeout', {
        room,
        requestId: event.envelope.event.requestId,
        timeoutMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'timeout' };
    }
  }

  public async emitCliSettingsWithAck(
    event: WebSocketCliSettingsRequestEvent,
    timeoutMs: number,
  ): Promise<
    | { kind: 'ack'; value: unknown }
    | { kind: 'no_recipient' }
    | { kind: 'timeout' }
  > {
    const room = `machine:${event.envelope.machineId}`;
    const socketIds = await this.server.in(room).allSockets();
    const recipientCount = socketIds.size;
    this.logger.debug('[cli-settings] checked recipient room', {
      room,
      requestId: event.envelope.event.requestId,
      operation: event.envelope.event.operation,
      recipientCount,
    });
    if (recipientCount === 0) {
      this.logger.warn('[cli-settings] no recipient', {
        room,
        requestId: event.envelope.event.requestId,
      });
      return { kind: 'no_recipient' };
    }

    // A reconnect can briefly leave both the old and replacement CLI sockets
    // in the machine room. Settings replacement is a state-changing command,
    // so target exactly one verified socket; broadcasting would let both
    // clients write and would produce multiple acknowledgements that the
    // emitter correctly rejects as an ambiguous response.
    const targetSocket = socketIds.values().next();
    if (targetSocket.done) {
      this.logger.warn('[cli-settings] recipient disappeared before send', {
        room,
        requestId: event.envelope.event.requestId,
      });
      return { kind: 'no_recipient' };
    }
    const targetSocketId = targetSocket.value;
    try {
      const acknowledgements: unknown = await this.server
        .to(targetSocketId)
        .timeout(timeoutMs)
        .emitWithAck('cli.settings.request', event);
      this.logger.log('[cli-settings] acknowledgement received', {
        room,
        targetSocketId,
        requestId: event.envelope.event.requestId,
      });
      return { kind: 'ack', value: acknowledgements };
    } catch (error) {
      this.logger.warn('[cli-settings] acknowledgement timeout', {
        room,
        requestId: event.envelope.event.requestId,
        timeoutMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'timeout' };
    }
  }

  /**
   * Acknowledged reachability probe for a machine. Emits a lightweight
   * `machine.ping` frame to the `machine:${machineId}` room and awaits a socket
   * acknowledgement, mirroring `emitConversationTriggerWithAck` but carrying no
   * conversation/trigger-message — it is a pure liveness round-trip.
   *
   * Returns `{ acknowledged: false }` when no socket is in the room
   * (recipientCount 0) or no ack arrives within `timeoutMs`, and
   * `{ acknowledged: true }` on a confirmed round-trip. Callers (the
   * `POST /machines/{machineId}/ping` controller path) own the resulting UX —
   * this method never throws on a negative result.
   */
  public async pingMachine(
    machineId: string,
    timeoutMs: number,
  ): Promise<{ acknowledged: boolean }> {
    const room = `machine:${machineId}`;
    const recipientCount = (await this.server.in(room).allSockets()).size;

    if (recipientCount === 0) {
      this.logger.log(
        `[machine-ping] no recipient room=${room} machineId=${machineId}`,
      );
      return { acknowledged: false };
    }

    try {
      await this.server
        .to(room)
        .timeout(timeoutMs)
        .emitWithAck('machine.ping', {});
      this.logger.log(
        `[machine-ping] ack received room=${room} machineId=${machineId}`,
      );
      return { acknowledged: true };
    } catch {
      this.logger.log(
        `[machine-ping] timeout waiting for ack room=${room} machineId=${machineId} timeoutMs=${timeoutMs}`,
      );
      return { acknowledged: false };
    }
  }

  public emitConversationControl(
    event:
      | WebSocketConversationControlEvent
      | LegacyWebSocketConversationControlEvent,
  ): void {
    if (!this.hasProtocol2Authorization(event)) return;
    classifyHostAffectingFrame(event);
    const emitFunc = () => {
      this.server
        .to(`machine:${event.envelope.machineId}`)
        .emit('trigger.control', event);
      this.logger.verbose('[WebSocket] Emitted trigger.control frame', {
        userId: event.envelope.userId,
        machineId: event.envelope.machineId,
        kind: event.envelope.event.kind,
        conversationId: event.conversationId,
      });
    };
    this.bufferOrEmit(emitFunc);
  }

  public emitConversationReduction(
    event: WebSocketConversationReductionEvent,
  ): void {
    if (event.envelope.protocolVersion !== 2) {
      this.logger.warn('[WebSocket] dropped non-protocol-2 reduction frame', {
        machineId: event.envelope.machineId,
      });
      return;
    }
    const emitFunc = () => {
      this.server
        .to(`machine:${event.envelope.machineId}`)
        .emit('trigger.control_reduction', event);
      this.logger.verbose(
        '[WebSocket] Emitted trigger.control_reduction frame',
        {
          userId: event.envelope.userId,
          machineId: event.envelope.machineId,
          kind: event.envelope.event.kind,
        },
      );
    };
    this.bufferOrEmit(emitFunc);
  }

  /**
   * Deliver one signed controller-authority reduction to the verified
   * protocol-2 machine room. No room means the persisted revocation remains
   * the source of truth and the next machine reconciliation catches up.
   */
  public async emitAuthorityReductionWithAck(
    event: WebSocketAuthorityReductionEvent,
    timeoutMs: number,
  ): Promise<AuthorityReductionAcknowledgement | null> {
    if (event.envelope.protocolVersion !== 2 || !this.server) return null;
    const room = `machine:${event.envelope.machineId}`;
    const socketIds = await this.server.in(room).allSockets();
    if (socketIds.size === 0) {
      this.logger.verbose(
        '[WebSocket] Skipped authority reduction for offline machine',
        {
          machineId: event.envelope.machineId,
          kind: event.envelope.event.kind,
        },
      );
      return null;
    }
    const targetSocketId = socketIds.values().next().value as string;
    try {
      const responses = (await this.server
        .to(targetSocketId)
        .timeout(timeoutMs)
        .emitWithAck('trigger.authority_reduction', event)) as unknown[];
      const acknowledgement = parseAuthorityReductionAcknowledgement(
        responses[0],
        event.envelope.nonce,
      );
      this.logger.log(
        '[WebSocket] Authority reduction acknowledgement received',
        {
          machineId: event.envelope.machineId,
          kind: event.envelope.event.kind,
          status: acknowledgement?.status ?? 'INVALID',
          targetSocketId,
        },
      );
      return acknowledgement;
    } catch {
      this.logger.warn(
        '[WebSocket] Authority reduction acknowledgement timeout',
        {
          machineId: event.envelope.machineId,
          kind: event.envelope.event.kind,
          timeoutMs,
        },
      );
      return null;
    }
  }

  public emitApplicationEffect(event: WebSocketApplicationEffectEvent): void {
    if (!this.hasProtocol2Authorization(event)) return;
    classifyHostAffectingFrame(event);
    this.bufferOrEmit(() => {
      this.server
        .to(`machine:${event.envelope.machineId}`)
        .emit('trigger.application_effect', event);
    });
  }

  public emitExactAction(event: WebSocketExactActionEvent): void {
    if (!this.hasProtocol2Authorization(event)) return;
    classifyHostAffectingFrame(event);
    this.bufferOrEmit(() => {
      this.server
        .to(`machine:${event.envelope.machineId}`)
        .emit('trigger.exact_action', event);
    });
  }

  // All WebSocket events now use properly typed methods from generated OpenAPI interfaces

  private hasProtocol2Authorization(
    event: unknown,
  ): event is HostAffectingFrame {
    if (!event || typeof event !== 'object') return false;
    const envelope = (event as { envelope?: unknown }).envelope;
    if (!envelope || typeof envelope !== 'object') return false;
    const value = envelope as {
      protocolVersion?: unknown;
      authorization?: unknown;
    };
    return value.protocolVersion === 2 && value.authorization !== undefined;
  }

  private isAuthorityNeutralMonitorEvent(
    event: WebSocketMonitorCommandEvent | LegacyWebSocketMonitorCommandEvent,
  ): event is WebSocketMonitorCommandEvent & {
    envelope: SignedMonitorAuthorityNeutralEnvelope;
  } {
    return (
      'protocolVersion' in event.envelope &&
      event.envelope.protocolVersion === 2 &&
      !('authorization' in event.envelope) &&
      event.envelope.event.kind === 'task_monitor_authority_neutral'
    );
  }

  private bufferOrEmit(emitFunc: () => void) {
    if (!this.server) {
      this.pendingEmits.push(emitFunc);
      this.logger.warn('WebSocket server not yet initialized — queuing event');
      return;
    }
    emitFunc();
  }
}
