import crypto from 'node:crypto';

import { canonicalizeJson, type CanonicalJsonValue } from '../../shared/canonical-json';
import type {
  CanonicalControllerAuthorizationIntent,
  ExecutableControllerAssertionEvidence,
} from './types';
import {
  CURRENT_AGENT_OPERATION_CATEGORY,
  hasExactCurrentAgentOperations,
  isCurrentAgentOperation,
} from './types';
import type { ControllerCredentialPublicKey } from '../../shared/api/generated/api';
import type {
  ControllerAssertionVerificationResult,
  ControllerAuthorizationAdmissionContext,
  ControllerAuthorizationDenialReason,
  ControllerAssertionVerifierOptions,
  ControllerPublicKey,
} from './types';

const DEFAULT_FRESHNESS_MS = 120_000;
const CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS = new Map([
  ['FIVE_MINUTES', 5 * 60 * 1000],
  ['EIGHT_HOURS', 8 * 60 * 60 * 1000],
  ['ONE_DAY', 24 * 60 * 60 * 1000],
  ['ONE_WEEK', 7 * 24 * 60 * 60 * 1000],
  ['ONE_MONTH', 30 * 24 * 60 * 60 * 1000],
]);
const CHALLENGE_DOMAIN = Buffer.from('heyhey-controller-authorization-v1', 'utf8');
const ZERO_BYTE = Buffer.from([0]);
const P256_UNCOMPRESSED_PREFIX = Buffer.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeBase64Url = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  const decoded = Buffer.from(padded, 'base64');
  const roundTrip = decoded
    .toString('base64')
    .replace(/=/gu, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_');
  return roundTrip === value ? decoded : null;
};

const base64Url = (value: Buffer): string =>
  value.toString('base64').replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');

const rawEcdsaSignatureToDer = (signature: Buffer): Buffer | null => {
  if (signature.length !== 64) return null;
  const encodeInteger = (value: Buffer): Buffer => {
    const firstNonZero = value.findIndex((byte) => byte !== 0);
    const trimmed = firstNonZero < 0 ? Buffer.from([0]) : value.subarray(firstNonZero);
    return trimmed[0] !== undefined && (trimmed[0] & 0x80) !== 0
      ? Buffer.concat([Buffer.from([0]), trimmed])
      : trimmed;
  };
  const r = encodeInteger(signature.subarray(0, 32));
  const s = encodeInteger(signature.subarray(32));
  const body = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
};

const asIntentJson = (intent: CanonicalControllerAuthorizationIntent): CanonicalJsonValue => ({
  version: intent.version,
  authorizationId: intent.authorizationId,
  controllerCredentialId: intent.controllerCredentialId,
  controllerInstallationId: intent.controllerInstallationId,
  machineId: intent.machineId,
  userId: intent.userId,
  organizationId: intent.organizationId,
  projectId: intent.projectId,
  cadence: intent.cadence,
  policyRevision: intent.policyRevision,
  effectiveGrantExpiresAtMs: intent.effectiveGrantExpiresAtMs,
  grantDescriptorHash: intent.grantDescriptorHash,
  actionCategory: intent.actionCategory,
  actionType: intent.actionType,
  actionPayloadHash: intent.actionPayloadHash,
  allowedActionTypes: [...intent.allowedActionTypes],
  allowedActionCategories: [...intent.allowedActionCategories],
  target: {
    kind: intent.target.kind,
    id: intent.target.id,
    revision: intent.target.revision,
  },
  agentSessionId: intent.agentSessionId,
  taskMonitorId: intent.taskMonitorId,
  nonce: intent.nonce,
  issuedAtMs: intent.issuedAtMs,
  expiresAtMs: intent.expiresAtMs,
});

const asGrantDescriptorJson = (
  descriptor: ExecutableControllerAssertionEvidence['grantDescriptor'],
): CanonicalJsonValue => ({
  scope: descriptor.scope,
  controllerCredentialId: descriptor.controllerCredentialId,
  controllerInstallationId: descriptor.controllerInstallationId,
  machineId: descriptor.machineId,
  userId: descriptor.userId,
  organizationId: descriptor.organizationId,
  cadence: descriptor.cadence,
  policyRevision: descriptor.policyRevision,
  allowedActionTypes: [...descriptor.allowedActionTypes],
  allowedActionCategories: [...descriptor.allowedActionCategories],
  issuedAtMs: descriptor.issuedAtMs,
  effectiveExpiresAtMs: descriptor.effectiveExpiresAtMs,
});

const verifyGrantDescriptor = (
  evidence: ExecutableControllerAssertionEvidence,
  context: ControllerAuthorizationAdmissionContext,
  now: number,
): ControllerAuthorizationDenialReason | null => {
  const { intent, grantDescriptor: descriptor } = evidence;
  const descriptorHash = crypto
    .createHash('sha256')
    .update(canonicalizeJson(asGrantDescriptorJson(descriptor)), 'utf8')
    .digest('hex');
  if (descriptorHash !== intent.grantDescriptorHash) return 'GRANT_SCOPE_MISMATCH';
  if (
    descriptor.controllerCredentialId !== intent.controllerCredentialId ||
    descriptor.controllerInstallationId !== intent.controllerInstallationId ||
    descriptor.machineId !== intent.machineId ||
    descriptor.userId !== intent.userId ||
    descriptor.organizationId !== intent.organizationId ||
    descriptor.cadence !== intent.cadence ||
    descriptor.policyRevision !== intent.policyRevision ||
    descriptor.issuedAtMs !== intent.issuedAtMs ||
    descriptor.effectiveExpiresAtMs !== intent.effectiveGrantExpiresAtMs ||
    JSON.stringify([...descriptor.allowedActionTypes]) !==
      JSON.stringify([...intent.allowedActionTypes]) ||
    JSON.stringify([...descriptor.allowedActionCategories]) !==
      JSON.stringify([...intent.allowedActionCategories])
  ) {
    return 'GRANT_SCOPE_MISMATCH';
  }
  const allowedActionTypes = [...descriptor.allowedActionTypes];
  if (
    !hasExactCurrentAgentOperations(allowedActionTypes) ||
    !isCurrentAgentOperation(context.actionType) ||
    !allowedActionTypes.includes(context.actionType) ||
    CURRENT_AGENT_OPERATION_CATEGORY[context.actionType] !== context.actionCategory ||
    ![...descriptor.allowedActionCategories].includes(context.actionCategory)
  ) {
    return 'ACTION_MISMATCH';
  }
  const cadenceTtlMs = CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.get(intent.cadence);
  if (
    cadenceTtlMs === undefined ||
    !Number.isSafeInteger(descriptor.effectiveExpiresAtMs) ||
    descriptor.effectiveExpiresAtMs <= descriptor.issuedAtMs ||
    descriptor.effectiveExpiresAtMs - descriptor.issuedAtMs !== cadenceTtlMs ||
    descriptor.effectiveExpiresAtMs <= now
  ) {
    return 'AUTHORIZATION_EXPIRED';
  }
  if (!evidence.grantId) {
    return 'GRANT_SCOPE_MISMATCH';
  }
  return null;
};

const challengeForIntent = (intent: CanonicalControllerAuthorizationIntent): string =>
  base64Url(
    crypto
      .createHash('sha256')
      .update(
        Buffer.concat([
          CHALLENGE_DOMAIN,
          ZERO_BYTE,
          Buffer.from(canonicalizeJson(asIntentJson(intent)), 'utf8'),
        ]),
      )
      .digest(),
  );

const toPublicKey = (value: ControllerPublicKey): crypto.KeyObject | null => {
  try {
    if (value instanceof crypto.KeyObject) return value;
    if (typeof value === 'string') return crypto.createPublicKey(value);
    if (value.length === 65 && value[0] === 0x04) {
      return crypto.createPublicKey({
        key: Buffer.concat([P256_UNCOMPRESSED_PREFIX, value]),
        format: 'der',
        type: 'spki',
      });
    }
    return crypto.createPublicKey({ key: value, format: 'der', type: 'spki' });
  } catch {
    return null;
  }
};

const compareTarget = (
  left: ControllerAuthorizationAdmissionContext['target'],
  right: ControllerAuthorizationAdmissionContext['target'],
): boolean => left.kind === right.kind && left.id === right.id && left.revision === right.revision;

const compareIntentContext = (
  intent: CanonicalControllerAuthorizationIntent,
  context: ControllerAuthorizationAdmissionContext,
): ControllerAuthorizationDenialReason | null => {
  if (
    context.controllerInstallationId === undefined ||
    intent.controllerInstallationId !== context.controllerInstallationId
  ) {
    return 'INSTALLATION_MISMATCH';
  }
  if (
    intent.machineId !== context.machineId ||
    intent.userId !== context.userId ||
    intent.organizationId !== context.organizationId ||
    intent.projectId !== context.projectId
  ) {
    return 'ACTION_MISMATCH';
  }
  if (
    intent.actionCategory !== context.actionCategory ||
    intent.actionType !== context.actionType
  ) {
    return 'ACTION_MISMATCH';
  }
  if (intent.actionPayloadHash !== context.actionPayloadHash) return 'PAYLOAD_HASH_MISMATCH';
  if (!compareTarget(intent.target, context.target)) return 'TARGET_MISMATCH';
  if (
    intent.agentSessionId !== (context.agentSessionId ?? null) ||
    intent.taskMonitorId !== (context.taskMonitorId ?? null)
  ) {
    return 'TARGET_MISMATCH';
  }
  return null;
};

const parseClientData = (
  serialized: Buffer,
  expectedChallenge: string,
  expectedOrigin: string,
): ControllerAuthorizationDenialReason | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized.toString('utf8')) as unknown;
  } catch {
    return 'CHALLENGE_MISMATCH';
  }
  if (!isRecord(parsed)) return 'CHALLENGE_MISMATCH';
  if (parsed['type'] !== 'webauthn.get') return 'CHALLENGE_MISMATCH';
  if (parsed['challenge'] !== expectedChallenge) return 'CHALLENGE_MISMATCH';
  if (parsed['origin'] !== expectedOrigin) return 'ORIGIN_MISMATCH';
  if (parsed['crossOrigin'] !== undefined && parsed['crossOrigin'] !== false) {
    return 'ORIGIN_MISMATCH';
  }
  return null;
};

const parseAuthenticatorData = (
  serialized: Buffer,
  rpId: string,
): ControllerAuthorizationDenialReason | null => {
  if (serialized.length < 37) return 'RP_ID_MISMATCH';
  const expectedRpIdHash = crypto.createHash('sha256').update(rpId, 'utf8').digest();
  if (!crypto.timingSafeEqual(serialized.subarray(0, 32), expectedRpIdHash)) {
    return 'RP_ID_MISMATCH';
  }
  const flags = serialized[32] ?? 0;
  if ((flags & 0x01) === 0) return 'USER_PRESENCE_REQUIRED';
  if ((flags & 0x04) === 0) return 'USER_VERIFICATION_REQUIRED';
  return null;
};

const publicKeyFromControllerCredential = (
  value: ControllerCredentialPublicKey,
): crypto.KeyObject | null => {
  const x = decodeBase64Url(value.x);
  const y = decodeBase64Url(value.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) return null;
  return toPublicKey(Buffer.concat([Buffer.from([0x04]), x, y]));
};

/** Verifies the complete controller proof independently of the platform. */
export class ControllerAssertionVerifier {
  private readonly now: () => number;
  private readonly freshnessMs: number;

  public constructor(private readonly options: ControllerAssertionVerifierOptions) {
    this.now = options.now ?? (() => Date.now());
    this.freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  }

  public async verify(
    evidence: ExecutableControllerAssertionEvidence,
    context: ControllerAuthorizationAdmissionContext,
  ): Promise<ControllerAssertionVerificationResult> {
    let registry;
    try {
      registry = await this.options.registry.read();
    } catch {
      return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
    }
    const intent = evidence.intent;
    const entry = registry?.controllers.find(
      (candidate) =>
        candidate.machineId === context.machineId &&
        candidate.controllerCredentialId === intent.controllerCredentialId,
    );
    if (!entry) {
      return { ok: false, reason: 'MACHINE_NOT_READY' };
    }
    if (entry.accountId !== context.userId || entry.organizationId !== context.organizationId) {
      return { ok: false, reason: 'CONTROLLER_NOT_ACTIVE' };
    }

    const contextReason = compareIntentContext(intent, context);
    if (contextReason) return { ok: false, reason: contextReason };
    if (intent.controllerCredentialId !== entry.controllerCredentialId) {
      return { ok: false, reason: 'CREDENTIAL_MISMATCH' };
    }
    if (evidence.credentialId !== entry.controllerCredentialId) {
      return { ok: false, reason: 'CREDENTIAL_MISMATCH' };
    }

    const now = this.now();
    if (
      !Number.isSafeInteger(intent.issuedAtMs) ||
      !Number.isSafeInteger(intent.expiresAtMs) ||
      intent.expiresAtMs <= intent.issuedAtMs ||
      intent.expiresAtMs - intent.issuedAtMs !== DEFAULT_FRESHNESS_MS ||
      intent.expiresAtMs - intent.issuedAtMs > this.freshnessMs ||
      now < intent.issuedAtMs ||
      now >= intent.expiresAtMs
    ) {
      return { ok: false, reason: 'AUTHORIZATION_EXPIRED' };
    }
    const descriptorReason = verifyGrantDescriptor(evidence, context, now);
    if (descriptorReason) return { ok: false, reason: descriptorReason };

    const clientData = decodeBase64Url(evidence.clientDataJSON);
    const authenticatorData = decodeBase64Url(evidence.authenticatorData);
    const signature = decodeBase64Url(evidence.signature);
    if (!clientData || !authenticatorData || !signature) {
      return { ok: false, reason: 'SCHEMA_INVALID' };
    }
    const clientDataReason = parseClientData(
      clientData,
      challengeForIntent(intent),
      this.options.origin,
    );
    if (clientDataReason) return { ok: false, reason: clientDataReason };
    const authenticatorReason = parseAuthenticatorData(authenticatorData, this.options.rpId);
    if (authenticatorReason) return { ok: false, reason: authenticatorReason };
    if (this.options.expectedUserHandle !== undefined) {
      const userHandle = decodeBase64Url(evidence.userHandle ?? '');
      if (userHandle?.toString('utf8') !== this.options.expectedUserHandle) {
        return { ok: false, reason: 'CREDENTIAL_MISMATCH' };
      }
    }

    const publicKey = publicKeyFromControllerCredential(entry.controllerCredentialPublicKey);
    if (!publicKey) return { ok: false, reason: 'CONTROLLER_NOT_ACTIVE' };
    const signedBytes = Buffer.concat([
      authenticatorData,
      crypto.createHash('sha256').update(clientData).digest(),
    ]);
    let valid = false;
    try {
      valid = crypto.verify('sha256', signedBytes, publicKey, signature);
      if (!valid) {
        const derSignature = rawEcdsaSignatureToDer(signature);
        if (derSignature) valid = crypto.verify('sha256', signedBytes, publicKey, derSignature);
      }
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'SIGNATURE_INVALID' };

    return {
      ok: true,
      authorizationId: intent.authorizationId,
      intent,
      credentialFingerprint: entry.controllerCredentialFingerprint,
    };
  }
}

export { asGrantDescriptorJson, challengeForIntent };
