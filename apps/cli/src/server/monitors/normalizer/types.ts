import type { AgentEventEnvelope } from '../../../agents/agent-event-stream';
import {
  SETTLED_TURN_EVENT_KIND,
  type SettledTurnMonitorEvent,
} from '../../task-monitor-managed-turn-runtime';
export { SETTLED_TURN_EVENT_KIND } from '../../task-monitor-managed-turn-runtime';

export interface CanonicalMonitorEvent {
  eventType: string;
  conversationId?: string;
  projectId?: string;
  userId?: string;
  /**
   * The entity the event is about (task, session, or conversation). Drives the
   * pre-subscribe filter's per-entity debounce: distinct entities of the same
   * event type must not suppress each other. Falls back through
   * entityId → taskId → agentSessionId → conversationId, matching the
   * deleted trigger debouncer while preserving agent-session identity.
   */
  entityId?: string;
  timestamp: string;
  origin: 'platform' | 'self';
}

/** Discriminator marking the report-emission flavour at both the raw agent-lane
 *  and canonical-event layers — one report a CLI agent emitted. */
export const REPORT_EMISSION_KIND = 'report_emission' as const;

/**
 * The canonical report-emission monitor event: produced on the agent-source
 * lane (always origin `'self'`) when one of the CLI's own agents emits a report.
 * Carries neutral report identity from a successful local report creation.
 */
export interface ReportEmissionMonitorEvent extends CanonicalMonitorEvent {
  kind: typeof REPORT_EMISSION_KIND;
  origin: 'self';
  /** Session under review — the emitting run's agentic session id (= its runId). */
  targetSessionId: string;
  /**
   * Conversation id of the session under review — the conversation the
   * session_monitor handler posts its decision into. Resolved at agent-source
   * ingest time from the emitting run's registered conversation, then carried
   * verbatim through the pipeline so the runner can register it as
   * self-owned before the handler posts.
   */
  targetConversationId: string;
  reportId: string;
  /** Canonical report discriminator when the emitting proxy supplied it. */
  reportType?: string;
}

/** True when a canonical event is the report-emission variant. */
export const isReportEmissionEvent = (
  event: CanonicalMonitorEvent,
): event is ReportEmissionMonitorEvent =>
  (event as Partial<ReportEmissionMonitorEvent>).kind === REPORT_EMISSION_KIND;

export interface CanonicalSettledTurnMonitorEvent
  extends CanonicalMonitorEvent, SettledTurnMonitorEvent {
  kind: typeof SETTLED_TURN_EVENT_KIND;
  eventType: typeof SETTLED_TURN_EVENT_KIND;
  origin: 'self';
  entityId: string;
}

export const isSettledTurnEvent = (
  event: CanonicalMonitorEvent,
): event is CanonicalSettledTurnMonitorEvent =>
  (event as Partial<CanonicalSettledTurnMonitorEvent>).kind === SETTLED_TURN_EVENT_KIND;

export interface RawPlatformInboundEvent {
  eventType: string;
  conversationId?: string;
  projectId?: string;
  userId?: string;
  /** Entity the event is about; see {@link CanonicalMonitorEvent.entityId}. */
  entityId?: string;
  timestamp: string;
}

/**
 * A generic local agent emission. Teaches the normalizer which conversations
 * this CLI owns; produces no canonical monitor event on its own.
 */
export interface RawAgentOutputEvent {
  kind: 'agent_output';
  envelope: AgentEventEnvelope;
  runId: string;
}

/**
 * A local report emission: one of the CLI's own agents successfully created a
 * report. Tapped at emission (not awaited back through the platform) and routed
 * through the normalizer into a {@link ReportEmissionMonitorEvent}.
 */
export interface RawReportEmissionEvent {
  kind: typeof REPORT_EMISSION_KIND;
  runId: string;
  reportId: string;
  /** Canonical report discriminator when the emitting proxy supplied it. */
  reportType?: string;
  /** Session under review — the emitting run's agentic session id (= its runId). */
  targetSessionId: string;
  timestamp: string;
}

export interface RawSettledTurnMonitorEvent extends SettledTurnMonitorEvent {
  kind: typeof SETTLED_TURN_EVENT_KIND;
}

/** Raw events carried by the process-local agent-event lane. */
export type RawAgentInboundEvent =
  | RawAgentOutputEvent
  | RawReportEmissionEvent
  | RawSettledTurnMonitorEvent;
