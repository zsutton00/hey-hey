import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { z } from 'zod';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { UserId } from '../../types';
import { WebsocketUserConnectionLifecycleService } from './websocket-user-connection-lifecycle.service';

const BROWSER_SESSION_EVICTION_CHANNEL =
  'hey-hey:websockets:browser-session-eviction';
const RECONCILE_INTERVAL_MS = 30_000;

const evictionMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sessions'),
    sessionIds: z.array(z.string().uuid()).max(1000),
  }),
  z.object({
    kind: z.literal('revision'),
    userId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  }),
]);

type EvictionMessage = z.infer<typeof evictionMessageSchema>;

/**
 * Ends browser sockets whose session was revoked or whose authorization
 * revision is out of date, on every API replica. Each replica only tracks its
 * own sockets, so revocations are applied locally and broadcast after the
 * revoking transaction commits; every replica handles them idempotently.
 * Broadcasts are best-effort, so each replica also reconciles its registered
 * sockets against the database when its subscription (re)connects and on a
 * fixed interval. Machine sockets never enter the browser lifecycle registry.
 */
@Injectable()
export class BrowserSessionEvictionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BrowserSessionEvictionService.name);
  private readonly publisher: Redis;
  private subscriber?: Redis;
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly lifecycle: WebsocketUserConnectionLifecycleService,
  ) {
    this.publisher = redis.getClient();
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.publisher.duplicate();
    this.subscriber.on('message', this.handleMessage);
    this.subscriber.on('ready', this.handleSubscriberReady);
    await this.subscriber.subscribe(BROWSER_SESSION_EVICTION_CHANNEL);
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }
    if (!this.subscriber) {
      return;
    }
    this.subscriber.removeListener('message', this.handleMessage);
    this.subscriber.removeListener('ready', this.handleSubscriberReady);
    await this.subscriber.quit();
  }

  /** Call only after the revoking transaction has committed. */
  async evictSessions(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) {
      return;
    }
    await this.applyAndBroadcast({
      kind: 'sessions',
      sessionIds: [...sessionIds],
    });
  }

  /** Call only after the revision increment has committed. */
  async evictStaleRevision(userId: UserId, revision: number): Promise<void> {
    await this.applyAndBroadcast({ kind: 'revision', userId, revision });
  }

  /** Close registered sockets the database no longer considers current. */
  async reconcile(): Promise<number> {
    const bindings = this.lifecycle.registeredSessionBindings();
    if (bindings.length === 0) {
      return 0;
    }

    try {
      const sessions = await this.prisma.db.browserSessionFamily.findMany({
        where: { sessionId: { in: bindings.map((b) => b.sessionId) } },
        select: {
          sessionId: true,
          revokedAt: true,
          inactivityExpiresAt: true,
          absoluteExpiresAt: true,
          user: { select: { authorizationRevision: true, isActive: true } },
        },
      });
      const current = new Map(sessions.map((s) => [s.sessionId, s]));
      const now = Date.now();
      let closed = 0;
      for (const binding of bindings) {
        const session = current.get(binding.sessionId);
        const stillCurrent =
          session !== undefined &&
          session.revokedAt === null &&
          session.user.isActive &&
          session.inactivityExpiresAt.getTime() > now &&
          session.absoluteExpiresAt.getTime() > now &&
          session.user.authorizationRevision === binding.authorizationVersion;
        if (!stillCurrent) {
          closed += this.lifecycle.invalidateSession(binding.sessionId);
        }
      }
      return closed;
    } catch (error) {
      this.logger.warn({
        event: 'browser_session_reconcile_failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return 0;
    }
  }

  private async applyAndBroadcast(message: EvictionMessage): Promise<void> {
    this.applyLocal(message, 'publisher');
    try {
      await this.publisher.publish(
        BROWSER_SESSION_EVICTION_CHANNEL,
        JSON.stringify(message),
      );
    } catch (error) {
      // Other replicas still close the sockets at their next reconciliation.
      this.logger.warn({
        event: 'browser_session_eviction_publish_failed',
        kind: message.kind,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private readonly handleSubscriberReady = (): void => {
    void this.reconcile();
  };

  private readonly handleMessage = (channel: string, payload: string): void => {
    if (channel !== BROWSER_SESSION_EVICTION_CHANNEL) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = undefined;
    }
    const message = evictionMessageSchema.safeParse(parsed);
    if (!message.success) {
      this.logger.warn({ event: 'browser_session_eviction_rejected' });
      return;
    }
    this.applyLocal(message.data, 'subscriber');
  };

  private applyLocal(
    message: EvictionMessage,
    source: 'publisher' | 'subscriber',
  ): void {
    const closed =
      message.kind === 'sessions'
        ? message.sessionIds.reduce(
            (count, sessionId) =>
              count + this.lifecycle.invalidateSession(sessionId),
            0,
          )
        : this.lifecycle.invalidateAuthorizationVersion(
            message.userId as UserId,
            message.revision,
          );
    this.logger.log({
      event: 'browser_session_eviction_applied',
      kind: message.kind,
      closed,
      source,
    });
  }
}
