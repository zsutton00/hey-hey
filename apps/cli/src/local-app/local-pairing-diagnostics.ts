import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import { LOCAL_PROJECT } from './compose';

const execute = promisify(execFile);
const limits = { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' as const };
// Parse only the diagnostic fields we own. Never export arbitrary container output.
const pairingRecord = z.object({
  event: z.literal('local.setup.pairing_status'),
  timestamp: z.string(),
  enrollmentId: z.string(),
  machineId: z.string().nullable(),
  enrollmentState: z.string().nullable(),
  pairingState: z.string(),
  observedAt: z.string(),
  expiresAt: z.string().nullable(),
  reasonCode: z.string(),
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
  timestamp: z.string(),
  enrollmentId: z.string().optional(),
  machineId: z.string().optional(),
  state: z.string().optional(),
  decision: z.string().optional(),
  reasonCode: z.string(),
  expiresAt: z.string().optional(),
});
const enrollmentRecord = z.union([pairingRecord, lifecycleRecord]);
const processFailure = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  killed: z.boolean().optional(),
});

/** Bounded API evidence supplements the CLI-only snapshot, including after pairing fails. */
export async function collectLocalPairingDiagnostics() {
  const records: Array<Record<string, unknown>> = [];
  try {
    const containers = await execute(
      'docker',
      [
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${LOCAL_PROJECT}`,
        '--filter',
        'label=com.docker.compose.service=api',
      ],
      limits,
    );
    const ids = containers.stdout.trim().split(/\s+/u).filter(Boolean);
    if (ids.length === 0) {
      return [{ kind: 'local_pairing_collection', reasonCode: 'api_container_absent' }];
    }
    let ignoredLines = 0;
    for (const id of ids.slice(0, 2)) {
      const output = await execute(
        'docker',
        ['logs', '--since', '2h', '--tail', '2000', id],
        limits,
      );
      for (const line of `${output.stdout}\n${output.stderr}`.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          // Docker includes unrelated non-JSON startup output; report the skipped count.
          ignoredLines += 1;
          continue;
        }
        const parsed = enrollmentRecord.safeParse(value);
        if (!parsed.success) {
          ignoredLines += 1;
          continue;
        }
        records.push({ kind: 'local_pairing_status', ...parsed.data });
      }
    }
    records.push({
      kind: 'local_pairing_collection',
      reasonCode: records.length ? 'collected' : 'no_pairing_status_records',
      containerCount: ids.length,
      collectedContainerCount: Math.min(ids.length, 2),
      ignoredLines,
      since: '2h',
      tailPerContainer: 2000,
    });
  } catch (error) {
    const failure = processFailure.safeParse(error);
    records.push({
      kind: 'local_pairing_collection',
      reasonCode: 'collection_failed',
      errorCode: failure.success ? (failure.data.code ?? 'unknown') : 'unknown',
      killed: failure.success ? (failure.data.killed ?? false) : false,
    });
  }
  return records;
}
