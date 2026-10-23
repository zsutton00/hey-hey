# Agent Bridge Beta Telemetry Mapping

This document defines the ui-common CLI telemetry events that the API service should aggregate into beta dashboards and alerts.

## Event Contracts (ui-common)

- `coding_session.created`
  - Metadata: `sessionId`, `latencyMs`, `status`, optional `errorMessage`, optional `errorCode`
- `coding_prompt.recorded`
  - Metadata: `sessionId`, `latencyMs`, `status`, `promptType`, `idempotencyCollisionCount`
  - Success metadata: `promptId`, `deduplicated`
  - Failure metadata: optional `promptId`, optional `deduplicated`, `errorMessage`, optional `errorCode`
- `implementation_hint.written`
  - Metadata: `sessionId`, `latencyMs`, `status`, `idempotencyCollisionCount`
  - Success metadata: `hintId`
  - Failure metadata: optional `hintId`, `errorMessage`, optional `errorCode`
- `final_recommendation.stored`
  - Metadata: `sessionId`, `latencyMs`, `status`
  - Success metadata: `recommendationId`
  - Failure metadata: optional `recommendationId`, `errorMessage`, optional `errorCode`
- `agent.invocation`
  - Metadata: `sessionId`, `latencyMs`, `status`, `provider`
  - Success metadata: `invocationId`, `errorCount`
  - Failure metadata: optional `invocationId`, `errorMessage`, optional `errorCode`

## Dashboard Queries (API service ownership)

- Prompt recording health
  - Success rate: `count(status=success) / count(*)` for `coding_prompt.recorded`
  - Failure rate: `count(status=failure) / count(*)` for `coding_prompt.recorded`
  - Idempotency collisions: `sum(idempotencyCollisionCount)` for `coding_prompt.recorded`
- Hint write-back health
  - Success rate: `count(status=success) / count(*)` for `implementation_hint.written`
  - Failure rate: `count(status=failure) / count(*)` for `implementation_hint.written`
  - Idempotency collisions: `sum(idempotencyCollisionCount)` for `implementation_hint.written`
- Final recommendation throughput
  - Per session: `count(status=success)` grouped by `sessionId` for `final_recommendation.stored`
  - Time-window throughput: `count(status=success)` grouped by fixed windows (15m/1h/24h)
- Agent invocation latency
  - `p50/p95/p99(latencyMs)` for `agent.invocation` grouped by `provider`
  - Error trend: `count(status=failure)` for `agent.invocation`

## Suggested Beta Alert Rules

- Prompt recording failure spike
  - Condition: `coding_prompt.recorded` failure rate `> 5%` over `10m`
  - Severity: high
- Hint write-back failure spike
  - Condition: `implementation_hint.written` failure rate `> 5%` over `10m`
  - Severity: high
- Idempotency collision anomaly
  - Condition: `sum(idempotencyCollisionCount)` above 7-day moving average by `3x` over `30m`
  - Severity: medium
- Agent invocation latency anomaly
  - Condition: `p95(latencyMs) > 12000` over `15m` for either provider
  - Severity: high

## TrackingProvider Integration Surface

ui-common exposes `AgentBridgeTrackingProvider` to initialize tracking context for agent-bridge roots. API service dashboards should assume events are emitted only when agent-bridge hosts wrap roots with this provider.
