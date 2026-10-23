import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../../shared/canonical-json';
import { AuthorizationReplayStore } from './authorization-replay-store';
import { ControllerAssertionVerifier } from './controller-assertion-verifier';
import { ExecutionGrantStore } from './execution-grant-store';
import { HostActionAdmission } from './host-action-admission';
import { CURRENT_AGENT_OPERATIONS } from './types';

/**
 * The operation bundle inside every grant users have already paired, written
 * out literally rather than derived from CURRENT_AGENT_OPERATIONS. Adding or
 * removing an operation makes every one of those grants inadmissible, so all
 * users must re-pair before any message reaches their agent. Change this list
 * only for a deliberate, coordinated re-pair.
 */
const PAIRED_GRANT_OPERATIONS = [
  'CONVERSATION_TRIGGER',
  'PLATFORM_EVENT_TRIGGER',
  'CONVERSATION_CONTROL_COMPACT_RUN',
  'CONVERSATION_CONTROL_PERMISSION_DECISION',
  'TASK_MONITOR_START',
  'TASK_MONITOR_RESUME',
  'TASK_MONITOR_JUDGMENT_RESOLVED',
  'TASK_MONITOR_CONTINUE',
  'TASK_MONITOR_COMPLETE',
  'CLI_READ',
  'APPLICATION_EFFECT_LAUNCH',
  'EXACT_ACTION_DELIVERY',
];

const NAMESPACE = 'profile-a';
const KEY = Buffer.alloc(32, 9);
const NOW = 1_700_000_000_000;
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const pairedGrant = (grantId: string, allowedActionTypes: string[]) => ({
  version: 4,
  grantId,
  namespace: NAMESPACE,
  scope: 'controller_device_window',
  controllerCredentialId: 'credential-1',
  controllerInstallationId: 'installation-1',
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  cadence: 'ONE_MONTH',
  policyRevision: 1,
  allowedActionTypes,
  allowedActionCategories: [
    'CONVERSATION',
    'PLATFORM_EVENT',
    'AUTHORITY_INCREASING_CONTROL',
    'TASK_MONITOR',
    'CLI_READ',
    'APPLICATION_EFFECT',
    'EXACT_ACTION',
  ],
  issuedAtMs: NOW - 1_000,
  effectiveExpiresAtMs: NOW - 1_000 + ONE_MONTH_MS,
  descriptorHash: 'b'.repeat(64),
  controllerCredentialFingerprint: `sha256:${'c'.repeat(64)}`,
  suspended: false,
  terminal: false,
  revoked: false,
  lastUsedAtMs: null,
});

/** Writes a grants file exactly as an already-paired CLI left it on disk. */
const writePairedGrants = async (
  store: ExecutionGrantStore,
  grants: ReturnType<typeof pairedGrant>[],
): Promise<void> => {
  const payload = { schemaVersion: 4, namespace: NAMESPACE, grants };
  const integrity = createHmac('sha256', KEY).update(canonicalizeJson(payload)).digest('hex');
  await fs.writeFile(store.path, `${canonicalizeJson({ ...payload, integrity })}\n`);
};

describe('grants paired by an earlier CLI', () => {
  let directory: string;
  let grantStore: ExecutionGrantStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-paired-grants-'));
    grantStore = new ExecutionGrantStore({
      directory,
      namespace: NAMESPACE,
      integrityKey: KEY,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('still admits a conversation trigger', async () => {
    await writePairedGrants(grantStore, [pairedGrant('grant-1', PAIRED_GRANT_OPERATIONS)]);
    const admission = new HostActionAdmission({
      assertionVerifier: Object.create(
        ControllerAssertionVerifier.prototype,
      ) as ControllerAssertionVerifier,
      grantStore,
      replayStore: new AuthorizationReplayStore({
        directory,
        namespace: NAMESPACE,
        integrityKey: KEY,
        now: () => NOW,
      }),
    });

    const result = await admission.admit({
      machineId: 'machine-1',
      userId: 'user-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      actionCategory: 'CONVERSATION',
      actionType: 'CONVERSATION_TRIGGER',
      actionPayloadHash: 'a'.repeat(64),
      target: { kind: 'AGENT_SESSION', id: 'session-1', revision: null },
      agentSessionId: 'session-1',
      envelopeNonce: 'envelope-nonce',
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
    });

    expect(
      result,
      'CURRENT_AGENT_OPERATIONS no longer matches the bundle in grants users have already paired; every user would have to re-pair before any message runs.',
    ).toMatchObject({ admitted: true, grantId: 'grant-1' });
  });

  it('stays readable when one stored grant names a different operation bundle', async () => {
    await writePairedGrants(grantStore, [
      pairedGrant('other-bundle', [...PAIRED_GRANT_OPERATIONS, 'RETIRED_OPERATION']),
      pairedGrant('grant-1', [...CURRENT_AGENT_OPERATIONS]),
    ]);

    expect((await grantStore.list()).map((grant) => grant.grantId)).toEqual(['grant-1']);
    await expect(
      grantStore.create({
        grantId: 'grant-2',
        descriptor: {
          scope: 'controller_device_window',
          controllerCredentialId: 'credential-1',
          controllerInstallationId: 'installation-1',
          machineId: 'machine-1',
          userId: 'user-1',
          organizationId: 'organization-1',
          cadence: 'ONE_MONTH',
          policyRevision: 1,
          allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
          allowedActionCategories: new Set(['CONVERSATION' as const]),
          issuedAtMs: NOW,
          effectiveExpiresAtMs: NOW + ONE_MONTH_MS,
        },
        descriptorHash: 'd'.repeat(64),
        controllerCredentialFingerprint: `sha256:${'c'.repeat(64)}`,
      }),
    ).resolves.toMatchObject({ grantId: 'grant-2' });
    expect((await grantStore.list()).map((grant) => grant.grantId)).toEqual(['grant-1', 'grant-2']);
  });
});
