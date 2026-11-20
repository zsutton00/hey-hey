import { MachineEnrollmentClaimFailureCode } from '@hey-hey/contracts/api';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import { safeStartupCause } from './startup-diagnostic-boundary';
import { LOCAL_PROJECT } from './compose';

const execute = promisify(execFile);
const limits = { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' as const };
// Parse only the diagnostic fields we own. Never export arbitrary container output.
const state = z
  .enum([
    'UNRECOGNIZED',
    'PENDING',
    'WAITING',
    'PENDING_BROWSER',
    'AWAITING_BROWSER',
    'CREATED',
    'BROWSER_CLAIMED',
    'AWAITING_MACHINE_CONFIRMATION',
    'ACTIVE',
    'CONSUMED',
    'REJECTED',
    'EXPIRED',
    'UNAVAILABLE',
    'NONE',
    'claimable',
    'awaiting-machine-confirmation',
    'consumed',
    'rejected',
    'ready',
    'pending',
    'warning',
  ])
  .catch('UNRECOGNIZED');
const reasonCode = z
  .enum([
    'unrecognized_reason_code',
    'shared_registration_account_proof_required',
    'shared_registration_account_proof_failed',
    'shared_registration_passkey_already_registered',
    'shared_registration_session_ended',
    'enrollment_unavailable',
    'activation_completed',
    'enrollment_rejected',
    'enrollment_marked_expired',
    'enrollment_deadline_elapsed',
    'awaiting_activation',
    'poll_succeeded',
    'poll_interval_too_short',
    'poll_update_conflict',
    'signature_verification_failed',
    'signature_verification_succeeded',
    'activation_with_first_local_grant',
    'activation_succeeded',
    'dispatch_wake_failed',
    'activation_uniqueness_conflict',
    'activation_race_or_state_transition',
    'claim_state_decision',
    'claim_started',
    'awaiting_machine_confirmation',
    'invalid_request',
    'organization_substitution',
    'ownership_state_or_expiry',
    'browser_claim_already_rejected',
    'browser_claim_abandoned',
    'claim_rate_limited',
    'enrollment_created',
    'enrollment_expired',
  ])
  .catch('unrecognized_reason_code');
const pairingRecord = z.object({
  event: z.literal('local.setup.pairing_status'),
  timestamp: z.string().datetime(),
  enrollmentId: z.string().uuid(),
  machineId: z.string().uuid().nullable(),
  enrollmentState: state.nullable(),
  pairingState: state,
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  reasonCode,
  machineCount: z.number(),
  presentMachineCount: z.number(),
  machineConnected: z.boolean(),
  executionReady: z.boolean(),
});
const lifecycleRecord = z.object({
  event: z.enum([
    'machine_enrollment.creation',
    'machine_enrollment.begin_claim',
    'machine_enrollment.complete_claim',
    'machine_enrollment.browser_rejection',
    'machine_enrollment.poll',
    'machine_enrollment.local_confirmation',
    'machine_enrollment.activation',
    'machine_enrollment.expiry',
    'machine_enrollment.throttling',
    'machine_enrollment.failed_transition',
  ]),
  timestamp: z.string().datetime(),
  enrollmentId: z.string().uuid().optional(),
  machineId: z.string().uuid().optional(),
  state: state.optional(),
  decision: z
    .enum([
      'unrecognized_decision',
      'created',
      'claim',
      'resume',
      'unusable',
      'accepted',
      'rejected',
      'verified',
      'activated_after_local_confirmation',
      'activation_preserved_for_periodic_retry',
      'already_rejected',
      'retry_later',
      'claimable',
      'awaiting-machine-confirmation',
      'ready',
      'pending',
      'warning',
      ...Object.values(MachineEnrollmentClaimFailureCode),
    ])
    .catch('unrecognized_decision')
    .optional(),
  reasonCode,
  expiresAt: z.string().datetime().optional(),
  observedAt: z.string().datetime().optional(),
  lastPolledAt: z.string().datetime().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  minimumIntervalMs: z.number().nonnegative().optional(),
});
const enrollmentRecord = z.union([pairingRecord, lifecycleRecord]);
/** Bounded API evidence supplements the CLI snapshot even after pairing fails. */
export async function collectLocalPairingDiagnostics(project = LOCAL_PROJECT) {
  const records: Array<Record<string, unknown>> = [];
  let ids: string[];
  try {
    const containers = await execute(
      'docker',
      [
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--filter',
        'label=com.docker.compose.service=api',
      ],
      limits,
    );
    ids = containers.stdout.trim().split(/\s+/u).filter(Boolean);
    if (!ids.every((id) => /^[a-f0-9]{6,64}$/u.test(id))) {
      return [{ kind: 'local_pairing_collection', reasonCode: 'invalid_container_identity' }];
    }
  } catch (error) {
    const cause = safeStartupCause(error);
    return [
      {
        kind: 'local_pairing_collection',
        reasonCode: cause.code === 'ENOENT' ? 'docker_unavailable' : 'docker_discovery_failed',
        error: cause,
      },
    ];
  }
  if (ids.length === 0) {
    return [{ kind: 'local_pairing_collection', reasonCode: 'api_container_absent' }];
  }
  let ignoredLines = 0;
  let collected = 0;
  for (const [containerIndex, id] of ids.slice(0, 2).entries()) {
    try {
      const output = await execute(
        'docker',
        ['logs', '--since', '2h', '--tail', '2000', id],
        limits,
      );
      const lines = `${output.stdout}\n${output.stderr}`.split('\n').filter((line) => line.trim());
      records.push({
        kind: 'local_pairing_collection',
        reasonCode: 'coverage_bounded',
        containerIndex,
        since: '2h',
        tailPerContainer: 2000,
        potentiallyTruncated: lines.length >= 2000,
      });
      for (const line of lines.slice(-2000)) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          ignoredLines += 1;
          continue;
        }
        const parsed = enrollmentRecord.safeParse(value);
        if (!parsed.success) {
          ignoredLines += 1;
          continue;
        }
        records.push({ kind: 'local_pairing_status', containerIndex, ...parsed.data });
        collected += 1;
      }
    } catch (error) {
      records.push({
        kind: 'local_pairing_collection',
        reasonCode: 'container_collection_failed',
        containerIndex,
        error: safeStartupCause(error),
        evidenceIncomplete: true,
      });
    }
  }
  records.push({
    kind: 'local_pairing_collection',
    reasonCode: collected ? 'collected' : 'no_pairing_status_records',
    containerCount: ids.length,
    collectedContainerCount: Math.min(ids.length, 2),
    omittedContainers: Math.max(0, ids.length - 2),
    ignoredLines,
    since: '2h',
    tailPerContainer: 2000,
  });
  return records;
}
