import {
  REPORT_EMISSION_KIND,
  SETTLED_TURN_EVENT_KIND,
  type CanonicalMonitorEvent,
  type RawPlatformInboundEvent,
  type RawReportEmissionEvent,
  type ReportEmissionMonitorEvent,
  type RawSettledTurnMonitorEvent,
  type CanonicalSettledTurnMonitorEvent,
} from './types';

/**
 * Map a raw report emission onto its canonical monitor event. Always origin
 * `'self'` — a report emission is, by definition, the CLI's own agent work —
 * so no self-ownership lookup is needed. Re-derives nothing: the carriers the
 * `session_monitor` run reads (`targetSessionId`, `targetConversationId`,
 * `reportId`) are forwarded verbatim from the tapped emission and the
 * agent-source's run-conversation resolution.
 */
export const normalizeReportEmission = (
  raw: RawReportEmissionEvent,
  targetConversationId: string,
): ReportEmissionMonitorEvent => ({
  kind: REPORT_EMISSION_KIND,
  eventType: REPORT_EMISSION_KIND,
  timestamp: raw.timestamp,
  origin: 'self',
  conversationId: targetConversationId,
  targetSessionId: raw.targetSessionId,
  targetConversationId,
  reportId: raw.reportId,
  ...(raw.reportType ? { reportType: raw.reportType } : {}),
});

export const normalizeSettledTurn = (
  raw: RawSettledTurnMonitorEvent,
): CanonicalSettledTurnMonitorEvent => ({
  ...raw,
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  timestamp: raw.settledAt,
  origin: 'self',
  entityId: raw.agentSessionId,
});

export const normalizePlatformEvent = (event: RawPlatformInboundEvent): CanonicalMonitorEvent => {
  const canonical: CanonicalMonitorEvent = {
    eventType: event.eventType,
    timestamp: event.timestamp,
    origin: 'platform',
  };
  if (event.conversationId !== undefined) canonical.conversationId = event.conversationId;
  if (event.projectId !== undefined) canonical.projectId = event.projectId;
  if (event.userId !== undefined) canonical.userId = event.userId;
  if (event.entityId !== undefined) canonical.entityId = event.entityId;
  return canonical;
};
