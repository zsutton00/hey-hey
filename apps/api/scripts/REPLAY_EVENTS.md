# Event Replay Guide

This guide explains how to replay events from PostgreSQL to Redis after resetting the embeddings service database.

## Overview

After resetting your embeddings database, you need to replay historical events so the embeddings service can rebuild its state. This script reads events from the `outbox_events` table and publishes them to Redis pub/sub channels that the embeddings service subscribes to.

## Prerequisites

1. PostgreSQL database with `outbox_events` table populated
2. Redis instance running and accessible
3. **IMPORTANT**: The API service should either:
   - Be stopped during replay, OR
   - Not be subscribed to the event types being replayed

## Quick Start

### 1. Dry Run (Recommended First Step)

Always do a dry run first to see what would be replayed:

```bash
pnpm events:replay -- --dry-run
```

### 2. Replay All Published Events

```bash
pnpm events:replay
```

This will replay all events with status `PUBLISHED` (the default).

### 3. Replay Events from a Specific Date

```bash
# Replay events from January 1, 2024 onwards
pnpm events:replay -- --from-date 2024-01-01

# Replay events between two dates
pnpm events:replay -- --from-date 2024-01-01 --to-date 2024-12-31
```

### 4. Replay Specific Event Types

```bash
# Only replay artifact-related events
pnpm events:replay -- --event-types "artifact.created,artifact.updated"

# Only replay initiative events
pnpm events:replay -- --event-types "initiative.created,initiative.updated"
```

### 5. Replay Events for a Specific Organization

```bash
pnpm events:replay -- --organization-id "org-uuid-here"
```

### 6. Replay Events for a Specific Project

```bash
pnpm events:replay -- --project-id "project-uuid-here"

# Combine organization and project
pnpm events:replay -- --organization-id "org-uuid" --project-id "project-uuid"
```

### 7. Limit the Number of Events

```bash
# Only replay the first 1000 events
pnpm events:replay -- --limit 1000
```

## Advanced Usage

### Combining Options

You can combine multiple options:

```bash
# Replay first 5000 artifact events created in 2024 for a specific org and project
pnpm events:replay -- \
  --event-types "artifact.created,artifact.updated" \
  --from-date 2024-01-01 \
  --organization-id "org-123" \
  --project-id "project-456" \
  --limit 5000
```

### Replay Different Event Statuses

By default, only `PUBLISHED` events are replayed. To replay other statuses:

```bash
# Replay both PUBLISHED and FAILED events
pnpm events:replay -- --status "PUBLISHED,FAILED"

# Replay only PENDING events (events that haven't been published yet)
pnpm events:replay -- --status "PENDING"
```

## How It Works

1. **Reads from PostgreSQL**: Queries the `outbox_events` table with your specified filters
2. **Publishes to Redis**: Publishes events to Redis pub/sub channels using the pattern `hey-hey:bus:{eventType}`
3. **Batched Processing**: Processes events in batches of 100 with a small delay between batches
4. **Cursor-Based Pagination**: Uses cursor-based pagination to handle large datasets efficiently
5. **Preserves Order**: Events are replayed in the same order they were created (by `partitionKey`, `sequenceNumber`, `createdAt`)

## Event Envelope Format

Each event is published as an envelope with the following structure:

```typescript
{
  event: {
    id: string;           // Event ID
    type: string;         // Event type (e.g., "artifact.created")
    aggregateId: string;  // ID of the aggregate (e.g., artifact ID)
    payload: unknown;     // Event payload
  },
  timestamp: string;      // ISO timestamp
  correlationId: string;  // Correlation ID for tracing
  causationId?: string;   // Causation ID (what caused this event)
  headers: {
    eventId: string;
    replayed: true;       // Flag indicating this is a replayed event
    replayedAt: string;   // ISO timestamp of when replay occurred
    // ... other headers
  }
}
```

## Important Considerations

### 1. Event Deduplication

The embeddings service should handle the `replayed: true` flag in event headers if it needs to treat replayed events differently than live events.

### 2. Preventing API Service Interference

**Option A: Stop the API Service**

The safest approach is to stop the API service during replay:

```bash
# Stop the API service
pm2 stop hey-hey-api

# Run the replay
pnpm events:replay

# Restart the API service
pm2 start hey-hey-api
```

**Option B: Ensure No Subscription Conflicts**

If you can't stop the API service, ensure it's not subscribed to the event types being replayed. Check which events your API subscribes to in the codebase.

### 3. Large Datasets

For very large event datasets:

- Use `--limit` to process in chunks
- Monitor Redis memory usage
- Monitor embeddings service processing
- Consider running during off-peak hours

### 4. Monitoring Progress

The script shows progress every 100 events:

```
📦 Processing batch 1 (100 events)...
   Progress: 100/5000 (2.0%)
📦 Processing batch 2 (100 events)...
   Progress: 200/5000 (4.0%)
```

## Common Event Types

Here are common event types you might want to replay:

- `artifact.created` - New artifacts created
- `artifact.updated` - Artifact updates
- `artifact.deleted` - Artifact deletions
- `initiative.created` - New initiatives
- `initiative.updated` - Initiative updates
- `project.created` - New projects
- `conversation.started` - Conversations started
- `message.created` - Messages created

You can find all event types by querying:

```sql
SELECT DISTINCT event_type FROM outbox_events ORDER BY event_type;
```

## Troubleshooting

### "No events to replay"

- Check your filters (date ranges, event types, etc.)
- Verify events exist in the database:
  ```sql
  SELECT COUNT(*) FROM outbox_events WHERE status = 'PUBLISHED';
  ```

### Redis Connection Errors

- Verify `REDIS_URL` environment variable is set correctly
- Check Redis is running: `redis-cli ping`
- Verify network connectivity to Redis

### Script Hangs or Runs Slowly

- Reduce `BATCH_SIZE` in the script (default: 100)
- Increase `DELAY_BETWEEN_BATCHES_MS` to slow down publishing
- Check Redis and PostgreSQL performance

### Events Not Appearing in Embeddings Service

- Verify embeddings service is running and connected to Redis
- Check embeddings service logs for processing errors
- Verify event types being replayed match what embeddings service subscribes to
- Check the Redis channels: `redis-cli PUBSUB CHANNELS "hey-hey:bus:*"`

## Safety Features

The script includes several safety features:

1. **5-Second Warning**: Gives you time to cancel before publishing (Ctrl+C)
2. **Dry Run Mode**: Test what would be replayed without actually doing it
3. **Progress Reporting**: Shows progress every 100 events
4. **Error Handling**: Continues processing even if individual events fail
5. **Batch Processing**: Prevents overwhelming Redis with too many events at once

## Example Workflow

Here's a complete workflow for replaying events after resetting embeddings:

```bash
# 1. Backup your databases first (just in case)
pnpm db:backup "before-event-replay"

# 2. Do a dry run to see what will be replayed
pnpm events:replay --dry-run

# 3. Review the output and confirm it looks correct

# 4. Stop the API service (if running)
pm2 stop hey-hey-api

# 5. Run the actual replay
pnpm events:replay

# 6. Monitor embeddings service logs to verify processing
tail -f /path/to/embeddings-service/logs

# 7. Restart API service when done
pm2 start hey-hey-api
```

## Script Location

The replay script is located at:
```
scripts/replay-events-to-embeddings.ts
```

You can modify it if you need custom behavior (e.g., different batch sizes, additional filtering, etc.).
