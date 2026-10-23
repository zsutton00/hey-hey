import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OutboxEvent } from '@prisma/client';
import type { ZodError, ZodTypeAny } from 'zod';
import {
  DebugEventReplayRequestDto,
  DebugEventReplayResponseDto,
  DebugEventReplayResultDto,
  DebugEventReplayMode,
} from '../../generated';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { PrismaService } from '../../prisma/prisma.service';
import {
  enrichMessageCreatedParentMessage,
  SCHEMAS,
  attemptFix,
} from './event-replay-repair.registry';
import { EventReplayCaller } from './event-replay-repair.types';

const DEFAULT_REPLAY_LIMIT = 25;
const DEFAULT_REPLAY_PAGE = 1;
const MAX_REPLAY_LIMIT = 1000;

type ValidationResult =
  | { valid: true; payload: Prisma.JsonValue }
  | { valid: false; error: ZodError; message: string };

@Injectable()
export class EventReplayRepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async execute(
    request: DebugEventReplayRequestDto,
    caller: EventReplayCaller,
  ): Promise<DebugEventReplayResponseDto> {
    const limit = this.resolveLimit(request.limit);
    const page = this.resolvePage(request.page);
    const skip = (page - 1) * limit;
    this.assertMode(request.mode);
    await this.assertProjectAccess(request.projectId, caller.organizationId);

    const where = this.buildSelection(request, caller.organizationId);
    const [total, sources] = await Promise.all([
      this.prisma.db.outboxEvent.count({ where }),
      this.prisma.db.outboxEvent.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { sequenceNumber: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    if (request.eventId && sources.length === 0) {
      throw new NotFoundException('Outbox event not found');
    }

    const results = await Promise.all(
      sources.map((source) => this.processOne(source, request.mode, caller)),
    );

    return {
      total,
      truncated: total > skip + sources.length,
      results,
    } satisfies DebugEventReplayResponseDto;
  }

  private async processOne(
    source: OutboxEvent,
    mode: DebugEventReplayMode,
    caller: EventReplayCaller,
  ): Promise<DebugEventReplayResultDto> {
    try {
      return await this.processOneInternal(source, mode, caller);
    } catch (error) {
      return this.result(source, {
        validationStatus: 'INVALID',
        fixStatus: 'FAILED',
        queueStatus: 'NOT_REQUESTED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processOneInternal(
    source: OutboxEvent,
    mode: DebugEventReplayMode,
    caller: EventReplayCaller,
  ): Promise<DebugEventReplayResultDto> {
    const schema = SCHEMAS[source.eventType];
    if (!schema) {
      return this.result(source, {
        validationStatus: 'INVALID',
        fixStatus: 'FAILED',
        queueStatus: 'NOT_REQUESTED',
        error: `No schema mapped for event type ${source.eventType}`,
      });
    }

    const originalPayload = this.cloneJson(source.payload);
    const originalValidation = this.validate(schema, originalPayload);
    let replayPayload = originalPayload;
    let fixStatus: DebugEventReplayResultDto.FixStatusEnum = 'NOT_REQUESTED';

    if (originalValidation.valid) {
      fixStatus =
        mode === 'ATTEMPT_FIX_AND_REEMIT' ? 'NOT_NEEDED' : 'NOT_REQUESTED';
      const enrichedPayload = await this.enrichIfSupported(
        source,
        originalPayload,
        schema,
      );
      if (enrichedPayload) {
        replayPayload = enrichedPayload;
      }
    } else if (mode === 'ATTEMPT_FIX_AND_REEMIT') {
      fixStatus = 'ATTEMPTED';
      const fixedPayload = await attemptFix(
        this.prisma,
        source,
        originalPayload,
        originalValidation.error,
      );
      if (!fixedPayload) {
        return this.result(source, {
          validationStatus: 'INVALID',
          fixStatus: 'FAILED',
          queueStatus: 'NOT_REQUESTED',
          error: originalValidation.message,
        });
      }

      replayPayload = this.cloneJson(fixedPayload);
      const repairedValidation = this.validate(schema, replayPayload);
      if (!repairedValidation.valid) {
        return this.result(source, {
          validationStatus: 'INVALID',
          fixStatus: 'FAILED',
          queueStatus: 'NOT_REQUESTED',
          error: repairedValidation.message,
        });
      }
      fixStatus = 'APPLIED';
    } else {
      return this.result(source, {
        validationStatus: 'INVALID',
        fixStatus,
        queueStatus: 'NOT_REQUESTED',
        error: originalValidation.message,
      });
    }

    if (mode === 'VALIDATE_ONLY') {
      return this.result(source, {
        validationStatus: 'VALID',
        fixStatus,
        queueStatus: 'NOT_REQUESTED',
      });
    }

    try {
      const replayEventId = await this.eventPublisher.publishReplay(
        source,
        replayPayload,
        {
          replayMode: mode,
          replayedByUserId: caller.userId,
        },
      );
      if (!replayEventId) {
        return this.result(source, {
          validationStatus: 'VALID',
          fixStatus,
          queueStatus: 'FAILED',
          error: 'Replay event was not queued',
        });
      }

      return this.result(source, {
        validationStatus: 'VALID',
        fixStatus,
        queueStatus: 'QUEUED',
        replayEventId,
      });
    } catch (error) {
      return this.result(source, {
        validationStatus: 'VALID',
        fixStatus,
        queueStatus: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async enrichIfSupported(
    source: OutboxEvent,
    payload: Prisma.JsonValue,
    schema: ZodTypeAny,
  ): Promise<Prisma.JsonValue | null> {
    if (source.eventType !== 'message.created') {
      return null;
    }

    const result = await enrichMessageCreatedParentMessage(
      this.prisma,
      source,
      payload as Record<string, unknown>,
    );
    if (!('payload' in result)) {
      return null;
    }

    const revalidation = schema.safeParse(result.payload);
    return revalidation.success ? this.cloneJson(result.payload) : null;
  }

  private validate(
    schema: ZodTypeAny,
    payload: Prisma.JsonValue,
  ): ValidationResult {
    const result = schema.safeParse(payload);
    if (result.success) {
      return { valid: true, payload };
    }

    return {
      valid: false,
      error: result.error,
      message: this.formatValidationError(result.error),
    };
  }

  private buildSelection(
    request: DebugEventReplayRequestDto,
    organizationId: string,
  ): Prisma.OutboxEventWhereInput {
    return {
      organizationId,
      ...(request.eventId ? { id: request.eventId } : {}),
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.aggregateId ? { aggregateId: request.aggregateId } : {}),
      ...(request.eventTypes && request.eventTypes.length > 0
        ? { eventType: { in: request.eventTypes } }
        : {}),
    };
  }

  private async assertProjectAccess(
    projectId: string | undefined,
    organizationId: string,
  ): Promise<void> {
    if (!projectId) {
      return;
    }

    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) {
      throw new ForbiddenException(
        'Project is outside the caller organization',
      );
    }
  }

  private resolveLimit(limit: number | undefined): number {
    const resolved = limit ?? DEFAULT_REPLAY_LIMIT;
    if (
      !Number.isInteger(resolved) ||
      resolved < 1 ||
      resolved > MAX_REPLAY_LIMIT
    ) {
      throw new BadRequestException(
        `Replay limit must be between 1 and ${MAX_REPLAY_LIMIT}`,
      );
    }
    return resolved;
  }

  private resolvePage(page: number | undefined): number {
    const resolved = page ?? DEFAULT_REPLAY_PAGE;
    if (!Number.isInteger(resolved) || resolved < 1) {
      throw new BadRequestException('Replay page must be a positive integer');
    }
    return resolved;
  }

  private assertMode(mode: DebugEventReplayMode): void {
    if (
      mode !== 'VALIDATE_ONLY' &&
      mode !== 'REEMIT_ORIGINAL' &&
      mode !== 'ATTEMPT_FIX_AND_REEMIT'
    ) {
      throw new BadRequestException('Unsupported event replay mode');
    }
  }

  private result(
    source: OutboxEvent,
    values: Omit<DebugEventReplayResultDto, 'originalEventId' | 'eventType'> &
      Partial<Pick<DebugEventReplayResultDto, 'replayEventId' | 'error'>>,
  ): DebugEventReplayResultDto {
    return {
      originalEventId: source.id,
      eventType: source.eventType,
      replayEventId: values.replayEventId ?? null,
      error: values.error ?? null,
      validationStatus: values.validationStatus,
      fixStatus: values.fixStatus,
      queueStatus: values.queueStatus,
    } satisfies DebugEventReplayResultDto;
  }

  private cloneJson(value: unknown): Prisma.JsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
  }

  private formatValidationError(error: unknown): string {
    if (error && typeof error === 'object' && 'issues' in error) {
      return JSON.stringify((error as { issues: unknown }).issues);
    }
    return String(error);
  }
}
