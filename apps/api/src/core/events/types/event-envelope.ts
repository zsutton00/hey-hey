import { ServiceEvent } from './domain-events';

/**
 * Envelope that wraps every DomainEvent with cross-cutting metadata such as
 * correlation id, timestamp, organisation id, etc.
 *
 * Transport-agnostic – nothing about Redis, HTTP, Kafka here.
 */
export interface EventEnvelope<E extends ServiceEvent = ServiceEvent> {
  /** Event payload (domain-specific) */
  readonly event: E;
  /** When the event was raised (UTC ISO string for portability) */
  readonly timestamp: string;
  /** Correlation id for tracing a business request across services */
  readonly correlationId?: string;
  /** Causation id – id of the parent event/command that triggered this event */
  readonly causationId?: string;
  /** Organisation / tenant scope (if multi-tenant) */
  readonly organizationId?: string;
  /** Project scope, if applicable */
  readonly projectId?: string;
  /** Arbitrary headers/extensions for advanced needs */
  readonly headers?: Record<string, any>;
}
