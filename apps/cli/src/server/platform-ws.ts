import { DeterministicE2EEvidence } from '../run/runners/deterministic-e2e-evidence';
import type { TaskMonitorStateObservation } from '../shared/api/generated/api';
import { io, type Socket } from 'socket.io-client';
import type { ServerLogger } from './logger';
import type { OAuthClient } from '../auth/oauth-client';
import { extractOrganizationIdFromToken, extractUserIdFromToken } from '../auth/index';
import {
  authResponseRevokedReasonSchema,
  machineChallengeFrameSchema,
  PLATFORM_WS_NON_TRIGGER_SCHEMAS,
} from './platform-ws-schemas';
import { MachineChallengeSigner } from './machine-challenge';
import { guardCliReadResponse, MAX_CLI_READ_ACK_BYTES } from './cli-read-response-size-guard';
import type { RepoMappingStore } from '../repo/index';
import type { ControllerRegistryStore, KeyPairStore } from '../credentials';
import type {
  AgentOperationDispatchAcknowledgement,
  AgentSessionContextSizeObservation,
  AgentSessionCurrentStateObservation,
  ConversationPhaseObservation,
  AuthorityReductionAcknowledgement,
  MonitorCommandAcknowledgement,
} from '../shared/api/generated/api';
import type { CliSettingsResponseDto } from '../shared/api/generated/api';
import type { CliReadHandler } from './cli-read-handler';
import type { MachineControllerAuthority } from '../auth/machine-controller-authority';

const isMachineRevocationReduction = (event: PlatformWebSocketEvent): boolean => {
  const envelope = (event as { envelope?: { event?: { kind?: unknown } } }).envelope;
  return envelope?.event?.kind === 'machine_revocation_reduction';
};

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.2;

/**
 * Event types the CLI subscribes to on the platform WebSocket.
 * Must stay in sync with the handlesEvents values in widgets.yaml.
 */
const SUBSCRIBED_EVENT_TYPES = [
  'agent_session.created',
  'agent_session.deleted',
  'agent_session.status_changed',
  'task.created',
  'task.status_changed',
  'conversation.updated',
  'trigger.conversation',
  'trigger.control',
  'trigger.control_reduction',
  'trigger.authority_reduction',
  'trigger.monitor_command',
  'trigger.monitor_reduction',
  'trigger.application_effect',
  'trigger.exact_action',
  'cli.read.request',
  'cli.settings.request',
] as const;

/** Extract the entity-specific ID fields for structured logging. */
const pickEventIdentifiers = (
  eventType: string,
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const ids: Record<string, unknown> = {};
  if (raw['taskId']) ids['taskId'] = raw['taskId'];
  if (raw['conversationId']) ids['conversationId'] = raw['conversationId'];
  if (raw['messageId']) ids['messageId'] = raw['messageId'];
  if (raw['previousStatus'] || raw['newStatus']) {
    ids['previousStatus'] = raw['previousStatus'];
    ids['newStatus'] = raw['newStatus'];
  }
  return ids;
};

/** Base shape shared by all platform WebSocket events. */
export interface PlatformWebSocketEvent {
  type: string;
  timestamp: string;
  organizationId: string;
  projectId?: string;
  conversationId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface PlatformDeliveryContext {
  readonly transportAckAvailable: boolean;
}

export type PlatformEventListener = (
  event: PlatformWebSocketEvent,
  context?: PlatformDeliveryContext,
) =>
  | AgentOperationDispatchAcknowledgement
  | void
  | Promise<AgentOperationDispatchAcknowledgement | void>;

export type PlatformMonitorCommandHandler = (
  event: PlatformWebSocketEvent,
) => Promise<MonitorCommandAcknowledgement>;

export type PlatformAuthorityReductionHandler = (
  event: PlatformWebSocketEvent,
) => Promise<AuthorityReductionAcknowledgement>;

export type PlatformCliSettingsHandler = (
  event: PlatformWebSocketEvent,
) => Promise<CliSettingsResponseDto | null>;

export type PlatformReconnectListener = () => void;

export type MachineRevokedListener = (context: MachineRevokedContext) => void;

/**
 * Machine connection to the platform event gateway. `connected` means the
 * socket authenticated; `revoked` is terminal for the process.
 */
export type PlatformConnectionState = 'disconnected' | 'connecting' | 'connected' | 'revoked';

export type PlatformConnectionStateListener = (state: PlatformConnectionState) => void;

type DailySessionUpdateType = 'session_created' | 'briefing_ready' | 'trigger_fired';

export interface DailySessionUpdatedInput {
  projectId: string;
  sessionId: string;
  updateType: DailySessionUpdateType;
}

export interface ProviderIdentityInput {
  conversationId: string;
  /** The platform AgenticSession this Run is bound to. */
  agentSessionId: string;
  providerSessionId: string;
  providerConversationId: string | null;
}

export interface PlatformWebSocketManagerDependencies {
  /** Platform URL (e.g. "https://heyhey.dev"). */
  serverUrl: string;
  oauthClient: OAuthClient;
  logger: ServerLogger;
  /**
   * Owns the paired machine identity, credential, and private-key persistence
   * boundary used during authentication. An unpaired store returns null for
   * the identity and credential, so the connection still advertises itself as
   * a CLI while the gateway falls back to its cookie-based identity path.
   */
  keyPairStore: KeyPairStore;
  /**
   * Interval between outbound `heartbeat` frames once authenticated. The
   * platform refreshes this connection's last-seen on each frame, so the CLI
   * stays visible to presence checks between events. Defaults to 30s.
   */
  heartbeatIntervalMs?: number;
  /**
   * Interval at which the wake monitor checks for a wall-clock gap. A drift
   * beyond `suspendThresholdMs` means the machine slept and the socket may be
   * half-open, so the monitor forces a reconnect. Defaults to 10s.
   */
  wakeCheckIntervalMs?: number;
  /**
   * Wall-clock drift past the expected wake-monitor tick that is read as a
   * suspend/resume (rather than ordinary timer jitter). Defaults to 60s.
   */
  suspendThresholdMs?: number;
  /**
   * Monotonic-ish wall-clock source the wake monitor compares against its
   * expected tick time. Injectable so tests can simulate a machine sleeping
   * without faking the global clock. Defaults to Date.now.
   */
  now?: () => number;
  /** Random source used to jitter reconnect delays. Defaults to Math.random. */
  random?: () => number;
  /**
   * Observable store for service-to-repository bindings. When provided, the
   * client emits the full binding set upstream immediately on auth and on every
   * subsequent change so the platform can fan it out to connected browsers.
   */
  repoStore?: RepoMappingStore;
  /** Activated binding source for socket identity and protocol advertisement. */
  controllerRegistryStore?: ControllerRegistryStore;
  /** Durable local authority owner used on terminal machine revocation. */
  machineControllerAuthority?: Pick<MachineControllerAuthority, 'handleMachineRevoked'>;
}

export interface MachineRevokedContext {
  organizationId: string | null;
  conversationIds: string[];
}

export class PlatformWebSocketManager {
  private readonly serverUrl: string;
  private readonly oauthClient: OAuthClient;
  private readonly logger: ServerLogger;
  private readonly keyPairStore: KeyPairStore;
  private readonly challengeSigner: MachineChallengeSigner;
  private readonly repoStore: RepoMappingStore | undefined;
  private readonly controllerRegistryStore: ControllerRegistryStore | undefined;
  private readonly machineControllerAuthority:
    | Pick<MachineControllerAuthority, 'handleMachineRevoked'>
    | undefined;
  private readonly heartbeatIntervalMs: number;
  private readonly wakeCheckIntervalMs: number;
  private readonly suspendThresholdMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  public constructor(deps: PlatformWebSocketManagerDependencies) {
    this.serverUrl = deps.serverUrl;
    this.oauthClient = deps.oauthClient;
    this.logger = deps.logger;
    this.keyPairStore = deps.keyPairStore;
    this.challengeSigner = new MachineChallengeSigner(this.keyPairStore);
    this.repoStore = deps.repoStore;
    this.controllerRegistryStore = deps.controllerRegistryStore;
    this.machineControllerAuthority = deps.machineControllerAuthority;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? 30_000;
    this.wakeCheckIntervalMs = deps.wakeCheckIntervalMs ?? 10_000;
    this.suspendThresholdMs = deps.suspendThresholdMs ?? 60_000;
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.repoStore?.onChange(this.emitMachineRepoBindings);
  }

  private socket: Socket | null = null;
  private currentOrganizationId: string | null = null;
  private currentUserId: string | null = null;
  private readonly conversationIds = new Set<string>();
  private readonly projectIds = new Set<string>();
  private readonly listeners = new Set<PlatformEventListener>();
  private monitorCommandHandler: PlatformMonitorCommandHandler | null = null;
  private authorityReductionHandler: PlatformAuthorityReductionHandler | null = null;
  private readonly reconnectListeners = new Set<PlatformReconnectListener>();
  private readonly machineRevokedListeners = new Set<MachineRevokedListener>();
  private readonly connectionStateListeners = new Set<PlatformConnectionStateListener>();
  private connectionState: PlatformConnectionState = 'disconnected';
  private cliReadHandler: CliReadHandler | null = null;
  private cliSettingsHandler: PlatformCliSettingsHandler | null = null;
  private bootstrapping: Promise<void> | null = null;
  // `closing` gates the involuntary-disconnect auto-reconnect path. It flips
  // to true at the top of voluntary disconnect() so the resulting sock
  // 'disconnect' event does not schedule a reconnect, and resets to false
  // when a fresh ensureConnected() begins.
  private closing = false;
  // `revoked` is the terminal sibling of `closing`: once the platform reports
  // this machine's credential is revoked, no reconnect is ever scheduled again
  // for the life of the process. Unlike `closing` it never resets — recovery
  // requires a re-pair (and a restart), not a reconnect against a dead
  // credential.
  private revoked = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectAttemptSequence = 0;
  private activeReconnectAttemptId: number | null = null;
  // The machineId resolved at the most recent authenticate, cached so the
  // synchronous heartbeat emit can tag frames without an async lookup per tick.
  private currentMachineId: string | null = null;
  // Liveness timers, both bound to the connection lifecycle: started only on
  // authenticated success and cleared on every teardown path (disconnect,
  // voluntary close, revocation) so a stale timer from a dead socket can never
  // emit onto a replacement. Mirrors how reconnectTimer is managed.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wakeMonitorTimer: ReturnType<typeof setInterval> | null = null;
  // Wall-clock time the next wake-monitor tick is expected at. A tick landing
  // far past this means the process was suspended (machine slept) and the
  // socket may be half-open.
  private expectedWakeTickAt = 0;

  private readonly clearReconnectTimer = (): void => {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  };

  private readonly clearLivenessTimers = (): void => {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.wakeMonitorTimer !== null) {
      clearInterval(this.wakeMonitorTimer);
      this.wakeMonitorTimer = null;
    }
  };

  // Fire-and-forget heartbeat over the live socket. Modeled on
  // emitDailySessionUpdate: an inline payload (outbound socket events are not
  // generated DTOs) guarded on a connected socket and a resolved org. The
  // platform keys on the 'heartbeat' event name to refresh this connection's
  // last-seen — that name is the cross-repo contract with the API gateway.
  private readonly emitHeartbeat = (): void => {
    if (!this.socket?.connected || !this.currentOrganizationId) return;
    this.socket.emit('heartbeat', {
      type: 'heartbeat' as const,
      timestamp: new Date().toISOString(),
      organizationId: this.currentOrganizationId,
      clientType: 'cli' as const,
      ...(this.currentMachineId ? { machineId: this.currentMachineId } : {}),
    });
  };

  // One wake-monitor tick: if the elapsed wall-clock since the expected tick
  // time exceeds the suspend threshold, the machine slept and the socket may be
  // half-open — tear it down so the existing disconnect/scheduleReconnect path
  // re-bootstraps and re-announces presence. Guarded against voluntary close
  // and terminal revocation so it never fights an intentional shutdown.
  private readonly handleWakeTick = (): void => {
    const actual = this.now();
    const drift = actual - this.expectedWakeTickAt;
    this.expectedWakeTickAt = actual + this.wakeCheckIntervalMs;
    if (drift <= this.suspendThresholdMs) return;
    if (this.closing || this.revoked) return;
    const sock = this.socket;
    if (!sock) return;
    this.logger.warn('platform-ws.wake.suspend_detected', {
      driftMs: drift,
      suspendThresholdMs: this.suspendThresholdMs,
      socketId: sock.id,
    });
    // Route through the existing teardown machinery: disconnecting fires the
    // 'disconnect' handler, which clears these timers and schedules the
    // reconnect that re-auths and re-announces presence.
    sock.disconnect();
  };

  private readonly startLivenessTimers = (): void => {
    // Clear first so a re-authentication never leaks a second pair of timers.
    this.clearLivenessTimers();
    this.heartbeatTimer = setInterval(this.emitHeartbeat, this.heartbeatIntervalMs);
    this.expectedWakeTickAt = this.now() + this.wakeCheckIntervalMs;
    this.wakeMonitorTimer = setInterval(this.handleWakeTick, this.wakeCheckIntervalMs);
  };

  private readonly calculateReconnectDelay = (): number => {
    const cappedBaseDelay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
    );
    const jitterMultiplier = 1 + (this.random() * 2 - 1) * RECONNECT_JITTER_RATIO;
    return Math.min(MAX_RECONNECT_DELAY_MS, Math.round(cappedBaseDelay * jitterMultiplier));
  };

  private readonly handleSocketFailure = (
    sock: Socket,
    reason: string,
    disconnectSocket: boolean,
  ): void => {
    if (this.socket !== sock) return;
    this.socket = null;
    this.clearLivenessTimers();
    if (disconnectSocket) sock.disconnect();
    this.setConnectionState('disconnected');
    if (!this.closing && !this.revoked) this.scheduleReconnect();
    this.logger.debug('conversation-updated.subscription.upstream.socket_failure_handled', {
      reason,
      socketId: sock.id,
      disconnectSocket,
      willReconnect: !this.closing && !this.revoked,
    });
  };

  private readonly scheduleReconnect = (): void => {
    if (this.closing || this.revoked) return;
    if (this.reconnectTimer !== null) return;
    const reconnectAttemptId = ++this.reconnectAttemptSequence;
    const delay = this.calculateReconnectDelay();
    this.logger.info('conversation-updated.subscription.upstream.reconnect.scheduled', {
      reconnectAttemptId,
      delayMs: delay,
      attempts: this.reconnectAttempts,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.activeReconnectAttemptId = reconnectAttemptId;
      this.reconnectAttempts += 1;
      this.logger.info('conversation-updated.subscription.upstream.reconnect.attempt_started', {
        reconnectAttemptId,
        attempts: this.reconnectAttempts,
        socketId: this.socket?.id,
      });
      void this.ensureConnected().catch((error: unknown) => {
        this.logger.error('conversation-updated.subscription.upstream.reconnect.attempt_failed', {
          reconnectAttemptId,
          attempts: this.reconnectAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delay);
  };

  private readonly dispatch = async (
    event: PlatformWebSocketEvent,
    context?: PlatformDeliveryContext,
  ): Promise<AgentOperationDispatchAcknowledgement | void> => {
    let acknowledgement: AgentOperationDispatchAcknowledgement | undefined;
    for (const listener of this.listeners) {
      try {
        const result = await listener(event, context);
        if (result) acknowledgement = result;
      } catch (error) {
        this.logger.error('conversation-updated.subscription.upstream.listener_error', {
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return acknowledgement;
  };

  // Read through a call: the bootstrap closure assigns the socket out of view of narrowing.
  private readonly hasSocket = (): boolean => this.socket !== null;

  private readonly setConnectionState = (state: PlatformConnectionState): void => {
    if (this.connectionState === state || this.connectionState === 'revoked') return;
    this.connectionState = state;
    for (const listener of [...this.connectionStateListeners]) {
      try {
        listener(state);
      } catch (error) {
        this.logger.error('platform-ws.connection_state.listener_error', {
          state,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  private readonly notifyReconnect = (): void => {
    this.logger.info('conversation-updated.subscription.upstream.reconnect_notified', {
      listenerCount: this.reconnectListeners.size,
    });
    for (const listener of this.reconnectListeners) {
      try {
        listener();
      } catch (error) {
        this.logger.error('conversation-updated.subscription.upstream.reconnect_listener_error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  private readonly doAuthenticate = async (sock: Socket, organizationId: string): Promise<void> => {
    const tokenResult = await this.oauthClient.getAccessToken();
    if (!tokenResult.success) {
      this.logger.error('conversation-updated.subscription.upstream.auth_token_failed', {
        error: tokenResult.error,
      });
      return;
    }

    const machineId = await this.keyPairStore.loadCurrentMachineId();
    const machineCredential = machineId
      ? await this.keyPairStore.loadMachineCredential(machineId)
      : null;
    // Cache for the synchronous heartbeat emit; refreshed on every (re)auth.
    this.currentMachineId = machineId;
    this.logger.debug('conversation-updated.subscription.upstream.authenticating', {
      organizationId,
      clientType: 'cli',
      hasMachineId: !!machineId,
      hasMachineCredential: !!machineCredential,
    });
    sock.emit('authenticate', {
      accessToken: tokenResult.data,
      organizationId,
      clientType: 'cli',
      ...(this.controllerRegistryStore ? { protocolVersion: 2 } : {}),
      ...(machineId ? { machineId } : {}),
      ...(machineCredential ? { machineCredential } : {}),
    });
  };

  /**
   * Respond to the platform's machine-credential challenge. Runs the full
   * challenge-response from scratch for whichever socket received the frame:
   * validate the frame strictly, sign the challenge with the paired key, and
   * emit the signed response. A frame that fails validation or a machine we
   * cannot sign for (unpaired / no private key) drops the connection rather
   * than emitting a forged response or silently continuing unauthenticated.
   */
  private readonly respondToChallenge = async (sock: Socket, raw: unknown): Promise<void> => {
    const parsed = machineChallengeFrameSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('platform-ws.machine_challenge.dropped', {
        reason: 'schema',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      if (this.socket === sock) sock.disconnect();
      return;
    }

    const challengeBytes = Buffer.from(parsed.data.challenge, 'base64');
    const signature = await this.challengeSigner.sign(challengeBytes);
    if (!signature) {
      // Unpaired or no private key: never emit a forged response. Drop the
      // connection so the gateway sees a failed handshake instead of a CLI
      // lingering in a half-authenticated state.
      this.logger.warn('platform-ws.machine_challenge.no_signature', {
        socketId: sock.id,
      });
      if (this.socket === sock) sock.disconnect();
      return;
    }

    const machineId = await this.keyPairStore.loadCurrentMachineId();
    this.logger.info('platform-ws.machine_challenge.responded', {
      socketId: sock.id,
      hasMachineId: !!machineId,
    });
    sock.emit('machine_challenge_response', {
      ...(machineId ? { machineId } : {}),
      signature,
    });
  };

  private readonly emitSubscribe = (sock: Socket): void => {
    const eventTypes = [...SUBSCRIBED_EVENT_TYPES];
    const conversationIdList = [...this.conversationIds];
    const projectIdList = [...this.projectIds];
    this.logger.info('conversation-updated.subscription.upstream.subscribing', {
      eventTypes,
      conversationIds: conversationIdList,
      projectIds: projectIdList,
      totalConversations: conversationIdList.length,
      totalProjects: projectIdList.length,
    });
    sock.emit('subscribe', {
      eventTypes,
      conversationIds: conversationIdList,
      projectIds: projectIdList,
    });
  };

  private readonly anyEventPreviewKeys = [
    'type',
    'conversationId',
    'taskId',
    'messageId',
    'organizationId',
    'projectId',
    'status',
    'newStatus',
    'previousStatus',
  ] as const;

  private readonly registerEventListeners = (sock: Socket): void => {
    sock.onAny((eventName: string, ...args: unknown[]) => {
      const first = args[0];
      const isObject = first !== null && typeof first === 'object';
      const preview: Record<string, unknown> = {};
      if (isObject) {
        const record = first as Record<string, unknown>;
        for (const key of this.anyEventPreviewKeys) {
          if (record[key] !== undefined) preview[key] = record[key];
        }
      }
      this.logger.trace('conversation-updated.subscription.upstream.any_event', {
        eventName,
        socketId: sock.id,
        argCount: args.length,
        preview: isObject ? preview : undefined,
      });
    });

    // Reachability probe. The platform's `POST /machines/{id}/ping` emits this
    // frame with an ack and reports the result to the UI as live liveness — so
    // the only contract is to ack on receipt. It carries no conversation or
    // trigger to route, so it stays out of the dispatch loop below.
    sock.on('machine.ping', (_data: unknown, ack?: (response?: unknown) => void) => {
      this.logger.info('conversation-updated.subscription.upstream.machine_ping', {
        socketId: sock.id,
      });
      if (typeof ack === 'function') {
        ack({ received: true });
      }
    });

    for (const eventType of SUBSCRIBED_EVENT_TYPES) {
      sock.on(eventType, async (data: unknown, ack?: (response?: unknown) => void) => {
        const raw = data as Record<string, unknown>;
        const event = { ...raw, type: eventType } as PlatformWebSocketEvent;
        this.logger.debug('conversation-updated.subscription.upstream.event_received', {
          type: eventType,
          socketId: sock.id,
          organizationId: event.organizationId,
          projectId: event.projectId,
          ...pickEventIdentifiers(eventType, raw),
        });
        if (eventType === 'cli.read.request') {
          if (!this.cliReadHandler) {
            this.logger.warn('cli-read.frame.dropped', {
              reason: 'handler_not_ready',
              socketId: sock.id,
            });
            return;
          }
          void this.cliReadHandler
            .handle(event)
            .then((result) => {
              if (result && typeof ack === 'function') {
                const guarded = guardCliReadResponse(result);
                this.logger.info('cli-read.response.size_guard', {
                  requestId: result.requestId,
                  operation: result.operation,
                  serializedBytes: guarded.serializedBytes,
                  acknowledgementBudgetBytes: MAX_CLI_READ_ACK_BYTES,
                  replaced: guarded.replaced,
                });
                ack(guarded.response);
              }
            })
            .catch((error) => {
              this.logger.error('cli-read.handler.unexpected_failure', {
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }

        if (eventType === 'cli.settings.request') {
          const handler = this.cliSettingsHandler;
          if (!handler) {
            this.logger.warn('cli-settings.frame.dropped', {
              reason: 'handler_not_ready',
              socketId: sock.id,
            });
            return;
          }
          void handler(event)
            .then((result) => {
              if (result && typeof ack === 'function') ack(result);
            })
            .catch((error) => {
              this.logger.error('cli-settings.handler.unexpected_failure', {
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }

        if (eventType === 'trigger.authority_reduction') {
          const handler = this.authorityReductionHandler;
          const outcome = handler
            ? await handler(event).catch((error) => {
                this.logger.error('platform-ws.authority_reduction.handler_failed', {
                  error: error instanceof Error ? error.message : String(error),
                });
                return {
                  status: 'REJECTED' as const,
                  reason: 'PERSISTENCE_FAILED' as const,
                };
              })
            : {
                status: 'REJECTED' as const,
                reason: 'HANDLER_UNAVAILABLE' as const,
              };
          if (typeof ack === 'function') ack(outcome);
          // A verified machine revocation has already cleared local authority
          // through the handler. Without this the force-closed socket would
          // reconnect without a credential and retry forever instead of
          // telling the user to re-pair.
          if (outcome.status === 'APPLIED' && isMachineRevocationReduction(event)) {
            this.enterRevokedState(sock, 'authority_reduction');
          }
          return;
        }

        // Strict-validate non-trigger frames at the receive boundary. Trigger
        // frames are validated downstream by the trigger-verification router
        // (which has its own strict envelope schemas), so they're skipped
        // here.
        if (
          eventType !== 'trigger.conversation' &&
          eventType !== 'trigger.control' &&
          eventType !== 'trigger.control_reduction' &&
          eventType !== 'trigger.monitor_command' &&
          eventType !== 'trigger.monitor_reduction' &&
          eventType !== 'trigger.application_effect' &&
          eventType !== 'trigger.exact_action'
        ) {
          const schema = PLATFORM_WS_NON_TRIGGER_SCHEMAS[eventType];
          const parsed = schema.safeParse(event);
          if (!parsed.success) {
            this.logger.warn('platform-ws.frame.dropped', {
              frameType: eventType,
              reason: 'schema',
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            });
            return;
          }
        }

        // Acknowledged frames return only after verified local admission. For
        // conversation input, success proves durable acceptance, not completion
        // of the provider work. The callback is absent on fire-and-forget frames.
        if (eventType === 'trigger.monitor_command') {
          const handler = this.monitorCommandHandler;
          const outcome = handler
            ? await handler(event).catch((error) => {
                this.logger.error('platform-ws.monitor_command.handler_failed', {
                  error: error instanceof Error ? error.message : String(error),
                });
                return {
                  status: 'REJECTED' as const,
                  stage: 'ADMISSION' as const,
                  reason: 'INTERNAL_ERROR' as const,
                  message: 'The CLI could not process the monitor command.',
                };
              })
            : {
                status: 'REJECTED' as const,
                stage: 'ADMISSION' as const,
                reason: 'ROUTE_REJECTED' as const,
                message: 'Task Monitor command admission is not ready.',
              };
          if (typeof ack === 'function') ack(outcome);
          return;
        }

        const isHostTrigger =
          eventType === 'trigger.conversation' ||
          eventType === 'trigger.control' ||
          eventType === 'trigger.control_reduction' ||
          eventType === 'trigger.monitor_reduction' ||
          eventType === 'trigger.application_effect' ||
          eventType === 'trigger.exact_action';
        if (isHostTrigger) {
          if (eventType !== 'trigger.control_reduction')
            this.logger.info('platform-ws.host_trigger.received', {
              eventType,
              acknowledgedDispatch: typeof ack === 'function',
            });
          const acknowledgement = await this.dispatch(event, {
            transportAckAvailable: typeof ack === 'function',
          });
          if (eventType === 'trigger.conversation' && acknowledgement) {
            DeterministicE2EEvidence.current()?.record('dispatch_result', { acknowledgement });
            if (typeof ack === 'function') {
              await DeterministicE2EEvidence.current()?.beforeAcknowledgement(acknowledgement);
            }
          }
          if (typeof ack === 'function') {
            ack(
              eventType === 'trigger.conversation'
                ? (acknowledgement ??
                    ({
                      status: 'REJECTED',
                      stage: 'EXECUTION',
                      reason: 'INTERNAL_ERROR',
                    } satisfies AgentOperationDispatchAcknowledgement))
                : { received: true },
            );
          }
        } else {
          if (typeof ack === 'function') ack({ received: true });
          void this.dispatch(event);
        }
      });
    }
  };

  public readonly disconnect = (): void => {
    this.closing = true;
    this.clearReconnectTimer();
    this.clearLivenessTimers();
    this.reconnectAttempts = 0;
    this.logger.info('conversation-updated.subscription.upstream.disconnecting', {
      conversationIds: [...this.conversationIds],
      projectIds: [...this.projectIds],
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
      reconnectTimerPending: this.reconnectTimer !== null,
      activeReconnectAttemptId: this.activeReconnectAttemptId,
    });
    this.activeReconnectAttemptId = null;
    this.setConnectionState('disconnected');
    if (!this.socket) {
      return;
    }
    this.socket.disconnect();
    this.socket = null;
    this.currentOrganizationId = null;
    this.currentUserId = null;
    this.conversationIds.clear();
    this.projectIds.clear();
  };

  public setCliReadHandler(handler: CliReadHandler): void {
    this.cliReadHandler = handler;
    this.logger.info('cli-read.handler.registered');
  }

  public setCliSettingsHandler(handler: PlatformCliSettingsHandler): void {
    this.cliSettingsHandler = handler;
    this.logger.info('cli-settings.handler.registered');
  }

  /**
   * Terminal for the process: no reconnect is ever scheduled again. Surfaces
   * the re-pair notice once. `auth_rejected` also clears the local credential;
   * `authority_reduction` arrives after the reduction handler already did.
   */
  private readonly enterRevokedState = (
    sock: Socket,
    source: 'auth_rejected' | 'authority_reduction',
    organizationId: string | null = this.currentOrganizationId,
  ): void => {
    if (this.revoked) return;
    this.revoked = true;
    this.setConnectionState('revoked');
    this.clearReconnectTimer();
    this.clearLivenessTimers();
    this.logger.error('conversation-updated.subscription.upstream.auth_revoked', {
      organizationId,
      source,
      attachedConversationIds: [...this.conversationIds],
    });
    // Snapshot the surface context now, while the attached set is still
    // intact, so the re-pair notice can target the conversations this
    // CLI was serving.
    const revokedContext: MachineRevokedContext = {
      organizationId: this.currentOrganizationId,
      conversationIds: [...this.conversationIds],
    };
    if (source === 'auth_rejected') {
      const clearCredential = this.currentMachineId
        ? this.machineControllerAuthority
          ? this.machineControllerAuthority.handleMachineRevoked(this.currentMachineId)
          : this.keyPairStore.deleteMachineCredential(this.currentMachineId)
        : Promise.resolve();
      void clearCredential.catch((error: unknown) => {
        this.logger.error('conversation-updated.subscription.upstream.clear_credential_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    for (const listener of this.machineRevokedListeners) listener(revokedContext);
    // Tear down the socket. The 'disconnect' handler sees `revoked` and
    // schedules no reconnect.
    if (this.socket === sock) sock.disconnect();
  };

  private readonly ensureConnected = async (): Promise<void> => {
    this.logger.debug('conversation-updated.subscription.upstream.ensure_connected.started', {
      closing: this.closing,
      revoked: this.revoked,
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
      reconnectTimerPending: this.reconnectTimer !== null,
      activeReconnectAttemptId: this.activeReconnectAttemptId,
      attempts: this.reconnectAttempts,
    });
    // Terminal: a revoked credential never reconnects within this process.
    // connect()/subscribe()/scheduleReconnect() all funnel here, so this one
    // guard stops every reconnection path after revocation.
    if (this.revoked) {
      this.logger.warn('conversation-updated.subscription.upstream.ensure_connected.skip', {
        reason: 'machine_revoked',
      });
      return;
    }
    this.closing = false;
    if (this.socket?.connected) {
      this.logger.info('conversation-updated.subscription.upstream.ensure_connected.skip', {
        reason: 'socket_already_connected',
        socketId: this.socket.id,
      });
      return;
    }
    if (this.bootstrapping) {
      this.logger.info(
        'conversation-updated.subscription.upstream.ensure_connected.await_bootstrap',
        {},
      );
      await this.bootstrapping;
      return;
    }
    if (this.socket) {
      this.logger.warn(
        'conversation-updated.subscription.upstream.ensure_connected.discard_dead_socket',
        {
          socketId: this.socket.id,
        },
      );
      try {
        this.socket.disconnect();
      } catch (error) {
        this.logger.warn('conversation-updated.subscription.upstream.discard_dead_socket.error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.socket = null;
    }

    this.setConnectionState('connecting');
    this.bootstrapping = (async (): Promise<void> => {
      const tokenResult = await this.oauthClient.getAccessToken();
      if (!tokenResult.success) {
        this.logger.error('conversation-updated.subscription.upstream.bootstrap_failed', {
          reason: 'cannot get access token',
          error: tokenResult.error,
        });
        return;
      }

      const machineId = await this.keyPairStore.loadCurrentMachineId();
      const registry = this.controllerRegistryStore
        ? await this.controllerRegistryStore.read()
        : null;
      const activatedBinding = registry?.controllers.find((entry) => entry.machineId === machineId);
      const organizationId =
        activatedBinding?.organizationId ?? extractOrganizationIdFromToken(tokenResult.data);
      if (this.controllerRegistryStore && (!machineId || !activatedBinding)) {
        this.logger.error('conversation-updated.subscription.upstream.bootstrap_failed', {
          reason: 'activated_machine_controller_missing',
          hasMachineId: Boolean(machineId),
          hasActivatedBinding: Boolean(activatedBinding),
        });
        return;
      }
      if (!organizationId) {
        this.logger.error('conversation-updated.subscription.upstream.bootstrap_failed', {
          reason: 'cannot extract organizationId from token',
        });
        return;
      }

      const url = `${this.serverUrl}/events`;
      this.logger.info('conversation-updated.subscription.upstream.connect', {
        url,
        organizationId,
      });

      this.currentOrganizationId = organizationId;
      this.currentUserId = activatedBinding?.accountId ?? extractUserIdFromToken(tokenResult.data);
      if (!this.currentUserId) {
        this.logger.warn('conversation-updated.subscription.upstream.user_id_missing', {
          organizationId,
        });
      }
      // The platform WS gateway resolves the user from `accessToken` in the
      // handshake Cookie header (websocket.gateway.ts:resolveUserIdFromHandshake)
      // and ignores any token in the `authenticate` message body. Browsers send
      // this cookie automatically; the Node client must set it explicitly via
      // extraHeaders.
      const sock = io(url, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: false,
        extraHeaders: {
          Cookie: `accessToken=${encodeURIComponent(tokenResult.data)}`,
        },
      });
      this.socket = sock;

      sock.on('connect', () => {
        this.logger.info('conversation-updated.subscription.upstream.connected', {
          socketId: sock.id,
          url,
          reconnectAttemptId: this.activeReconnectAttemptId,
          attempts: this.reconnectAttempts,
        });
        void this.doAuthenticate(sock, organizationId).catch((error: unknown) => {
          this.logger.error('conversation-updated.subscription.upstream.authenticate_failed', {
            socketId: sock.id,
            reconnectAttemptId: this.activeReconnectAttemptId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });

      // Machine-credential challenge-response. Registered fresh on every socket
      // bootstrap, so the full challenge-response repeats from scratch on each
      // reconnect — no challenge state survives a connection. The gateway only
      // issues this frame when a machine credential was presented; the cookie
      // path is otherwise untouched.
      sock.on('machine_challenge', (raw: unknown) => {
        void this.respondToChallenge(sock, raw).catch((error: unknown) => {
          this.logger.error('platform-ws.machine_challenge.handler_failed', {
            socketId: sock.id,
            reconnectAttemptId: this.activeReconnectAttemptId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });

      sock.on(
        'authenticated',
        (response: {
          status: string;
          message?: string;
          reason?: string;
          connectionId?: string;
          userId?: string;
          organizationId?: string;
          projectIds?: string[];
          conversationIds?: string[];
          initiativeIds?: string[];
          designDocIds?: string[];
        }) => {
          if (response.status === 'success') {
            if (
              !this.controllerRegistryStore &&
              response.userId &&
              response.userId !== this.currentUserId
            ) {
              this.currentUserId = response.userId;
            }
            this.reconnectAttempts = 0;
            this.clearReconnectTimer();
            this.logger.info('conversation-updated.subscription.upstream.authenticated', {
              socketId: sock.id,
              reconnectAttemptId: this.activeReconnectAttemptId,
              organizationId,
              userId: this.currentUserId,
              serverConnectionId: response.connectionId,
              serverOrganizationId: response.organizationId,
              serverProjectIds: response.projectIds,
              serverConversationIds: response.conversationIds,
              subscribingTo: [...SUBSCRIBED_EVENT_TYPES],
              attachedConversationIds: [...this.conversationIds],
              attachedProjectIds: [...this.projectIds],
            });
            this.activeReconnectAttemptId = null;
            this.emitSubscribe(sock);
            // (Re)start liveness on every successful auth so a reconnect
            // resumes heartbeating and wake-monitoring from a clean slate.
            this.startLivenessTimers();
            this.setConnectionState('connected');
            this.notifyReconnect();
            this.emitMachineRepoBindings();
            return;
          }

          // A revoked machine credential is terminal: the platform sets the
          // enumerated `reason` ONLY in this case. Read revocation from that
          // field, never the free-text `message`. An unknown/absent reason is a
          // transient or non-revocation failure that must stay non-terminal so
          // the socket re-authenticates and reconnects normally.
          if (authResponseRevokedReasonSchema.safeParse(response.reason).success) {
            this.enterRevokedState(sock, 'auth_rejected', organizationId);
            return;
          }

          this.logger.error('conversation-updated.subscription.upstream.auth_failed', {
            socketId: sock.id,
            reconnectAttemptId: this.activeReconnectAttemptId,
            connected: sock.connected,
            reconnectTimerPending: this.reconnectTimer !== null,
            attempts: this.reconnectAttempts,
            reason: response.reason,
            message: response.message,
            organizationId,
          });
        },
      );

      sock.on(
        'subscribed',
        (response: {
          status: string;
          message?: string;
          eventTypes?: string[];
          conversationIds?: string[];
        }) => {
          if (response.status === 'success') {
            const serverEventTypes = response.eventTypes ?? [];
            const missingEventTypes = SUBSCRIBED_EVENT_TYPES.filter(
              (type) => !serverEventTypes.includes(type),
            );
            this.logger.info('conversation-updated.subscription.upstream.subscribed_ack', {
              socketId: sock.id,
              serverEventTypes,
              serverConversationIds: response.conversationIds,
              missingEventTypes,
            });
            if (missingEventTypes.length > 0) {
              this.logger.warn('conversation-updated.subscription.upstream.event_types_missing', {
                missingEventTypes,
                serverEventTypes,
              });
            }
          } else {
            this.logger.error('conversation-updated.subscription.upstream.subscribe_nack', {
              message: response.message,
            });
          }
        },
      );

      sock.on('disconnect', (reason: string) => {
        this.logger.warn('conversation-updated.subscription.upstream.disconnected', {
          reason,
          organizationId,
          socketId: sock.id,
          reconnectAttemptId: this.activeReconnectAttemptId,
          attempts: this.reconnectAttempts,
          bootstrapping: !!this.bootstrapping,
          willReconnect: !this.closing && !this.revoked && this.socket === sock,
        });
        // Release the dead reference so the next subscribe triggers a fresh
        // bootstrap. Conversation/project sets are preserved so they re-emit
        // on reconnect.
        if (this.socket === sock) {
          this.handleSocketFailure(sock, reason, false);
        }
      });

      sock.on('connect_error', (error: Error) => {
        this.logger.error('conversation-updated.subscription.upstream.connect_error', {
          error: error.message,
          socketId: sock.id,
          connected: sock.connected,
          reconnectAttemptId: this.activeReconnectAttemptId,
          attempts: this.reconnectAttempts,
          reconnectTimerPending: this.reconnectTimer !== null,
          closing: this.closing,
          revoked: this.revoked,
          url,
        });
        this.handleSocketFailure(sock, 'connect_error', true);
      });

      this.registerEventListeners(sock);
    })();

    try {
      await this.bootstrapping;
    } finally {
      this.bootstrapping = null;
      // Bootstrap gave up before opening a socket (no token or no activated binding).
      if (!this.hasSocket() && this.getConnectionState() === 'connecting') {
        this.setConnectionState('disconnected');
      }
    }
  };

  public readonly subscribe = (conversationId: string): void => {
    if (this.conversationIds.has(conversationId)) {
      this.logger.info('conversation-updated.subscription.upstream.subscribe.already_attached', {
        conversationId,
        hasSocket: !!this.socket,
        socketConnected: !!this.socket?.connected,
        socketId: this.socket?.id,
      });
      return;
    }
    this.conversationIds.add(conversationId);
    this.logger.info('conversation-updated.subscription.upstream.subscribe', {
      conversationId,
      total: this.conversationIds.size,
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
    });

    if (this.socket?.connected) {
      this.emitSubscribe(this.socket);
      return;
    }

    if (this.reconnectTimer !== null) {
      // A reconnect attempt is already scheduled — let it open the socket and
      // re-emit subscribe with the full set after auth.
      return;
    }
    void this.ensureConnected().catch((error: unknown) => {
      this.logger.error('conversation-updated.subscription.upstream.ensure_connected.failed', {
        source: 'subscribe',
        activeReconnectAttemptId: this.activeReconnectAttemptId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  public readonly unsubscribe = (conversationId: string): void => {
    if (!this.conversationIds.delete(conversationId)) return;
    this.logger.info('conversation-updated.subscription.upstream.unsubscribe', {
      conversationId,
      total: this.conversationIds.size,
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
    });
    if (!this.socket?.connected) return;
    this.socket.emit('unsubscribe', { conversationIds: [conversationId] });
    this.emitSubscribe(this.socket);
  };

  public readonly subscribeProject = (projectId: string): void => {
    if (this.projectIds.has(projectId)) {
      this.logger.info(
        'conversation-updated.subscription.upstream.subscribe_project.already_attached',
        {
          projectId,
          hasSocket: !!this.socket,
          socketConnected: !!this.socket?.connected,
          socketId: this.socket?.id,
        },
      );
      return;
    }
    this.projectIds.add(projectId);
    this.logger.info('conversation-updated.subscription.upstream.subscribe_project', {
      projectId,
      total: this.projectIds.size,
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      socketId: this.socket?.id,
      bootstrapping: !!this.bootstrapping,
    });

    if (this.socket?.connected) {
      this.emitSubscribe(this.socket);
      return;
    }

    if (this.reconnectTimer !== null) {
      return;
    }
    void this.ensureConnected().catch((error: unknown) => {
      this.logger.error('conversation-updated.subscription.upstream.ensure_connected.failed', {
        source: 'subscribe_project',
        activeReconnectAttemptId: this.activeReconnectAttemptId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  public readonly getCurrentUserId = (): string | null => this.currentUserId;

  public readonly onEvent = (listener: PlatformEventListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public readonly onMonitorCommand = (handler: PlatformMonitorCommandHandler): (() => void) => {
    this.monitorCommandHandler = handler;
    return () => {
      if (this.monitorCommandHandler === handler) this.monitorCommandHandler = null;
    };
  };

  public readonly onAuthorityReduction = (
    handler: PlatformAuthorityReductionHandler,
  ): (() => void) => {
    this.authorityReductionHandler = handler;
    return () => {
      if (this.authorityReductionHandler === handler) this.authorityReductionHandler = null;
    };
  };

  public readonly onReconnect = (listener: PlatformReconnectListener): (() => void) => {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  };

  public readonly getConnectionState = (): PlatformConnectionState => this.connectionState;

  public readonly onConnectionStateChanged = (
    listener: PlatformConnectionStateListener,
  ): (() => void) => {
    this.connectionStateListeners.add(listener);
    return () => {
      this.connectionStateListeners.delete(listener);
    };
  };

  public readonly onMachineRevoked = (listener: MachineRevokedListener): (() => void) => {
    this.machineRevokedListeners.add(listener);
    return () => {
      this.machineRevokedListeners.delete(listener);
    };
  };

  public readonly emitDailySessionUpdate = (input: DailySessionUpdatedInput): void => {
    if (!this.socket?.connected || !this.currentOrganizationId) {
      this.logger.debug('platform-ws.emit-daily-session-updated.skipped', {
        hasSocket: !!this.socket,
        connected: !!this.socket?.connected,
        hasOrganizationId: !!this.currentOrganizationId,
        updateType: input.updateType,
        sessionId: input.sessionId,
      });
      return;
    }

    const payload = {
      type: 'daily_session.updated' as const,
      timestamp: new Date().toISOString(),
      organizationId: this.currentOrganizationId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      updateType: input.updateType,
    };

    this.logger.info('platform-ws.emit-daily-session-updated', {
      updateType: input.updateType,
      projectId: input.projectId,
      sessionId: input.sessionId,
    });
    this.socket.emit('daily_session.updated', payload);
  };

  public emitTaskMonitorStateObservation(observation: TaskMonitorStateObservation): void {
    if (!this.socket?.connected) return;
    this.socket.emit('task_monitor.state_observed', observation);
  }

  public readonly emitAgentSessionCurrentStateObservation = (
    observation: AgentSessionCurrentStateObservation,
  ): void => {
    const logPayload = {
      agentSessionId: observation.agentSessionId,
      currentState: observation.currentState,
      observedAt: observation.observedAt,
    };
    if (!this.socket?.connected || !this.currentOrganizationId) {
      this.logger.trace('platform-ws.emit-agent-session-current-state-observation.skipped', {
        hasSocket: !!this.socket,
        connected: !!this.socket?.connected,
        hasOrganizationId: !!this.currentOrganizationId,
        ...logPayload,
      });
      return;
    }

    this.logger.trace('platform-ws.emit-agent-session-current-state-observation', logPayload);
    this.socket.emit('agent_session.current_state_observed', observation);
  };

  public readonly emitAgentSessionContextSizeObservation = (
    observation: AgentSessionContextSizeObservation,
  ): void => {
    const logPayload = {
      agentSessionId: observation.agentSessionId,
      runId: observation.runId,
      providerSessionId: observation.providerSessionId,
      totalTokens: observation.totalTokens,
    };
    if (!this.socket?.connected || !this.currentOrganizationId) {
      this.logger.trace('platform-ws.emit-agent-session-context-size-observation.skipped', {
        hasSocket: !!this.socket,
        connected: !!this.socket?.connected,
        hasOrganizationId: !!this.currentOrganizationId,
        ...logPayload,
      });
      return;
    }

    this.logger.trace('platform-ws.emit-agent-session-context-size-observation', logPayload);
    this.socket.emit('agent_session.context_size_observed', observation);
  };

  public readonly emitConversationPhaseObservation = (
    observation: ConversationPhaseObservation,
  ): void => {
    const logPayload = {
      conversationId: observation.conversationId,
      phase: observation.phase,
      observedAt: observation.observedAt,
    };
    if (!this.socket?.connected || !this.currentOrganizationId) {
      this.logger.trace('platform-ws.emit-conversation-phase-observation.skipped', {
        hasSocket: !!this.socket,
        connected: !!this.socket?.connected,
        hasOrganizationId: !!this.currentOrganizationId,
        ...logPayload,
      });
      return;
    }

    this.logger.trace('platform-ws.emit-conversation-phase-observation', logPayload);
    this.socket.emit('conversation.phase_observed', observation);
  };

  public readonly emitProviderIdentity = (input: ProviderIdentityInput): void => {
    if (!this.socket?.connected || !this.currentOrganizationId) {
      this.logger.debug('platform-ws.emit-provider-identity.skipped', {
        hasSocket: !!this.socket,
        connected: !!this.socket?.connected,
        hasOrganizationId: !!this.currentOrganizationId,
        conversationId: input.conversationId,
        agentSessionId: input.agentSessionId,
      });
      return;
    }

    // Mirror `emitAgentSessionCurrentStateObservation`: the gateway derives the organization
    // from the authenticated machine connection, so the payload carries only
    // the ids it persists — never an org the receiver would have to trust.
    const payload = {
      conversationId: input.conversationId,
      agentSessionId: input.agentSessionId,
      providerSessionId: input.providerSessionId,
      providerConversationId: input.providerConversationId,
    };

    this.logger.info('platform-ws.emit-provider-identity', {
      conversationId: input.conversationId,
      agentSessionId: input.agentSessionId,
      providerSessionId: input.providerSessionId,
      providerConversationId: input.providerConversationId,
    });
    this.socket.emit('provider.identity', payload);
  };

  public readonly emitMachineRepoBindings = (): void => {
    if (!this.socket?.connected || !this.currentOrganizationId || !this.repoStore) return;
    void this.repoStore.listBindings().then((bindings) => {
      if (!this.socket?.connected) return;
      this.socket.emit('machine.repo_bindings.updated', { bindings });
      this.logger.debug('platform-ws.emit-machine-repo-bindings', {
        bindingCount: bindings.length,
      });
    });
  };

  public readonly connect = (): void => {
    this.logger.info('conversation-updated.subscription.upstream.connect.eager', {
      hasSocket: !!this.socket,
      socketConnected: !!this.socket?.connected,
      bootstrapping: !!this.bootstrapping,
      reconnectPending: this.reconnectTimer !== null,
    });
    if (this.reconnectTimer !== null) {
      return;
    }
    void this.ensureConnected().catch((error: unknown) => {
      this.logger.error('conversation-updated.subscription.upstream.ensure_connected.failed', {
        source: 'connect',
        activeReconnectAttemptId: this.activeReconnectAttemptId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
}
