#!/usr/bin/env node
/**
 * One-time projection rebuild for a backup-initialized migration stack.
 *
 * Republishes the PUBLISHED rows of outbox_events, oldest first, onto the
 * Redis channels the Graph and Embeddings consumers subscribe to, exactly as
 * the API's publisher would have. Payloads are sent as stored, so ragEnabled
 * travels unchanged and the consumers enforce their own exclusion contracts.
 *
 * Run it only through `migration-stack replay` while the API is stopped. PENDING,
 * SCHEDULED and FAILED rows are copied pending work and are never replayed.
 *
 * Redis pub/sub does not acknowledge delivery. This script reports what it
 * sent; readiness is established by reconciling the stores against PostgreSQL.
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const CHANNEL_PREFIX = 'hey-hey:bus:';

function parseArguments(argv) {
  const options = { dryRun: false, batchSize: 200, delayMs: 50, skip: 0 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = argv[++index];
    const integer = Number(value);
    switch (flag) {
      case '--batch-size':
        options.batchSize = integer;
        break;
      case '--delay-ms':
        options.delayMs = integer;
        break;
      case '--skip':
        options.skip = integer;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
    if (!Number.isInteger(integer) || integer < 0) {
      throw new Error(`${flag} requires a non-negative integer.`);
    }
  }
  if (options.batchSize < 1) {
    throw new Error('--batch-size must be at least 1.');
  }
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toEnvelope(event) {
  return {
    event: {
      id: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    },
    timestamp: event.createdAt.toISOString(),
    correlationId: event.correlationId,
    causationId: event.causationId ?? undefined,
    headers: { ...event.headers, eventId: event.id, replayed: true },
  };
}

async function replayableEventIds(prisma) {
  // Rows of organizations closed before the backup stay out, as in the live
  // publisher's retained-deletion rule. organization.closed itself is kept.
  const rows = await prisma.$queryRaw`
    SELECT o.id
    FROM outbox_events o
    WHERE o.status = 'PUBLISHED'
      AND (
        o.organization_id IS NULL
        OR o.event_type = 'organization.closed'
        OR o.organization_id NOT IN (
          SELECT organization_id FROM organization_deletion_markers
        )
      )
    ORDER BY o.created_at ASC, o.id ASC`;
  return rows.map((row) => row.id);
}

async function summarizeStatuses(prisma) {
  const rows = await prisma.outboxEvent.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const prisma = new PrismaClient();
  const redis = options.dryRun
    ? null
    : new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const startedAt = Date.now();
  const sentByType = {};
  let failures = 0;

  try {
    console.log(
      `Outbox rows by status (only PUBLISHED is replayed): ${JSON.stringify(await summarizeStatuses(prisma))}`,
    );
    const ids = await replayableEventIds(prisma);
    console.log(
      `Replayable events: ${ids.length}. Starting at position ${options.skip}.${options.dryRun ? ' (dry run)' : ''}`,
    );

    for (
      let start = options.skip;
      start < ids.length;
      start += options.batchSize
    ) {
      const batchIds = ids.slice(start, start + options.batchSize);
      const rows = await prisma.outboxEvent.findMany({
        where: { id: { in: batchIds } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));

      for (const id of batchIds) {
        const event = byId.get(id);
        if (!event) {
          failures++;
          console.error(`Event ${id} disappeared from outbox_events.`);
          continue;
        }
        sentByType[event.eventType] = (sentByType[event.eventType] ?? 0) + 1;
        if (redis) {
          await redis.publish(
            `${CHANNEL_PREFIX}${event.eventType}`,
            JSON.stringify(toEnvelope(event)),
          );
        }
      }

      const position = Math.min(start + options.batchSize, ids.length);
      console.log(`position=${position}/${ids.length}`);
      if (redis) {
        await sleep(options.delayMs);
      }
    }

    console.log(
      JSON.stringify({
        replayable: ids.length,
        sentThisRun: Object.values(sentByType).reduce((a, b) => a + b, 0),
        failures,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        sentByType,
        dryRun: options.dryRun,
      }),
    );
    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    if (redis) {
      await redis.quit();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
