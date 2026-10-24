import crypto from 'node:crypto';
import { vi } from 'vitest';
import { hashControllerAction } from '../../shared/api/generated/controller-action-contract';
import type { HostActionPreparation } from '../../shared/api/generated/api';
import type { ExecutableEnvelopeAuthorization } from './types';
import { CURRENT_AGENT_OPERATIONS, CURRENT_AGENT_OPERATION_CATEGORY } from './types';
import {
  ControllerAssertionVerifier,
  asGrantDescriptorJson,
  challengeForIntent,
} from './controller-assertion-verifier';
import { HostActionAdmission } from './host-action-admission';
import { AuthorizationReplayStore } from './authorization-replay-store';
import { ExecutionGrantStore } from './execution-grant-store';
import { TriggerVerifier } from '../trigger-verification/verify';
import { canonicalizeJson } from '../trigger-verification/jcs';
import { NOOP_LOGGER } from '../logger';

export const directActionIds = {
  machineId: '77777777-7777-4777-8777-777777777777',
  userId: '88888888-8888-4888-8888-888888888888',
  organizationId: '33333333-3333-4333-8333-333333333333',
  projectId: '44444444-4444-4444-8444-444444444444',
  controllerId: '12345678-1234-4234-8234-123456789012',
  installationId: '12345678-1234-4234-8234-123456789013',
  grantId: '12345678-1234-4234-8234-123456789014',
};

/** Real controller and platform signatures; only durable I/O is isolated.
 * Each test starts without an active local grant, exercising fresh activation. */
export function directActionHarness(action: HostActionPreparation) {
  const now = Date.now();
  const controllerKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const platformKeys = crypto.generateKeyPairSync('ed25519');
  const categories = [
    ...new Set(CURRENT_AGENT_OPERATIONS.map((type) => CURRENT_AGENT_OPERATION_CATEGORY[type])),
  ];
  const descriptor = {
    scope: 'controller_device_window' as const,
    controllerCredentialId: directActionIds.controllerId,
    controllerInstallationId: directActionIds.installationId,
    machineId: directActionIds.machineId,
    userId: directActionIds.userId,
    organizationId: directActionIds.organizationId,
    cadence: 'FIVE_MINUTES' as const,
    policyRevision: 1,
    allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
    allowedActionCategories: new Set(categories),
    issuedAtMs: now - 1000,
    effectiveExpiresAtMs: now + 299000,
  };
  const intent = {
    version: 2 as const,
    authorizationId: crypto.randomUUID(),
    controllerCredentialId: directActionIds.controllerId,
    controllerInstallationId: directActionIds.installationId,
    machineId: directActionIds.machineId,
    userId: directActionIds.userId,
    organizationId: directActionIds.organizationId,
    projectId: directActionIds.projectId,
    cadence: 'FIVE_MINUTES' as const,
    policyRevision: 1,
    effectiveGrantExpiresAtMs: descriptor.effectiveExpiresAtMs,
    grantDescriptorHash: crypto
      .createHash('sha256')
      .update(canonicalizeJson(asGrantDescriptorJson(descriptor)))
      .digest('hex'),
    actionCategory: action.actionCategory,
    actionType: action.actionType,
    actionPayloadHash: hashControllerAction(action),
    allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
    allowedActionCategories: new Set(categories),
    target: { kind: action.targetKind, id: action.targetId, revision: null },
    agentSessionId: action.targetKind === 'AGENT_SESSION' ? action.targetId : null,
    taskMonitorId: action.targetKind === 'TASK_MONITOR' ? action.targetId : null,
    nonce: crypto.randomBytes(32).toString('base64url'),
    issuedAtMs: descriptor.issuedAtMs,
    expiresAtMs: now + 119000,
  };
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: challengeForIntent(intent),
      origin: 'https://heyhey.dev',
      crossOrigin: false,
    }),
  );
  const authenticatorData = Buffer.concat([
    crypto.createHash('sha256').update('heyhey.dev').digest(),
    Buffer.from([5, 0, 0, 0, 1]),
  ]);
  const proof: ExecutableEnvelopeAuthorization = {
    kind: 'controller_assertion',
    intent,
    credentialId: directActionIds.controllerId,
    clientDataJSON: clientDataJSON.toString('base64url'),
    authenticatorData: authenticatorData.toString('base64url'),
    signature: crypto
      .sign(
        'sha256',
        Buffer.concat([
          authenticatorData,
          crypto.createHash('sha256').update(clientDataJSON).digest(),
        ]),
        controllerKeys.privateKey,
      )
      .toString('base64url'),
    userHandle: null,
    grantId: directActionIds.grantId,
    grantDescriptor: descriptor,
  };
  const jwk = controllerKeys.publicKey.export({ format: 'jwk' });
  const assertionVerifier = new ControllerAssertionVerifier({
    origin: 'https://heyhey.dev',
    rpId: 'heyhey.dev',
    now: () => now,
    registry: {
      read: async () => ({
        controllers: [
          {
            machineId: directActionIds.machineId,
            accountId: directActionIds.userId,
            organizationId: directActionIds.organizationId,
            authorizationProtocolVersion: 2,
            controllerCredentialId: directActionIds.controllerId,
            controllerCredentialPublicKey: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! },
            controllerCredentialFingerprint: 'test-controller-fingerprint',
          },
        ],
      }),
    },
  });
  const replayStore = Object.create(AuthorizationReplayStore.prototype) as AuthorizationReplayStore;
  vi.spyOn(replayStore, 'consume').mockResolvedValue(true);
  vi.spyOn(replayStore, 'consumeMany').mockResolvedValue(true);
  const grantStore = Object.create(ExecutionGrantStore.prototype) as ExecutionGrantStore;
  vi.spyOn(grantStore, 'admit').mockRejectedValue(new Error('GRANT_NOT_ACTIVE'));
  const createGrant = vi
    .spyOn(grantStore, 'create')
    .mockResolvedValue({ grantId: directActionIds.grantId } as never);
  const admission = new HostActionAdmission({ assertionVerifier, replayStore, grantStore });
  const admit = vi.spyOn(admission, 'admit');
  const verifier = new TriggerVerifier({
    serverSigningPublicKey: platformKeys.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32),
    expectedMachineId: directActionIds.machineId,
    expectedUserId: directActionIds.userId,
    expectedOrganizationId: directActionIds.organizationId,
    requireProtocolVersion2: true,
    now: () => now,
    logger: NOOP_LOGGER,
  });
  const frame = <TBody extends object>(
    type:
      'cli.read.request' | 'trigger.control' | 'trigger.conversation' | 'trigger.monitor_command',
    body: TBody,
    conversationId: string,
  ) => {
    const authorization = {
      ...proof,
      intent: {
        ...intent,
        allowedActionTypes: [...intent.allowedActionTypes],
        allowedActionCategories: [...intent.allowedActionCategories],
      },
      grantDescriptor: {
        ...descriptor,
        allowedActionTypes: [...descriptor.allowedActionTypes],
        allowedActionCategories: [...descriptor.allowedActionCategories],
      },
    };
    const envelope = {
      event: body,
      protocolVersion: 2 as const,
      authorization,
      machineId: directActionIds.machineId,
      userId: directActionIds.userId,
      nonce: crypto.randomUUID(),
      timestampMs: now,
    };
    return {
      type,
      timestamp: new Date(now).toISOString(),
      organizationId: directActionIds.organizationId,
      projectId: directActionIds.projectId,
      conversationId,
      userId: directActionIds.userId,
      envelope: {
        ...envelope,
        signature: crypto
          .sign(null, Buffer.from(canonicalizeJson(envelope)), platformKeys.privateKey)
          .toString('base64'),
      },
    };
  };
  return { admission, admit, verifier, createGrant, frame, proof };
}
