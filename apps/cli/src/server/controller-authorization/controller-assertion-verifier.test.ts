import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../../shared/canonical-json';
import {
  asGrantDescriptorJson,
  ControllerAssertionVerifier,
  challengeForIntent,
} from './controller-assertion-verifier';
import type {
  CanonicalControllerAuthorizationIntent,
  ExecutableControllerAssertionEvidence,
  ControllerAuthorizationAdmissionContext,
} from './types';
import { CURRENT_AGENT_OPERATIONS } from './types';

const machineId = 'machine-00000000-0000-4000-8000-000000000001';
const userId = 'user-00000000-0000-4000-8000-000000000001';
const organizationId = 'org-00000000-0000-4000-8000-000000000001';
const projectId = 'project-00000000-0000-4000-8000-000000000001';
const credentialId = 'credential-1';
const now = 1_700_000_000_000;

const context: ControllerAuthorizationAdmissionContext = {
  machineId,
  userId,
  organizationId,
  projectId,
  controllerInstallationId: 'installation-1',
  actionCategory: 'CONVERSATION',
  actionType: 'CONVERSATION_TRIGGER',
  actionPayloadHash: 'a'.repeat(64),
  target: { kind: 'CONVERSATION', id: 'conversation-1', revision: null },
  agentSessionId: null,
  taskMonitorId: null,
};

const makeGrantDescriptor = (id = credentialId, installationId = 'installation-1') => ({
  scope: 'controller_device_window' as const,
  controllerCredentialId: id,
  controllerInstallationId: installationId,
  machineId,
  userId,
  organizationId,
  cadence: 'FIVE_MINUTES' as const,
  policyRevision: 1,
  allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
  allowedActionCategories: new Set(['CONVERSATION' as const]),
  issuedAtMs: now - 1_000,
  effectiveExpiresAtMs: now + 299_000,
});

const descriptorHash = (id = credentialId, installationId = 'installation-1'): string =>
  crypto
    .createHash('sha256')
    .update(canonicalizeJson(asGrantDescriptorJson(makeGrantDescriptor(id, installationId))))
    .digest('hex');

const makeIntent = (
  id = credentialId,
  installationId = 'installation-1',
): CanonicalControllerAuthorizationIntent => ({
  version: 2,
  authorizationId: 'auth-00000000-0000-4000-8000-000000000001',
  controllerCredentialId: id,
  controllerInstallationId: installationId,
  machineId,
  userId,
  organizationId,
  projectId,
  cadence: 'FIVE_MINUTES',
  policyRevision: 1,
  effectiveGrantExpiresAtMs: now + 299_000,
  grantDescriptorHash: descriptorHash(id, installationId),
  actionCategory: context.actionCategory,
  actionType: context.actionType,
  actionPayloadHash: context.actionPayloadHash,
  allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
  allowedActionCategories: new Set(['CONVERSATION']),
  target: context.target,
  agentSessionId: null,
  taskMonitorId: null,
  nonce: 'A'.repeat(43),
  issuedAtMs: now - 1_000,
  expiresAtMs: now + 119_000,
});

const makeEvidence = (
  intent: CanonicalControllerAuthorizationIntent,
  privateKey: crypto.KeyObject,
): ExecutableControllerAssertionEvidence => {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: challengeForIntent(intent),
      origin: 'https://heyhey.dev',
      crossOrigin: false,
      other_keys_can_be_added_here: 'WebAuthn clients may add extension fields.',
    }),
  );
  const authenticatorData = Buffer.concat([
    crypto.createHash('sha256').update('heyhey.dev').digest(),
    Buffer.from([0x05, 0, 0, 0, 1]),
  ]);
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]),
    privateKey,
  );
  return {
    kind: 'controller_assertion',
    intent,
    credentialId: intent.controllerCredentialId,
    clientDataJSON: clientDataJSON.toString('base64url'),
    authenticatorData: authenticatorData.toString('base64url'),
    signature: signature.toString('base64url'),
    userHandle: null,
    grantId: 'grant-00000000-0000-4000-8000-000000000001',
    grantDescriptor: makeGrantDescriptor(
      intent.controllerCredentialId,
      intent.controllerInstallationId,
    ),
  };
};

describe('ControllerAssertionVerifier', () => {
  const publicKeyJwk = (keyPair: crypto.KeyPairKeyObjectResult) => {
    const jwk = keyPair.publicKey.export({ format: 'jwk' });
    return { kty: 'EC' as const, crv: 'P-256' as const, x: jwk.x!, y: jwk.y! };
  };

  it('verifies the canonical challenge, WebAuthn evidence, and local binding', async () => {
    const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const intent = makeIntent();
    const verifier = new ControllerAssertionVerifier({
      registry: {
        read: async () => ({
          controllers: [
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: credentialId,
              controllerCredentialPublicKey: {
                ...publicKeyJwk(keyPair),
              },
              controllerCredentialFingerprint: 'fingerprint-1',
            },
          ],
        }),
      },
      origin: 'https://heyhey.dev',
      rpId: 'heyhey.dev',
      now: () => now,
    });

    const result = await verifier.verify(makeEvidence(intent, keyPair.privateKey), context);
    expect(result).toEqual({
      ok: true,
      authorizationId: intent.authorizationId,
      intent,
      credentialFingerprint: 'fingerprint-1',
    });

    const substitutedDescriptor = makeEvidence(intent, keyPair.privateKey);
    substitutedDescriptor.grantDescriptor = {
      ...substitutedDescriptor.grantDescriptor,
      allowedActionCategories: new Set(['CLI_READ']),
    };
    await expect(verifier.verify(substitutedDescriptor, context)).resolves.toEqual({
      ok: false,
      reason: 'GRANT_SCOPE_MISMATCH',
    });

    const reusableWithoutGrant = {
      ...makeEvidence(intent, keyPair.privateKey),
      grantId: null,
    } as unknown as ExecutableControllerAssertionEvidence;
    await expect(verifier.verify(reusableWithoutGrant, context)).resolves.toEqual({
      ok: false,
      reason: 'GRANT_SCOPE_MISMATCH',
    });

    for (const removedCadence of ['EVERY_ACTION', 'CURRENT_BROWSER_SESSION'] as const) {
      const removedIntent = {
        ...intent,
        cadence: removedCadence,
      } as unknown as CanonicalControllerAuthorizationIntent;
      await expect(
        verifier.verify(makeEvidence(removedIntent, keyPair.privateKey), context),
      ).resolves.toEqual({
        ok: false,
        reason: 'GRANT_SCOPE_MISMATCH',
      });
    }
  });

  it('fails closed for a mismatched origin and user-verification flag', async () => {
    const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const intent = makeIntent();
    const verifier = new ControllerAssertionVerifier({
      registry: {
        read: async () => ({
          controllers: [
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: credentialId,
              controllerCredentialPublicKey: publicKeyJwk(keyPair),
              controllerCredentialFingerprint: 'fingerprint-1',
            },
          ],
        }),
      },
      origin: 'https://heyhey.dev',
      rpId: 'heyhey.dev',
      now: () => now,
    });
    const evidence = makeEvidence(intent, keyPair.privateKey);
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: challengeForIntent(intent),
        origin: 'https://evil.invalid',
      }),
    );
    evidence.clientDataJSON = clientData.toString('base64url');
    const originResult = await verifier.verify(evidence, context);
    expect(originResult.ok).toBe(false);
    if (originResult.ok) throw new Error('Expected origin rejection.');
    expect(originResult.reason).toBe('ORIGIN_MISMATCH');

    const freshEvidence = makeEvidence(intent, keyPair.privateKey);
    const authenticatorData = Buffer.concat([
      crypto.createHash('sha256').update('heyhey.dev').digest(),
      Buffer.from([0x01, 0, 0, 0, 1]),
    ]);
    freshEvidence.authenticatorData = authenticatorData.toString('base64url');
    const verificationResult = await verifier.verify(freshEvidence, context);
    expect(verificationResult.ok).toBe(false);
    if (verificationResult.ok) throw new Error('Expected UV rejection.');
    expect(verificationResult.reason).toBe('USER_VERIFICATION_REQUIRED');
  });

  it('resolves each controller credential to its own verification key and fails closed on mismatch or absence', async () => {
    const firstKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const secondKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const secondIntent = makeIntent('credential-2');
    const secondContext = { ...context };
    const verifier = new ControllerAssertionVerifier({
      registry: {
        read: async () => ({
          controllers: [
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: credentialId,
              controllerCredentialPublicKey: publicKeyJwk(firstKeyPair),
              controllerCredentialFingerprint: 'fingerprint-1',
            },
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: 'credential-2',
              controllerCredentialPublicKey: publicKeyJwk(secondKeyPair),
              controllerCredentialFingerprint: 'fingerprint-2',
            },
          ],
        }),
      },
      origin: 'https://heyhey.dev',
      rpId: 'heyhey.dev',
      now: () => now,
    });

    await expect(
      verifier.verify(makeEvidence(secondIntent, secondKeyPair.privateKey), secondContext),
    ).resolves.toMatchObject({
      ok: true,
      authorizationId: secondIntent.authorizationId,
    });

    await expect(
      verifier.verify(makeEvidence(makeIntent(), secondKeyPair.privateKey), context),
    ).resolves.toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });

    const missingKeyVerifier = new ControllerAssertionVerifier({
      registry: {
        read: async () => ({
          controllers: [
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: credentialId,
              controllerCredentialPublicKey: {
                kty: 'EC',
                crv: 'P-256',
                x: 'A'.repeat(42),
                y: 'B'.repeat(43),
              },
              controllerCredentialFingerprint: 'fingerprint-1',
            },
          ],
        }),
      },
      origin: 'https://heyhey.dev',
      rpId: 'heyhey.dev',
      now: () => now,
    });
    await expect(
      missingKeyVerifier.verify(makeEvidence(makeIntent(), firstKeyPair.privateKey), context),
    ).resolves.toEqual({
      ok: false,
      reason: 'CONTROLLER_NOT_ACTIVE',
    });
  });

  it('keeps synchronized installations distinct while resolving the same credential key', async () => {
    const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const verifier = new ControllerAssertionVerifier({
      registry: {
        read: async () => ({
          controllers: [
            {
              machineId,
              accountId: userId,
              organizationId,
              authorizationProtocolVersion: 2,
              controllerCredentialId: credentialId,
              controllerCredentialPublicKey: publicKeyJwk(keyPair),
              controllerCredentialFingerprint: 'fingerprint-1',
            },
          ],
        }),
      },
      origin: 'https://heyhey.dev',
      rpId: 'heyhey.dev',
      now: () => now,
    });

    const firstIntent = makeIntent();
    const secondIntent = makeIntent(credentialId, 'installation-2');
    await expect(
      verifier.verify(makeEvidence(firstIntent, keyPair.privateKey), {
        ...context,
        controllerInstallationId: 'installation-1',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifier.verify(makeEvidence(secondIntent, keyPair.privateKey), {
        ...context,
        controllerInstallationId: 'installation-2',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifier.verify(makeEvidence(secondIntent, keyPair.privateKey), {
        ...context,
        controllerInstallationId: 'installation-1',
      }),
    ).resolves.toEqual({ ok: false, reason: 'INSTALLATION_MISMATCH' });
  });
});
