import { z } from 'zod/v4';

const captureIdentitySchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  turnId: z.string().min(1),
  provider: z.enum(['codex', 'claude']),
  providerSessionId: z.string().min(1),
  providerTurnId: z.string().min(1).nullable(),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
export type CaptureIdentity = z.infer<typeof captureIdentitySchema>;

const captureRootSchema = z.object({
  serviceId: z.string().min(1),
  root: z.string().min(1),
});
export type CaptureRoot = z.infer<typeof captureRootSchema>;
const snapshotEntrySchema = z.object({
  serviceId: z.string().min(1),
  path: z.string().min(1),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  mode: z.number().int(),
  gap: z.enum(['symlink', 'special_file', 'unreadable', 'changed_during_capture']).nullable(),
});
export type SnapshotEntry = z.infer<typeof snapshotEntrySchema>;
const snapshotSchema = z.object({
  entries: z.array(snapshotEntrySchema),
  rootFailures: z.array(z.string()),
});
export type ContentSnapshotData = z.infer<typeof snapshotSchema>;

export const observationSchema = z.object({
  id: z.string().uuid(),
  identity: captureIdentitySchema,
  roots: z.array(captureRootSchema),
  harnessVersion: z.string(),
  ownerPid: z.number().int(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  state: z.enum(['pending', 'completed', 'incomplete']),
  before: snapshotSchema.nullable(),
  after: snapshotSchema.nullable(),
  outcome: z.enum(['success', 'failure', 'denied', 'interrupted', 'unknown']).nullable(),
  gaps: z.array(
    z.enum([
      'missing_baseline',
      'snapshot_failure',
      'overlap',
      'interrupted',
      'writer_lifetime_unresolved',
      'unsupported_tool',
      'unsupported_version',
      'unsupported_platform',
      'hook_not_observed',
      'identity_unresolved',
      'denied',
      'outcome_unresolved',
    ]),
  ),
});
export type ExecutionObservation = z.infer<typeof observationSchema>;
export type CaptureGap = ExecutionObservation['gaps'][number];
