import type { PlatformWebSocketEvent } from '../../platform-ws';
import type { RawPlatformInboundEvent } from './types';

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const fromPlatformWebSocketEvent = (
  event: PlatformWebSocketEvent,
): RawPlatformInboundEvent => {
  const raw: RawPlatformInboundEvent = {
    eventType: event.type,
    timestamp: event.timestamp,
  };
  if (event.conversationId !== undefined) raw.conversationId = event.conversationId;
  if (event.projectId !== undefined) raw.projectId = event.projectId;
  if (event.userId !== undefined) raw.userId = event.userId;
  // The entity the event is about, for the pre-subscribe filter's per-entity
  // debounce. Platform activity must retain its most specific identity so two
  // tasks or agent sessions in the same conversation cannot suppress each
  // other. Precedence matches the deleted trigger debouncer while extending it
  // for agent-session lifecycle events.
  const entityId =
    readOptionalString(event['entityId']) ??
    readOptionalString(event['taskId']) ??
    readOptionalString(event['agentSessionId']) ??
    event.conversationId;
  if (entityId !== undefined) raw.entityId = entityId;
  return raw;
};
