import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import { MachineId, UserId } from '../../types';
import {
  MachineSecurityEventDto,
  MachineSecurityEventType,
  WebSocketMachineSecurityEventEvent,
} from '../../generated';

const DEFAULT_FEED_LIMIT = 100;
const MAX_FEED_LIMIT = 200;

const MACHINE_SECURITY_EVENT_TYPES = new Set<string>(
  Object.values(MachineSecurityEventType),
);

type MachineSecurityEventRecord = Prisma.MachineSecurityEventGetPayload<
  Record<string, never>
>;

export interface RecordMachineSecurityEventInput {
  id: string;
  eventType: MachineSecurityEventType;
  occurredAt: string;
  detail?: string | null;
  metadata?: { [key: string]: unknown } | null;
}

export interface RecordMachineSecurityEventsInput {
  machineId: MachineId;
  userId: UserId;
  events: RecordMachineSecurityEventInput[];
}

export interface ListMachineSecurityEventsInput {
  machineId: MachineId;
  userId: UserId;
  limit?: number;
}

@Injectable()
export class MachineSecurityEventService {
  private readonly logger = new Logger(MachineSecurityEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  /**
   * Persist a batch of security audit events for a machine, idempotently. The
   * composite (machineId, id) primary key is the idempotency guarantee, so
   * re-reporting an entry after a failed round-trip never duplicates a row and
   * two machines reusing the same id never collide. Only rows this call
   * actually inserted are pushed to the owner in realtime — a re-report (or a
   * concurrent identical report) neither re-emits nor rewrites the original.
   * Returns the persisted feed entries for the whole batch, most-recent-first.
   */
  async recordEvents(
    input: RecordMachineSecurityEventsInput,
  ): Promise<MachineSecurityEventDto[]> {
    const { machineId, userId, events } = input;

    this.logger.log(
      `Recording ${events.length} security event(s) for machine ${machineId}`,
    );

    const batchIds = events.map((event) => event.id);

    // Determine which ids already have a row for THIS machine so we attempt to
    // insert only genuinely new entries. This read scopes the new/old decision
    // to (machineId, id), matching the composite primary key exactly.
    const existing = await this.prisma.db.machineSecurityEvent.findMany({
      where: { id: { in: batchIds }, machineId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const newEvents = events.filter((event) => !existingIds.has(event.id));

    // createManyAndReturn with skipDuplicates returns exactly the rows this
    // call inserted. A concurrent identical report that races past the
    // existence check collides on the PK and is dropped here, so it is excluded
    // from both the count and the realtime emit rather than producing a phantom
    // duplicate frame.
    const inserted =
      newEvents.length > 0
        ? await this.prisma.db.machineSecurityEvent.createManyAndReturn({
            data: newEvents.map((event) => ({
              id: event.id,
              machineId,
              eventType: event.eventType,
              occurredAt: new Date(event.occurredAt),
              detail: event.detail ?? null,
              metadata: this.toJsonInput(event.metadata),
            })),
            skipDuplicates: true,
          })
        : [];

    this.logger.log(
      `Persisted ${inserted.length} new security event(s) for machine ${machineId} ` +
        `(${events.length - inserted.length} already present)`,
    );

    // Push each newly persisted event to the owner so the Settings → Machines
    // feed updates within seconds rather than only on the next poll.
    for (const row of inserted) {
      this.emitRealtime(machineId, userId, this.toDto(row));
    }

    const rows = await this.prisma.db.machineSecurityEvent.findMany({
      where: { id: { in: batchIds }, machineId },
      orderBy: { occurredAt: 'desc' },
    });

    return rows.map((row) => this.toDto(row));
  }

  /**
   * Read a machine's security event feed, scoped to a machine the caller owns.
   * Mirrors the owner-or-404 pattern used by revokeMachine: a machine that does
   * not exist or is not owned by the user collapses to the same NotFound so we
   * don't leak another user's machine. Most-recent-first, bounded.
   */
  async listEvents(
    input: ListMachineSecurityEventsInput,
  ): Promise<MachineSecurityEventDto[]> {
    const { machineId, userId } = input;
    const limit = this.normalizeLimit(input.limit);

    this.logger.log(
      `Listing security events for machine ${machineId} (user ${userId}, limit ${limit})`,
    );

    const machine = await this.prisma.db.machine.findFirst({
      where: { id: machineId, userId },
      select: { id: true },
    });

    if (!machine) {
      this.logger.warn(
        `Security event feed lookup failed for machine ${machineId}: not found or not owned by user ${userId}`,
      );
      throw new NotFoundException(`Machine ${machineId} not found`);
    }

    const rows = await this.prisma.db.machineSecurityEvent.findMany({
      where: { machineId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });

    this.logger.log(
      `Found ${rows.length} security event(s) for machine ${machineId}`,
    );

    return rows.map((row) => this.toDto(row));
  }

  private emitRealtime(
    machineId: MachineId,
    userId: UserId,
    event: MachineSecurityEventDto,
  ): void {
    const frame: WebSocketMachineSecurityEventEvent = {
      type: WebSocketMachineSecurityEventEvent.TypeEnum.MachineSecurityEvent,
      timestamp: new Date().toISOString(),
      userId,
      machineId,
      event,
    };
    this.websocketGateway.emitMachineSecurityEvent(frame);
  }

  private toDto(row: MachineSecurityEventRecord): MachineSecurityEventDto {
    return {
      id: row.id,
      machineId: row.machineId,
      eventType: this.toEventType(row.eventType),
      occurredAt: row.occurredAt.toISOString(),
      detail: row.detail,
      metadata: this.toMetadataDto(row.metadata),
    };
  }

  private toEventType(value: string): MachineSecurityEventType {
    if (!MACHINE_SECURITY_EVENT_TYPES.has(value)) {
      throw new Error(
        `Unsupported persisted machine security event type: ${value}`,
      );
    }
    return value as MachineSecurityEventType;
  }

  private toMetadataDto(
    raw: Prisma.JsonValue | null,
  ): { [key: string]: unknown } | null {
    if (raw === null || raw === undefined) {
      return null;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      // Metadata is always written as an object; anything else is a corrupt row.
      throw new Error(
        'Persisted machine security event metadata must be an object',
      );
    }
    return raw as { [key: string]: unknown };
  }

  private toJsonInput(
    metadata: { [key: string]: unknown } | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (metadata === null || metadata === undefined) {
      return Prisma.JsonNull;
    }
    return metadata as Prisma.InputJsonValue;
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_FEED_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return DEFAULT_FEED_LIMIT;
    }
    return Math.min(limit, MAX_FEED_LIMIT);
  }
}
