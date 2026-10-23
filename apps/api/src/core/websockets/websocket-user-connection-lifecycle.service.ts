import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WebSocketTerminalAuthenticationErrorResponse } from '../../generated';
import { UserId } from '../../types';

export interface WebsocketUserConnectionRegistration {
  userId: UserId;
  expiresAt: Date | string | number;
  sessionId?: string;
  authorizationVersion?: number;
}

interface RegisteredConnection {
  socket: Socket;
  userId: UserId;
  expiresAt: number;
  sessionId?: string;
  authorizationVersion?: number;
  expiryTimer?: NodeJS.Timeout;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Owns the lifetime of browser-user WebSocket connections after the gateway
 * has completed browser-token validation and room authorization.
 *
 * Machine connections deliberately never enter this service. Their
 * challenge-response lifecycle remains owned by the gateway and machine
 * presence services.
 */
@Injectable()
export class WebsocketUserConnectionLifecycleService {
  private readonly logger = new Logger(
    WebsocketUserConnectionLifecycleService.name,
  );

  private readonly registrations = new Map<string, RegisteredConnection>();

  /**
   * Register or replace the browser lifecycle binding for a socket.
   * Validation happens before an existing binding is replaced so a malformed
   * re-authentication cannot discard an otherwise valid registration.
   */
  register(
    socket: Socket,
    context: WebsocketUserConnectionRegistration,
  ): boolean {
    const normalized = this.validateContext(context);

    if (socket.disconnected === true) {
      this.unregister(socket.id);
      this.logger.verbose('[browser-lifecycle] registration skipped', {
        socketId: socket.id,
        userId: normalized.userId,
        reason: 'socket_already_disconnected',
      });
      return false;
    }

    const existing = this.registrations.get(socket.id);

    if (existing) {
      this.clearRegistrationTimer(existing);
      this.logger.verbose('[browser-lifecycle] replacing registration', {
        socketId: socket.id,
        userId: normalized.userId,
        hadSessionBinding: existing.sessionId !== undefined,
        hasSessionBinding: normalized.sessionId !== undefined,
        hadAuthorizationVersionBinding:
          existing.authorizationVersion !== undefined,
        hasAuthorizationVersionBinding:
          normalized.authorizationVersion !== undefined,
      });
    } else {
      this.logger.verbose('[browser-lifecycle] registering connection', {
        socketId: socket.id,
        userId: normalized.userId,
        hasSessionBinding: normalized.sessionId !== undefined,
        hasAuthorizationVersionBinding:
          normalized.authorizationVersion !== undefined,
      });
    }

    const registration: RegisteredConnection = {
      socket,
      ...normalized,
    };
    this.registrations.set(socket.id, registration);
    this.scheduleExpiry(socket.id, registration);
    return this.registrations.get(socket.id) === registration;
  }

  /** Clear retained lifecycle state for a socket. Idempotent by design. */
  unregister(socketId: string): void {
    const registration = this.registrations.get(socketId);
    if (!registration) {
      this.logger.verbose('[browser-lifecycle] unregister ignored', {
        socketId,
        reason: 'not_registered',
      });
      return;
    }

    this.clearRegistrationTimer(registration);
    this.registrations.delete(socketId);
    this.logger.verbose('[browser-lifecycle] registration cleared', {
      socketId,
      userId: registration.userId,
    });
  }

  /** Close every browser socket for a user. */
  invalidateUser(userId: UserId): number {
    return this.invalidate(
      (registration) => registration.userId === userId,
      'user_invalidation',
    );
  }

  /**
   * Close only sockets that were registered with the matching session binding.
   * Sockets without a session binding are intentionally not targeted.
   */
  invalidateSession(sessionId: string): number {
    return this.invalidate(
      (registration) => registration.sessionId === sessionId,
      'session_invalidation',
    );
  }

  /**
   * Invalidate sockets carrying an older authorization revision for a user.
   * Unbound legacy registrations are intentionally left alone until a later
   * validation stage supplies the binding.
   */
  invalidateAuthorizationVersion(
    userId: UserId,
    currentAuthorizationVersion: number,
  ): number {
    if (
      !Number.isInteger(currentAuthorizationVersion) ||
      currentAuthorizationVersion < 0
    ) {
      this.logger.warn(
        '[browser-lifecycle] authorization invalidation ignored',
        {
          userId,
          reason: 'invalid_current_authorization_version',
        },
      );
      return 0;
    }

    return this.invalidate(
      (registration) =>
        registration.userId === userId &&
        registration.authorizationVersion !== undefined &&
        registration.authorizationVersion !== currentAuthorizationVersion,
      'authorization_version_invalidation',
    );
  }

  /** Testable state query that exposes no socket or credential material. */
  hasRegistration(socketId: string): boolean {
    return this.registrations.has(socketId);
  }

  private validateContext(
    context: WebsocketUserConnectionRegistration,
  ): Omit<RegisteredConnection, 'socket' | 'expiryTimer'> {
    if (!context || typeof context !== 'object') {
      throw new Error('Browser lifecycle context is required');
    }
    if (typeof context.userId !== 'string' || context.userId.trim() === '') {
      throw new Error('Browser lifecycle user id is required');
    }

    const expiresAt = this.normalizeExpiry(context.expiresAt);
    if (expiresAt <= Date.now()) {
      throw new Error('Browser lifecycle expiry must be in the future');
    }

    if (
      context.sessionId !== undefined &&
      (typeof context.sessionId !== 'string' || context.sessionId.trim() === '')
    ) {
      throw new Error('Browser lifecycle session binding is invalid');
    }

    if (
      context.authorizationVersion !== undefined &&
      (!Number.isInteger(context.authorizationVersion) ||
        context.authorizationVersion < 0)
    ) {
      throw new Error(
        'Browser lifecycle authorization-version binding is invalid',
      );
    }

    return {
      userId: context.userId,
      expiresAt,
      ...(context.sessionId !== undefined
        ? { sessionId: context.sessionId }
        : {}),
      ...(context.authorizationVersion !== undefined
        ? { authorizationVersion: context.authorizationVersion }
        : {}),
    };
  }

  private normalizeExpiry(
    expiresAt: Date | string | number | undefined,
  ): number {
    if (expiresAt === undefined) {
      throw new Error('Browser lifecycle expiry is required');
    }

    let timestamp: number;
    if (expiresAt instanceof Date) {
      timestamp = expiresAt.getTime();
    } else if (typeof expiresAt === 'string') {
      timestamp = Date.parse(expiresAt);
    } else if (typeof expiresAt === 'number') {
      // Numeric JWT-style expiries are seconds; millisecond timestamps are
      // accepted only when their magnitude makes the unit unambiguous.
      timestamp = expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
    } else {
      timestamp = Number.NaN;
    }

    if (!Number.isFinite(timestamp)) {
      throw new Error('Browser lifecycle expiry is invalid');
    }
    return timestamp;
  }

  private scheduleExpiry(
    socketId: string,
    registration: RegisteredConnection,
  ): void {
    const remainingMs = registration.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.terminate(socketId, registration, 'expiry');
      return;
    }

    const delayMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
    registration.expiryTimer = setTimeout(() => {
      if (this.registrations.get(socketId) !== registration) {
        return;
      }

      if (Date.now() < registration.expiresAt) {
        this.scheduleExpiry(socketId, registration);
        return;
      }

      this.terminate(socketId, registration, 'expiry');
    }, delayMs);
    registration.expiryTimer.unref?.();
  }

  private invalidate(
    matches: (registration: RegisteredConnection) => boolean,
    reason: string,
  ): number {
    const targets = Array.from(this.registrations.entries()).filter(([, r]) =>
      matches(r),
    );

    this.logger.log('[browser-lifecycle] invalidation decision', {
      reason,
      matched: targets.length,
      registered: this.registrations.size,
    });

    for (const [socketId, registration] of targets) {
      this.terminate(socketId, registration, reason);
    }
    return targets.length;
  }

  private terminate(
    socketId: string,
    registration: RegisteredConnection,
    reason: string,
  ): void {
    if (this.registrations.get(socketId) !== registration) {
      return;
    }

    this.clearRegistrationTimer(registration);
    this.registrations.delete(socketId);

    if (registration.socket.disconnected === true) {
      this.logger.verbose('[browser-lifecycle] terminal close skipped', {
        socketId,
        userId: registration.userId,
        reason,
        socketAlreadyDisconnected: true,
      });
      return;
    }

    const terminal: WebSocketTerminalAuthenticationErrorResponse = {
      status: WebSocketTerminalAuthenticationErrorResponse.StatusEnum.Error,
      reason:
        WebSocketTerminalAuthenticationErrorResponse.ReasonEnum
          .AuthenticationRequired,
      message:
        WebSocketTerminalAuthenticationErrorResponse.MessageEnum
          .AuthenticationRequired,
    };

    this.logger.log('[browser-lifecycle] terminal close', {
      socketId,
      userId: registration.userId,
      reason,
      hasSessionBinding: registration.sessionId !== undefined,
      hasAuthorizationVersionBinding:
        registration.authorizationVersion !== undefined,
    });

    try {
      registration.socket.emit('authenticated', terminal);
    } catch (error) {
      this.logger.warn('[browser-lifecycle] terminal acknowledgement failed', {
        socketId,
        userId: registration.userId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      registration.socket.disconnect(true);
    }
  }

  private clearRegistrationTimer(registration: RegisteredConnection): void {
    if (registration.expiryTimer) {
      clearTimeout(registration.expiryTimer);
      registration.expiryTimer = undefined;
    }
  }
}
