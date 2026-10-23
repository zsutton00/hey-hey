/**
 * Event Replay Script
 *
 * Replays events from the outbox_events PostgreSQL table to Redis for the embeddings service.
 * This script is useful after resetting the embeddings database to rebuild it from historical events.
 *
 * Usage:
 *   # Replay all events
 *   pnpm events:replay
 *
 *   # Replay events from a specific date
 *   pnpm events:replay -- --from-date 2024-01-01
 *
 *   # Replay specific event types
 *   pnpm events:replay -- --event-types "artifact.created,artifact.updated"
 *
 *   # Replay for specific organization/project
 *   pnpm events:replay -- --organization-id "org-id" --project-id "project-id"
 *
 *   # Dry run (don't actually publish)
 *   pnpm events:replay -- --dry-run
 *
 *   # Limit number of events
 *   pnpm events:replay -- --limit 1000
 *
 * IMPORTANT: This script publishes events to Redis directly. Ensure the API service is NOT
 * subscribed to these event types, or temporarily stop the API service during replay.
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Command } from 'commander';

const EVENTS_CHANNEL_PREFIX = 'hey-hey:bus:';
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 100; // Small delay to avoid overwhelming Redis

interface ReplayOptions {
  fromDate?: string;
  toDate?: string;
  eventTypes?: string[];
  organizationId?: string;
  projectId?: string;
  dryRun: boolean;
  limit?: number;
  status: string[];
}

interface EventEnvelope {
  event: {
    id: string;
    type: string;
    aggregateId: string;
    payload: unknown;
  };
  timestamp: string;
  correlationId: string;
  causationId?: string;
  headers: Record<string, unknown>;
}

async function main() {
  const program = new Command();

  program
    .name('replay-events')
    .description(
      'Replay events from PostgreSQL to Redis for embeddings service',
    )
    .option(
      '--from-date <date>',
      'Replay events from this date (ISO format: YYYY-MM-DD)',
    )
    .option(
      '--to-date <date>',
      'Replay events until this date (ISO format: YYYY-MM-DD)',
    )
    .option(
      '--event-types <types>',
      'Comma-separated list of event types to replay (e.g., "artifact.created,artifact.updated")',
    )
    .option(
      '--organization-id <id>',
      'Only replay events for this organization',
    )
    .option('--project-id <id>', 'Only replay events for this project')
    .option(
      '--dry-run',
      'Show what would be replayed without actually publishing',
      false,
    )
    .option('--limit <number>', 'Maximum number of events to replay')
    .option(
      '--status <statuses>',
      'Comma-separated list of event statuses to replay (default: PUBLISHED)',
      'PUBLISHED',
    )
    .parse(process.argv);

  const options = program.opts<{
    fromDate?: string;
    toDate?: string;
    eventTypes?: string;
    organizationId?: string;
    projectId?: string;
    dryRun?: boolean;
    limit?: string;
    status?: string;
  }>();

  const replayOptions: ReplayOptions = {
    fromDate: options.fromDate,
    toDate: options.toDate,
    eventTypes: options.eventTypes?.split(',').map((t) => t.trim()),
    organizationId: options.organizationId,
    projectId: options.projectId,
    dryRun: options.dryRun ?? false,
    limit: options.limit ? parseInt(options.limit, 10) : undefined,
    status: options.status?.split(',').map((s) => s.trim()) ?? ['PUBLISHED'],
  };

  console.log('🚀 Event Replay Configuration:');
  console.log(`   From Date: ${replayOptions.fromDate ?? 'all time'}`);
  console.log(`   To Date: ${replayOptions.toDate ?? 'now'}`);
  console.log(
    `   Event Types: ${replayOptions.eventTypes?.join(', ') ?? 'all'}`,
  );
  console.log(`   Organization: ${replayOptions.organizationId ?? 'all'}`);
  console.log(`   Project: ${replayOptions.projectId ?? 'all'}`);
  console.log(`   Status: ${replayOptions.status.join(', ')}`);
  console.log(`   Limit: ${replayOptions.limit ?? 'none'}`);
  console.log(`   Dry Run: ${replayOptions.dryRun ? 'YES' : 'NO'}`);
  console.log();

  if (!replayOptions.dryRun) {
    console.log('⚠️  WARNING: This will publish events to Redis!');
    console.log('   Make sure the API service is not processing these events.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    console.log();
    await sleep(5000);
  }

  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  try {
    await replayEvents(prisma, redis, replayOptions);
  } catch (error) {
    console.error('❌ Error during replay:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

async function replayEvents(
  prisma: PrismaClient,
  redis: Redis,
  options: ReplayOptions,
): Promise<void> {
  const retainedMarkers = await prisma.organizationDeletionMarker.findMany({
    select: { organizationId: true },
  });
  const closedOrganizationIds = retainedMarkers.map(
    (marker) => marker.organizationId,
  );

  // Build the where clause
  const where: Record<string, unknown> = {
    status: { in: options.status },
  };
  if (closedOrganizationIds.length > 0) {
    where.AND = [
      {
        OR: [
          { organizationId: null },
          { organizationId: { notIn: closedOrganizationIds } },
          { eventType: 'organization.closed' },
        ],
      },
    ];
  }

  if (options.fromDate) {
    where.createdAt = { gte: new Date(options.fromDate) };
  }

  if (options.toDate) {
    const toDate = new Date(options.toDate);
    if (where.createdAt) {
      (where.createdAt as Record<string, unknown>).lte = toDate;
    } else {
      where.createdAt = { lte: toDate };
    }
  }

  if (options.eventTypes && options.eventTypes.length > 0) {
    where.eventType = { in: options.eventTypes };
  }

  if (options.organizationId) {
    where.organizationId = options.organizationId;
  }

  if (options.projectId) {
    where.projectId = options.projectId;
  }

  // Count total events
  const totalEvents = await prisma.outboxEvent.count({ where });
  const eventsToReplay = options.limit
    ? Math.min(totalEvents, options.limit)
    : totalEvents;

  console.log(`📊 Found ${totalEvents} events matching criteria`);
  console.log(
    `🛑 Applied ${closedOrganizationIds.length} retained organization deletion marker(s)`,
  );
  console.log(`📤 Will replay ${eventsToReplay} events`);
  console.log();

  if (totalEvents === 0) {
    console.log('✅ No events to replay');
    return;
  }

  let processedCount = 0;
  let batchNumber = 0;
  let cursor: string | undefined;

  // Process events in batches using cursor-based pagination
  while (processedCount < eventsToReplay) {
    batchNumber++;
    const batchSize = Math.min(BATCH_SIZE, eventsToReplay - processedCount);

    console.log(`📦 Processing batch ${batchNumber} (${batchSize} events)...`);

    const events = await prisma.outboxEvent.findMany({
      where,
      take: batchSize,
      skip: cursor ? 1 : 0, // Skip the cursor itself
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { partitionKey: 'asc' },
        { sequenceNumber: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    if (events.length === 0) {
      break;
    }

    // Process each event in the batch
    for (const event of events) {
      try {
        if (!options.dryRun) {
          await publishEventToRedis(redis, event);
        }

        processedCount++;

        if (processedCount % 100 === 0 || processedCount === eventsToReplay) {
          const progress = ((processedCount / eventsToReplay) * 100).toFixed(1);
          console.log(
            `   Progress: ${processedCount}/${eventsToReplay} (${progress}%)`,
          );
        }
      } catch (error) {
        console.error(`   ⚠️  Failed to replay event ${event.id}:`, error);
        // Continue with next event rather than stopping
      }

      cursor = event.id;
    }

    // Small delay between batches to avoid overwhelming Redis
    if (processedCount < eventsToReplay && !options.dryRun) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log();
  console.log(
    `✅ Replay complete: ${processedCount} events ${options.dryRun ? 'would be' : 'were'} published`,
  );
}

async function publishEventToRedis(
  redis: Redis,
  event: {
    id: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId: string | null;
    payload: unknown;
    headers: unknown;
    createdAt: Date;
  },
): Promise<void> {
  const envelope: EventEnvelope = {
    event: {
      id: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    },
    timestamp: event.createdAt.toISOString(),
    correlationId: event.correlationId,
    causationId: event.causationId ?? undefined,
    headers: {
      ...(typeof event.headers === 'object' && event.headers !== null
        ? (event.headers as Record<string, unknown>)
        : {}),
      eventId: event.id,
      replayed: true, // Mark as replayed so consumers can handle differently if needed
      replayedAt: new Date().toISOString(),
    },
  };

  const channel = `${EVENTS_CHANNEL_PREFIX}${event.eventType}`;
  const payload = JSON.stringify(envelope);

  await redis.publish(channel, payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
