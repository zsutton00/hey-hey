export const API_AGENT_OPERATION_METRICS = {
  pending: 'api_agent_operation_dispatch_pending',
  oldestPendingAgeSeconds:
    'api_agent_operation_dispatch_oldest_pending_age_seconds',
  activeClaims: 'api_agent_operation_dispatch_active_claims',
  expiredClaims: 'api_agent_operation_dispatch_expired_claims',
  attemptsTotal: 'api_agent_operation_dispatch_attempts_total',
  durationSeconds: 'api_agent_operation_dispatch_duration_seconds',
  queueWaitSeconds: 'agent_operation_dispatch_queue_wait_seconds',
  commitToAckSeconds: 'agent_operation_dispatch_commit_to_ack_seconds',
  terminalOutcomesTotal: 'api_agent_operation_dispatch_terminal_outcomes_total',
  expiredClaimRecoveriesTotal:
    'api_agent_operation_dispatch_expired_claim_recoveries_total',
  wakesTotal: 'api_agent_operation_dispatch_wakes_total',
} as const;

export const PENDING_FAILURE_CATEGORIES = [
  'not_attempted',
  'offline_waiting',
  'acknowledgement_ambiguous',
  'transport_retry',
  'other_retry',
] as const;

export const DELIVERY_OUTCOMES = [
  'acknowledged',
  'retry_scheduled',
  'denied',
  'terminal_failure',
  'claim_lost',
] as const;

export const DELIVERY_REASONS = [
  'accepted',
  'no_recipient',
  'exact_machine_not_ready',
  'exact_machine_credential_unavailable',
  'acknowledgement_timeout',
  'invalid_acknowledgement',
  'acknowledgement_identity_mismatch',
  'transport_failure',
  'transport_exception',
  'cli_rejected',
  'binding_contradiction',
  'lease_lost',
  'other',
] as const;

export const WAKE_SOURCES = [
  'submission',
  'authentication',
  'enrollment',
] as const;

export const DISPATCH_QUEUE_WAKE_SOURCES = [
  'submission',
  'machine',
  'sweep',
] as const;

export const WAKE_RESULTS = ['claimed', 'no_eligible_work', 'failed'] as const;

export type PendingFailureCategory =
  (typeof PENDING_FAILURE_CATEGORIES)[number];
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];
export type DeliveryReason = (typeof DELIVERY_REASONS)[number];
export type WakeSource = (typeof WAKE_SOURCES)[number];
export type DispatchQueueWakeSource =
  (typeof DISPATCH_QUEUE_WAKE_SOURCES)[number];
export type WakeResult = (typeof WAKE_RESULTS)[number];
