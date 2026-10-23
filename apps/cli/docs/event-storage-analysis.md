# Event Storage Analysis

## Problem

The runs directory (`~/Library/Application Support/heyhey/runs/`) is consuming **727MB** of disk space. Nearly all of it — **715MB across 221 `.events.jsonl` files** — is event data that grows without bound.

The remaining 12MB is run metadata (364 `.json` files at ~4KB each), idempotency tokens, and the run index.

## How Events Work

Events are appended to `{runId}.events.jsonl` files — one JSON object per line, append-only, never modified or deleted. There is no TTL, no max-size enforcement, no archival, and no cleanup logic anywhere in the codebase.

### Event Types

| Event Type | % of Events | Typical Size | Persisted? | Posted to API? | Read Back For |
|---|---|---|---|---|---|
| `agent_output` | ~98% | 2-15KB | Yes | Yes (if has summary) | API response, backfill, inspect |
| `run_started` | ~1% | ~13KB | Yes | Yes (as user message) | API response, backfill, provider identity resolution |
| `run_completed` | ~0.7% | <1KB | Yes | No | API response, provider identity resolution |
| `process_checkpoint` | ~0.05% | 50-100KB | Yes | No | Checkpoint restoration on recovery |
| `post_processed` | ~0.1% | <1KB | Yes | No | API response |
| `prompt_sent` | 0% | - | Defined in types but never written | - | - |

### What Makes Them Large

`agent_output` events dominate both by count and by size. Each one contains:
- `raw_event`: The complete provider response (full LLM output including thinking blocks, tool use parameters, tool results with stdout/stderr and file contents)
- `canonical_event`: A normalized copy of the above
- `normalization`: Schema validation metadata
- `provider_metadata`: Provider-specific extra fields

A typical run has ~2,000+ `agent_output` events. The largest JSONL files are 20-28MB.

## Who Reads Events and Why

### In-Memory Consumption (Real-Time)

**Message poster** (`message-poster.ts`) receives events in-memory from the session runner and posts them to the platform API. It does **not** read from JSONL files. After posting, no flag is set on the local event — there is no "consumed" marker.

### JSONL File Reads

| Consumer | What It Reads | Event Types It Cares About |
|---|---|---|
| `GET /runs/:id` API | Full event list via `getRunWithEvents()` | All except `process_checkpoint` (filtered out in `toLocalRunEvents`) |
| `submitPrompt` flow | Full event list | `run_started`, `run_completed` (for provider identity lineage) |
| Checkpoint restoration | Full event list, filtered | `process_checkpoint` only |
| Backfill script | Full event list, filtered | `run_started` (prompt), `agent_output` (summary) |
| Inspect script | Full event list | All (debugging) |

### The Key Insight

The message poster works entirely in-memory — it never reads JSONL files. After events are posted to the API, the local JSONL copy serves only three purposes:

1. **API response enrichment** — `GET /runs/:id` returns events to callers. But this is largely redundant since the same data was already posted as messages to the platform API.
2. **Provider identity resolution** — scans `run_started`/`run_completed` events for provider session ID changes. Only needs these two event types, not the full stream.
3. **Process checkpoint restoration** — reads `process_checkpoint` events on reconnect. Only needs this single event type.

The bulk of stored data (`agent_output` events, ~98% of volume) is **write-once, rarely-read redundant data** — the agents have their own records, and the messages have already been posted to the API.

## Pruning Opportunities

### Safe to Remove After Posting

`agent_output` events can be pruned from JSONL files once the message poster has successfully posted them. This would eliminate ~98% of storage. The data remains available via:
- The platform API (posted as messages)
- The agent provider's own records (Claude/Codex conversation history)

### Must Retain

| Event Type | Why |
|---|---|
| `run_started` | Provider identity resolution needs `provider_session_id` from payload |
| `run_completed` | Provider identity resolution needs `provider_session_id`/`provider_conversation_id` from payload |
| `process_checkpoint` | Required for workflow state restoration on reconnect |

### Not Needed After Run Completes

Once a run reaches terminal status, `process_checkpoint` events are also no longer needed (no recovery possible). Only `run_started`/`run_completed` would remain useful for identity resolution, and even those could be extracted into the run metadata JSON instead.

## Possible Approaches

### 1. Post-Drain Truncation

After the message poster confirms successful delivery, truncate the JSONL to only retain `run_started`, `run_completed`, and `process_checkpoint` events. This is the simplest approach and would reduce storage by ~98%.

### 2. Completed Run Compaction

When a run reaches terminal status (`completed`, `failed`, `cancelled`), compact its JSONL to retain only the structural events (`run_started`, `run_completed`). Extract any needed state (provider identity, checkpoint data) into the run metadata JSON. This would bring completed runs to near-zero event storage.

### 3. Age-Based Cleanup

Prune all JSONL files for runs older than N days, regardless of status. Simple but coarser — doesn't distinguish between active and completed runs.

### 4. Move Provider Identity to Metadata

The only reason `run_started`/`run_completed` events are read back is to resolve provider session IDs. If the run metadata JSON stored the provider identity lineage directly (updated on each `run_started`/`run_completed` event), there would be no need to read events at all for non-checkpoint purposes. Combined with approach 2, this would allow complete JSONL deletion for completed runs.

## Current Numbers

```
Total runs directory:     727MB
Event JSONL files:        715.8MB (221 files)
Run metadata JSON:          1.4MB (364 files)
Idempotency tokens:          ~0MB  (57 files)

Largest JSONL:             28.4MB
Average JSONL:              3.2MB
Oldest events:           March 8, 2026
```
