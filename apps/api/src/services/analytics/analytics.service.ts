import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import {
  EventBatch,
  TrackEventBatchResponse,
  UserTrackingEvent,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  private static readonly MAX_EVENTS_PER_BATCH = 100;

  constructor(private readonly prisma: PrismaService) {}

  async recordEventBatch(
    user: AuthenticatedUser,
    batch: EventBatch,
  ): Promise<TrackEventBatchResponse> {
    this.validateBatch(batch);

    const eventsWithUser = batch.events.map((event) =>
      this.prepareEvent(user, event),
    );

    const existingBatch = await this.prisma.db.analyticsEventBatch.findUnique({
      where: { batchId: batch.batchId },
    });

    if (existingBatch) {
      return {
        batchId: existingBatch.batchId,
        eventsReceived: existingBatch.eventsCount,
      };
    }

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const createdBatch = await tx.analyticsEventBatch.create({
          data: {
            batchId: batch.batchId,
            userId: user.userId,
            organizationId: user.currentOrgId,
            timestamp: new Date(batch.timestamp),
            deviceInfo: batch.deviceInfo as unknown as Prisma.JsonObject,
            eventsCount: eventsWithUser.length,
          },
        });

        const eventData: Prisma.AnalyticsEventCreateManyInput[] =
          eventsWithUser.map((event) => ({
            batchInternalId: createdBatch.id,
            batchId: batch.batchId,
            eventId: event.eventId,
            sessionId: event.sessionId,
            userId: user.userId,
            organizationId: user.currentOrgId,
            category: event.category,
            action: String(event.action),
            timestamp: new Date(event.timestamp),
            url: event.url,
            userAgent: event.userAgent,
            viewport: event.viewport as unknown as Prisma.InputJsonValue,
            context: event.context as unknown as Prisma.InputJsonValue,
            data: event.data as Prisma.InputJsonValue,
          }));

        const insertResult = await tx.analyticsEvent.createMany({
          data: eventData,
          skipDuplicates: true,
        });

        const eventsInserted = insertResult?.count ?? 0;

        if (eventsInserted !== createdBatch.eventsCount) {
          await tx.analyticsEventBatch.update({
            where: { id: createdBatch.id },
            data: { eventsCount: eventsInserted },
          });
        }

        return {
          batchId: createdBatch.batchId,
          eventsReceived: eventsInserted,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const dedupedBatch =
          await this.prisma.db.analyticsEventBatch.findUnique({
            where: { batchId: batch.batchId },
          });

        if (dedupedBatch) {
          return {
            batchId: dedupedBatch.batchId,
            eventsReceived: dedupedBatch.eventsCount,
          };
        }
      }

      this.logger.error(
        `Failed to record analytics batch ${batch.batchId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private validateBatch(batch: EventBatch) {
    if (!batch.events || batch.events.length === 0) {
      throw new BadRequestException(
        'Event batch must include at least one event',
      );
    }

    if (batch.events.length > AnalyticsService.MAX_EVENTS_PER_BATCH) {
      throw new BadRequestException(
        `Too many events in batch (max ${AnalyticsService.MAX_EVENTS_PER_BATCH})`,
      );
    }

    if (!batch.deviceInfo) {
      throw new BadRequestException('Device info is required');
    }

    if (!Number.isFinite(batch.timestamp)) {
      throw new BadRequestException('Batch timestamp is invalid');
    }
  }

  private prepareEvent(
    user: AuthenticatedUser,
    event: UserTrackingEvent,
  ): UserTrackingEvent {
    if (!Number.isFinite(event.timestamp)) {
      throw new BadRequestException('Event timestamp is invalid');
    }

    return {
      ...event,
      userId: user.userId,
      context: {
        ...event.context,
        organization: {
          ...(event.context.organization ?? {}),
          id: user.currentOrgId,
        },
      },
    };
  }
}
