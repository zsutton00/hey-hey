import type { Prisma } from '@prisma/client';
import type {
  ActivityActorScopeDto,
  ActivityMetricContinuationDto,
  ProjectMetricIdentity,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

export const PROJECT_METRIC_IDENTITIES = [
  'TASK_CREATED',
  'TASK_COMPLETED',
  'TASK_VERIFYING',
  'BUG_CREATED',
  'BUG_COMPLETED',
  'BUG_VERIFYING',
  'PLAN_CREATED',
  'PLAN_COMPLETED',
  'PLAN_VERIFYING',
  'AGENT_SESSION_CREATED',
  'PROJECT_INFO_CREATED',
  'PROJECT_INFO_UPDATED',
] as const satisfies readonly ProjectMetricIdentity[];

export const PROJECT_METRICS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PROJECT_METRICS_CLOCK = Symbol('PROJECT_METRICS_CLOCK');

export type ProjectMetricsClock = () => Date;

export interface ProjectMetricsRequest {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly projectId?: ProjectId;
  readonly actorScope: ActivityActorScopeDto;
}

/**
 * An optional evidence boundary supplied by a consumer that must reproduce a
 * previously selected aggregate. A supplied project set and time window are
 * authoritative; the selector must not replace either with a fresh default.
 */
export interface AcceptedEvidenceSelectionOptions {
  readonly eventActorUserId?: UserId;
  readonly projectIds?: readonly ProjectId[];
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
  readonly metric?: ProjectMetricIdentity;
}

export type AcceptedEvidenceContinuation = Pick<
  ActivityMetricContinuationDto,
  'metric' | 'projectIds' | 'windowStart' | 'windowEnd' | 'actorScope'
>;

export interface AcceptedEvidenceRecord {
  readonly metric: ProjectMetricIdentity;
  readonly projectId: ProjectId;
  readonly entityId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly payload: Prisma.JsonValue;
  /** The event actor when the persisted event carried one. */
  readonly userId?: UserId | null;
  /** The conversation associated with the source event, when present. */
  readonly conversationId?: string | null;
}

export type WorkItemLifecycleKind = 'CREATED' | 'UPDATED' | 'STATUS_ENTERED';

/**
 * Ordinary-mode Activity boundary. Project IDs must already be authorized by
 * the caller; the lifecycle read does not re-resolve access.
 */
export interface WorkItemLifecycleSelectionOptions {
  readonly projectIds: readonly ProjectId[];
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly eventActorUserId?: UserId;
}

export interface WorkItemLifecycleRecord {
  readonly kind: WorkItemLifecycleKind;
  readonly projectId: ProjectId;
  readonly entityId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly userId: UserId | null;
  readonly conversationId: string | null;
}

export interface AcceptedEvidenceDiagnostics {
  readonly sourceEventCount: number;
  readonly acceptedRecordCount: number;
  readonly malformedEventCount: number;
  readonly irrelevantEventCount: number;
  readonly deduplicatedRecordCount: number;
}

export interface AcceptedEvidenceSelection {
  readonly effectiveProjectIds: readonly ProjectId[];
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly records: readonly AcceptedEvidenceRecord[];
  readonly diagnostics: AcceptedEvidenceDiagnostics;
}
