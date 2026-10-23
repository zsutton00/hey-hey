/**
 * Subagent → parent-run event bridge.
 *
 * Every Claude SDK event a subagent emits goes through here before it reaches
 * the parent Run's `onAgentOutput`. The helper runs the upstream provider
 * normalizer (`provider-event-normalization.ts`), maps the canonical event
 * type to the dispatcher-recognised eventType, and forwards the result so the
 * parent Run's dispatcher can extract `touchedFiles` from `Edit`/`Write`/
 * `MultiEdit` tool_use blocks and persist tool usage like it does for the
 * non-subagent path.
 *
 * Without this bridge, subagents synthesise text-only `agent_output` events
 * and the dispatcher never sees the structured tool_use payloads it needs.
 */

import type { ClaudeCodeSdkEvent } from '../agent-runtime/index';
import type { AgentOutputHandler } from './agent-event-stream';
import {
  normalizeProviderEventPayload,
  type ProviderEventNormalizationConfig,
} from './providers/provider-event-normalization';

export interface EmitNormalizedSubagentEventArgs {
  rawEvent: ClaudeCodeSdkEvent;
  runId: string;
  agentId: string;
  onAgentOutput: AgentOutputHandler;
  config: ProviderEventNormalizationConfig;
}

export const emitNormalizedSubagentEvent = ({
  rawEvent,
  runId,
  agentId,
  onAgentOutput,
  config,
}: EmitNormalizedSubagentEventArgs): void => {
  const eventRecord = rawEvent as Record<string, unknown>;
  const eventType = typeof eventRecord['type'] === 'string' ? eventRecord['type'] : 'unknown';
  const eventTimestamp =
    typeof eventRecord['timestamp'] === 'string'
      ? eventRecord['timestamp']
      : new Date().toISOString();
  const eventSessionId =
    typeof eventRecord['session_id'] === 'string' ? eventRecord['session_id'] : null;

  if (eventType === 'system' && eventRecord['subtype'] === 'thinking_tokens') {
    return;
  }

  const normalized = normalizeProviderEventPayload({
    provider: 'claude',
    runId,
    eventType,
    timestamp: eventTimestamp,
    sessionId: eventSessionId,
    agentId,
    rawEvent: eventRecord,
    config,
  });

  const canonical = normalized.diagnostics.canonicalEventType;
  const resolvedEventType =
    canonical === 'diff'
      ? 'file_diff_detected'
      : canonical === 'permission_request'
        ? 'permission_request_detected'
        : eventType;

  onAgentOutput({
    event: {
      source: 'provider',
      eventType: resolvedEventType,
      timestamp: eventTimestamp,
      sessionId: eventSessionId,
      agentId,
      payload: normalized.payload,
    },
  });
};
