export type DiagnosticRetentionLane = 'routine' | 'incident';

export interface DiagnosticRetentionBudget {
  readonly maxRecords: number;
  readonly maxBytes: number;
}

export const DIAGNOSTIC_RETENTION_POLICY = Object.freeze({
  lifetimeMs: 2 * 60 * 60 * 1_000,
  maxRecordTextBytes: 8 * 1_024,
  routine: Object.freeze({ maxRecords: 8_000, maxBytes: 4 * 1_024 * 1_024 }),
  incident: Object.freeze({ maxRecords: 4_000, maxBytes: 4 * 1_024 * 1_024 }),
});

export const diagnosticRetentionLane = (
  kind: 'log' | 'console',
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | undefined,
  event: string | undefined,
  consoleSource: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'write' | undefined,
  stream: 'stdout' | 'stderr' | undefined,
): DiagnosticRetentionLane => {
  if (level === 'warn' || level === 'error') return 'incident';
  if (kind === 'console') {
    return stream === 'stderr' || consoleSource === 'warn' || consoleSource === 'error'
      ? 'incident'
      : 'routine';
  }
  if (
    event?.startsWith('local.handler.permission.') ||
    event?.startsWith('local.handler.permission_decision_recorded.') ||
    event?.startsWith('trigger-verification.authority.') ||
    event?.startsWith('trigger-verification.control.') ||
    event === 'control_reduction.outcome' ||
    event === 'control_reduction.repeated' ||
    event === 'input_admission.accepted' ||
    event === 'input_admission.cancellation_committed' ||
    event === 'input_admission.projection_accepted'
  )
    return 'incident';
  return 'routine';
};
