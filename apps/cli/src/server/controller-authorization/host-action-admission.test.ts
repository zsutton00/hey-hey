import { describe, expect, it, vi } from 'vitest';

import { AuthorizationReplayStore } from './authorization-replay-store';
import { ControllerAssertionVerifier } from './controller-assertion-verifier';
import { ExecutionGrantStore } from './execution-grant-store';
import { HostActionAdmission } from './host-action-admission';
import { StructuredServerLogger } from '../logger';
import type {
  ExecutableEnvelopeAuthorization,
  ExecutionGrant,
  HostActionAdmissionRequest,
} from './types';
import { CURRENT_AGENT_OPERATIONS } from './types';

const intent = {
  version: 2 as const,
  authorizationId: 'authorization-1',
  controllerCredentialId: 'credential-1',
  controllerInstallationId: 'installation-1',
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  cadence: 'ONE_DAY' as const,
  policyRevision: 1,
  effectiveGrantExpiresAtMs: 1_700_001_800_000,
  grantDescriptorHash: 'b'.repeat(64),
  actionCategory: 'CONVERSATION' as const,
  actionType: 'CONVERSATION_TRIGGER' as const,
  actionPayloadHash: 'a'.repeat(64),
  allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
  allowedActionCategories: new Set(['CONVERSATION' as const, 'CLI_READ' as const]),
  target: { kind: 'CONVERSATION' as const, id: 'conversation-1', revision: null },
  agentSessionId: null,
  taskMonitorId: null,
  nonce: 'intent-nonce',
  issuedAtMs: 1_700_000_000_000,
  expiresAtMs: 1_700_000_120_000,
};

const grantDescriptor = {
  scope: 'controller_device_window' as const,
  controllerCredentialId: 'credential-1',
  controllerInstallationId: 'installation-1',
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  cadence: 'ONE_DAY' as const,
  policyRevision: 1,
  allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
  allowedActionCategories: new Set(['CONVERSATION' as const, 'CLI_READ' as const]),
  issuedAtMs: 1_700_000_000_000,
  effectiveExpiresAtMs: 1_700_001_800_000,
};

const assertionAuthorization: ExecutableEnvelopeAuthorization = {
  kind: 'controller_assertion',
  intent,
  credentialId: 'credential-1',
  clientDataJSON: 'client-data',
  authenticatorData: 'authenticator-data',
  signature: 'signature',
  userHandle: null,
  grantId: 'grant-1',
  grantDescriptor,
};

const request = (
  authorization: ExecutableEnvelopeAuthorization = assertionAuthorization,
): HostActionAdmissionRequest => ({
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  controllerInstallationId: 'installation-1',
  actionCategory: 'CONVERSATION',
  actionType: 'CONVERSATION_TRIGGER',
  actionPayloadHash: 'a'.repeat(64),
  target: intent.target,
  agentSessionId: 'session-1',
  authorizedTurnId: 'turn-1',
  taskMonitorId: null,
  envelopeNonce: 'envelope-nonce',
  authorization,
});

const grantResult: ExecutionGrant = {
  version: 4,
  grantId: 'grant-1',
  namespace: 'profile-1',
  scope: 'controller_device_window',
  controllerCredentialId: 'credential-1',
  controllerInstallationId: 'installation-1',
  machineId: 'machine-1',
  userId: 'user-1',
  organizationId: 'organization-1',
  cadence: 'ONE_DAY',
  policyRevision: 1,
  allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
  allowedActionCategories: ['CONVERSATION', 'CLI_READ'],
  issuedAtMs: 1_700_000_000_000,
  effectiveExpiresAtMs: 1_700_001_800_000,
  descriptorHash: 'b'.repeat(64),
  controllerCredentialFingerprint: 'c'.repeat(64),
  suspended: false,
  terminal: false,
  revoked: false,
  lastUsedAtMs: null,
};

const harness = (logger?: StructuredServerLogger) => {
  const verifier = Object.create(
    ControllerAssertionVerifier.prototype,
  ) as ControllerAssertionVerifier;
  const grantStore = Object.create(ExecutionGrantStore.prototype) as ExecutionGrantStore;
  const replayStore = Object.create(AuthorizationReplayStore.prototype) as AuthorizationReplayStore;
  const verify = vi.spyOn(verifier, 'verify').mockResolvedValue({
    ok: true,
    authorizationId: intent.authorizationId,
    intent,
    credentialFingerprint: 'c'.repeat(64),
  });
  const create = vi.spyOn(grantStore, 'create').mockResolvedValue(grantResult);
  const admit = vi.spyOn(grantStore, 'admit').mockResolvedValue(grantResult);
  const consume = vi.spyOn(replayStore, 'consume').mockResolvedValue(true);
  const consumeMany = vi.spyOn(replayStore, 'consumeMany').mockResolvedValue(true);
  const admission = new HostActionAdmission({
    ...(logger ? { logger } : {}),
    assertionVerifier: verifier,
    grantStore,
    replayStore,
  });
  return { admission, verify, create, admit, consume, consumeMany };
};

describe('HostActionAdmission', () => {
  it('times delayed grant and nonce work on the attempt logger without exposing nonces or payloads', async () => {
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'debug',
      writeLine: (line) => lines.push(line),
    });
    const { admission, admit, consume } = harness(logger);
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    admit.mockImplementation(async () => {
      await delay;
      return grantResult;
    });
    const attempt = logger.child({ key: 'operation-1', keyKind: 'operation', admissionAttempt: 7 });
    const pending = admission.admit(
      request({ kind: 'bounded_grant', grantId: 'grant-1' }),
      attempt,
    );
    expect(
      lines.some(
        (line) =>
          line.includes('grant_check.started') &&
          line.includes('"key":"operation-1"') &&
          line.includes('"admissionAttempt":7'),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes('grant_check.completed'))).toBe(false);
    release();
    expect(await pending).toMatchObject({ admitted: true });
    expect(
      lines.some((line) => line.includes('grant_check.completed') && line.includes('elapsedMs')),
    ).toBe(true);
    expect(lines.some((line) => line.includes('nonce_record.completed'))).toBe(true);
    consume.mockRejectedValue(new Error('sensitive backend failure'));
    expect(await admission.admitReduction('reduction-nonce', attempt)).toEqual({
      admitted: false,
      reason: 'STORAGE_UNAVAILABLE',
    });
    expect(
      lines.some((line) => line.includes('nonce_record.failed') && line.includes('elapsedMs')),
    ).toBe(true);
    expect(lines.join('')).not.toContain('envelope-nonce');
    expect(lines.join('')).not.toContain('reduction-nonce');
    expect(lines.join('')).not.toContain('sensitive backend failure');
    expect(lines.join('')).not.toContain('grantDescriptor');
  });

  it('persists only the verified immutable descriptor after admitting its assertion', async () => {
    const { admission, verify, create, admit, consumeMany } = harness();
    admit.mockRejectedValue(new Error('GRANT_NOT_ACTIVE'));

    await expect(admission.admit(request())).resolves.toMatchObject({
      admitted: true,
      authorizationId: 'authorization-1',
      grantId: 'grant-1',
    });
    expect(consumeMany).toHaveBeenCalledWith(
      ['envelope-nonce', 'authorization-1'],
      intent.expiresAtMs,
      undefined,
    );
    expect(verify).toHaveBeenCalledWith(
      assertionAuthorization,
      expect.objectContaining({ agentSessionId: null }),
    );
    expect(create).toHaveBeenCalledWith(
      {
        grantId: 'grant-1',
        descriptor: grantDescriptor,
        descriptorHash: 'b'.repeat(64),
        controllerCredentialFingerprint: 'c'.repeat(64),
      },
      undefined,
    );
  });

  it('resolves all reuse scope from the integrity-protected local grant', async () => {
    const authorization: ExecutableEnvelopeAuthorization = {
      kind: 'bounded_grant',
      grantId: 'grant-1',
    };
    const { admission, admit, verify } = harness();

    await expect(admission.admit(request(authorization))).resolves.toMatchObject({
      admitted: true,
      grantId: 'grant-1',
    });
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: 'machine-1',
        userId: 'user-1',
        organizationId: 'organization-1',
        actionCategory: 'CONVERSATION',
      }),
      undefined,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an action whose exact type does not belong to its category', async () => {
    const { admission, admit, verify } = harness();
    const mismatched = request({ kind: 'bounded_grant', grantId: 'grant-1' });
    mismatched.actionCategory = 'CLI_READ';

    await expect(admission.admit(mismatched)).resolves.toEqual({
      admitted: false,
      reason: 'ACTION_MISMATCH',
    });
    expect(admit).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails safely when a reference arrives before local activation', async () => {
    const authorization: ExecutableEnvelopeAuthorization = {
      kind: 'bounded_grant',
      grantId: 'grant-1',
    };
    const { admission, admit } = harness();
    admit.mockRejectedValue(new Error('GRANT_NOT_ACTIVE'));

    await expect(admission.admit(request(authorization))).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_NOT_ACTIVE',
    });
    expect(admit).toHaveBeenCalledOnce();
  });

  it('does no replay or grant work when assertion verification denies', async () => {
    const { admission, verify, create, consumeMany } = harness();
    verify.mockResolvedValue({ ok: false, reason: 'SIGNATURE_INVALID' });

    await expect(admission.admit(request())).resolves.toEqual({
      admitted: false,
      reason: 'SIGNATURE_INVALID',
    });
    expect(consumeMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('workspace catalog controller approval', () => {
  it('reuses the existing read grant without another assertion and rejects replay', async () => {
    const { admission, admit, verify, consume } = harness();
    const workspace = {
      ...request({ kind: 'bounded_grant', grantId: 'grant-1' }),
      actionCategory: 'CLI_READ' as const,
      actionType: 'CLI_READ' as const,
      target: { kind: 'CLI_READ' as const, id: 'machine-1', revision: null },
      agentSessionId: null,
    };
    expect(await admission.admit(workspace)).toMatchObject({ admitted: true });
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: 'machine-1',
        organizationId: 'organization-1',
        actionType: 'CLI_READ',
      }),
      undefined,
    );
    expect(verify).not.toHaveBeenCalled();
    consume.mockResolvedValue(false);
    expect(await admission.admit(workspace)).toMatchObject({
      admitted: false,
      reason: 'REPLAY_DETECTED',
    });
  });
});
