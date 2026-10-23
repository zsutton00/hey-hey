import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { KeyringPlatformStore } from './platforms/keyring';
import type { PlatformStore } from './platforms/types';
import { resolveEnvironmentHost } from '../session/paths';
import { validateKey } from './store';

const PRIVATE_KEY_SUFFIX = '/private_key';
// Staged private key written during a key rotation. The live key keeps working
// until `commitKeyRotation` promotes this into its place, so a crash before the
// commit point never loses the usable key.
const PRIVATE_KEY_STAGE_SUFFIX = '/private_key.next';
// Single commit marker. Its presence is the one load-bearing signal that tells
// `resumeKeyRotation` to roll a half-finished swap FORWARD (promote the stage)
// rather than BACK (discard the stage). Written only at the commit point, so its
// absence always means "the rotation never committed; keep the old key."
const PRIVATE_KEY_COMMIT_SUFFIX = '/private_key.commit';
const CREDENTIAL_SUFFIX = '/credential';
const SERVER_SIGNING_PUBLIC_KEY_SUFFIX = '/server_signing_public_key';
const PENDING_ENROLLMENT_SECRET_SUFFIX = '/pending_enrollment_secret';
const PENDING_ENROLLMENT_ID_SUFFIX = '/pending_enrollment_id';
const PENDING_ENROLLMENT_METADATA_SUFFIX = '/pending_enrollment_metadata';
const PENDING_ENROLLMENT_ACTIVATION_SUFFIX = '/pending_enrollment_activation';
const CONTROLLER_REGISTRY_INTEGRITY_KEY_SUFFIX = '/controller_registry_integrity_key';
const AUTHORIZATION_STATE_INTEGRITY_KEY_SUFFIX = '/authorization_state_integrity_key';
const MACHINE_ID_ACCOUNT = 'current/machine_id';

export interface GeneratedMachineKeyPair {
  privateKeyPem: string;
  publicKey: Buffer;
}

/** Pure Ed25519 key generation. Persistence belongs to KeyPairStore. */
export const generateMachineKeyPair = (): GeneratedMachineKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }),
  };
};

export interface KeyPairStoreOptions {
  platformStoreOverride?: PlatformStore;
  /**
   * Override the backend namespace otherwise derived from `HEYHEY_API_URL`.
   * Tests use this to exercise prod-vs-local isolation without mutating the
   * process environment.
   */
  namespaceOverride?: string;
}

/**
 * Keychain account-namespace prefix for the API backend this CLI is paired
 * against, derived from `HEYHEY_API_URL` (which `--local` sets to
 * `http://localhost:3000`).
 *
 * The pairing credentials — `current/machine_id`, the per-machine private key,
 * credential token, and server signing public key — are backend-specific: a
 * machine paired against localhost is signed by localhost's key, not prod's.
 * Without a per-backend namespace, pairing under `--local` overwrites the
 * production entries in the shared `heyhey-cli` keychain service, so the next
 * prod run verifies prod-signed triggers against localhost's key and silently
 * drops every frame until a manual re-pair. Scoping by host keeps the two
 * backends' credentials disjoint — mirroring the host keying the OAuth
 * credential store already does (`heyhey:oauth:<host>`).
 *
 * The prod (default) backend keeps the original un-prefixed accounts so
 * existing pairings keep working without a re-pair; only non-prod backends are
 * prefixed.
 *
 * `HEYHEY_PROFILE` (set by `--profile`) appends a second `<profile>/` segment
 * after the host namespace so multiple accounts on the same backend stay
 * disjoint: prod becomes `<profile>/`, localhost:3000 becomes
 * `localhost:3000/<profile>/`. The no-profile path is unchanged.
 */
export const accountNamespace = (
  apiUrl: string | undefined = process.env['HEYHEY_API_URL'],
): string => {
  const profile = process.env['HEYHEY_PROFILE']?.trim();
  if (profile) validateKey(profile);
  const profilePrefix = profile ? `${profile}/` : '';

  const host = resolveEnvironmentHost(apiUrl);
  return host ? `${host}/${profilePrefix}` : profilePrefix;
};

/**
 * Machine keys and authority integrity keys always use the OS keyring.
 * Tests supply their isolated platform store explicitly; keyring failures
 * never select a file backend.
 */
/** Protected-store work behind one integrity-key read; `shared` reused an in-process value. */
export interface AuthorizationIntegrityKeyTiming {
  source: 'retrieved' | 'created' | 'shared';
  retrieveMs: number;
  storeMs: number;
}

export class KeyPairStore {
  private static backendLogged = false;

  private readonly platformStore: PlatformStore;
  private readonly namespace: string;
  private authorizationIntegrityKey: Promise<Buffer> | undefined;

  constructor(options: KeyPairStoreOptions = {}) {
    this.platformStore = options.platformStoreOverride ?? KeyPairStore.selectDefaultPlatformStore();
    this.namespace = options.namespaceOverride ?? accountNamespace();
  }

  /** Namespace shared by all protected records for this backend/profile. */
  getAccountNamespace(): string {
    return this.namespace;
  }

  private static selectDefaultPlatformStore(): PlatformStore {
    if (!KeyPairStore.backendLogged) {
      KeyPairStore.backendLogged = true;
      console.error('[credentials] backend=keyring');
    }
    return new KeyringPlatformStore();
  }

  private machineIdAccount(): string {
    return `${this.namespace}${MACHINE_ID_ACCOUNT}`;
  }

  private privateKeyAccount(machineId: string): string {
    return `${this.namespace}${machineId}${PRIVATE_KEY_SUFFIX}`;
  }

  private privateKeyStageAccount(machineId: string): string {
    return `${this.namespace}${machineId}${PRIVATE_KEY_STAGE_SUFFIX}`;
  }

  private privateKeyCommitAccount(machineId: string): string {
    return `${this.namespace}${machineId}${PRIVATE_KEY_COMMIT_SUFFIX}`;
  }

  private credentialAccount(machineId: string): string {
    return `${this.namespace}${machineId}${CREDENTIAL_SUFFIX}`;
  }

  private serverSigningPublicKeyAccount(machineId: string): string {
    return `${this.namespace}${machineId}${SERVER_SIGNING_PUBLIC_KEY_SUFFIX}`;
  }

  private pendingEnrollmentSecretAccount(enrollmentId: string): string {
    return `${this.namespace}${enrollmentId}${PENDING_ENROLLMENT_SECRET_SUFFIX}`;
  }

  private pendingEnrollmentIdAccount(): string {
    return `${this.namespace}current${PENDING_ENROLLMENT_ID_SUFFIX}`;
  }

  private pendingEnrollmentMetadataAccount(enrollmentId: string): string {
    return `${this.namespace}${enrollmentId}${PENDING_ENROLLMENT_METADATA_SUFFIX}`;
  }

  private pendingEnrollmentActivationAccount(enrollmentId: string): string {
    return `${this.namespace}${enrollmentId}${PENDING_ENROLLMENT_ACTIVATION_SUFFIX}`;
  }

  private controllerRegistryIntegrityKeyAccount(): string {
    return `${this.namespace}controller_registry${CONTROLLER_REGISTRY_INTEGRITY_KEY_SUFFIX}`;
  }

  private authorizationStateIntegrityKeyAccount(): string {
    return `${this.namespace}authorization_state${AUTHORIZATION_STATE_INTEGRITY_KEY_SUFFIX}`;
  }

  /**
   * Promote a staged key over the live key and clear the staging state. Reads
   * the stage fresh so it is idempotent under crash-resume.
   */
  private async rollRotationForward(machineId: string): Promise<void> {
    const staged = await this.platformStore.retrieve(this.privateKeyStageAccount(machineId));
    if (staged !== null) {
      await this.platformStore.store(this.privateKeyAccount(machineId), staged);
    }
    await this.platformStore.delete(this.privateKeyStageAccount(machineId));
    await this.platformStore.delete(this.privateKeyCommitAccount(machineId));
  }

  async generateAndStoreKeyPair(machineId: string): Promise<{ publicKey: Buffer }> {
    validateKey(machineId);
    const generated = generateMachineKeyPair();
    await this.storePrivateKey(machineId, generated.privateKeyPem);
    return { publicKey: generated.publicKey };
  }

  async storePrivateKey(machineId: string, privateKeyPem: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.store(this.privateKeyAccount(machineId), privateKeyPem);
  }

  async loadPrivateKey(machineId: string): Promise<string | null> {
    validateKey(machineId);
    return this.platformStore.retrieve(this.privateKeyAccount(machineId));
  }

  async loadCurrentMachineId(): Promise<string | null> {
    return this.platformStore.retrieve(this.machineIdAccount());
  }

  async setCurrentMachineId(machineId: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.store(this.machineIdAccount(), machineId);
  }

  async storeMachineCredential(machineId: string, token: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.store(this.credentialAccount(machineId), token);
  }

  async loadMachineCredential(machineId: string): Promise<string | null> {
    validateKey(machineId);
    return this.platformStore.retrieve(this.credentialAccount(machineId));
  }

  async storeServerSigningPublicKey(machineId: string, base64Key: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.store(this.serverSigningPublicKeyAccount(machineId), base64Key);
  }

  async loadServerSigningPublicKey(machineId: string): Promise<string | null> {
    validateKey(machineId);
    return this.platformStore.retrieve(this.serverSigningPublicKeyAccount(machineId));
  }

  async storePendingEnrollmentSecret(enrollmentId: string, deviceSecret: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.store(this.pendingEnrollmentSecretAccount(enrollmentId), deviceSecret);
  }

  async loadPendingEnrollmentSecret(enrollmentId: string): Promise<string | null> {
    validateKey(enrollmentId);
    return this.platformStore.retrieve(this.pendingEnrollmentSecretAccount(enrollmentId));
  }

  async deletePendingEnrollmentSecret(enrollmentId: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.delete(this.pendingEnrollmentSecretAccount(enrollmentId));
  }

  async storePendingEnrollmentId(enrollmentId: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.store(this.pendingEnrollmentIdAccount(), enrollmentId);
  }

  async loadPendingEnrollmentId(): Promise<string | null> {
    return this.platformStore.retrieve(this.pendingEnrollmentIdAccount());
  }

  async deletePendingEnrollmentId(): Promise<void> {
    await this.platformStore.delete(this.pendingEnrollmentIdAccount());
  }

  async storePendingEnrollmentMetadata(enrollmentId: string, metadata: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.store(this.pendingEnrollmentMetadataAccount(enrollmentId), metadata);
  }

  async loadPendingEnrollmentMetadata(enrollmentId: string): Promise<string | null> {
    validateKey(enrollmentId);
    return this.platformStore.retrieve(this.pendingEnrollmentMetadataAccount(enrollmentId));
  }

  async deletePendingEnrollmentMetadata(enrollmentId: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.delete(this.pendingEnrollmentMetadataAccount(enrollmentId));
  }

  /** Retains the server activation response for crash recovery without logging it. */
  async storePendingEnrollmentActivation(enrollmentId: string, activation: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.store(
      this.pendingEnrollmentActivationAccount(enrollmentId),
      activation,
    );
  }

  async loadPendingEnrollmentActivation(enrollmentId: string): Promise<string | null> {
    validateKey(enrollmentId);
    return this.platformStore.retrieve(this.pendingEnrollmentActivationAccount(enrollmentId));
  }

  async deletePendingEnrollmentActivation(enrollmentId: string): Promise<void> {
    validateKey(enrollmentId);
    await this.platformStore.delete(this.pendingEnrollmentActivationAccount(enrollmentId));
  }

  async storeControllerRegistryIntegrityKey(base64Key: string): Promise<void> {
    await this.platformStore.store(this.controllerRegistryIntegrityKeyAccount(), base64Key);
  }

  async loadControllerRegistryIntegrityKey(): Promise<string | null> {
    return this.platformStore.retrieve(this.controllerRegistryIntegrityKeyAccount());
  }

  async storeAuthorizationStateIntegrityKey(base64Key: string): Promise<void> {
    // A cold initialization must finish before an explicit replacement wins.
    await this.authorizationIntegrityKey?.catch(() => undefined);
    await this.platformStore.store(this.authorizationStateIntegrityKeyAccount(), base64Key);
    this.authorizationIntegrityKey = undefined;
  }

  async loadAuthorizationStateIntegrityKey(): Promise<string | null> {
    return this.platformStore.retrieve(this.authorizationStateIntegrityKeyAccount());
  }

  /**
   * Shared single-flight initialization; mutable authority files are never cached. `observe`
   * receives protected-store durations only for the caller that started the initialization.
   */
  async getAuthorizationStateIntegrityKey(
    observe?: (timing: AuthorizationIntegrityKeyTiming) => void,
  ): Promise<Buffer> {
    if (!this.authorizationIntegrityKey) {
      const initialization = this.initializeAuthorizationStateIntegrityKey(observe);
      this.authorizationIntegrityKey = initialization;
      void initialization.catch(() => {
        if (this.authorizationIntegrityKey === initialization) {
          this.authorizationIntegrityKey = undefined;
        }
      });
    } else {
      observe?.({ source: 'shared', retrieveMs: 0, storeMs: 0 });
    }
    return Buffer.from(await this.authorizationIntegrityKey);
  }

  private async initializeAuthorizationStateIntegrityKey(
    observe?: (timing: AuthorizationIntegrityKeyTiming) => void,
  ): Promise<Buffer> {
    const retrieveStarted = performance.now();
    const stored = await this.loadAuthorizationStateIntegrityKey();
    const retrieveMs = performance.now() - retrieveStarted;
    if (stored !== null) {
      observe?.({ source: 'retrieved', retrieveMs, storeMs: 0 });
      const key = Buffer.from(stored, 'base64');
      if (key.length !== 32)
        throw new Error('Authorization state integrity key has an invalid length.');
      return key;
    }
    const key = randomBytes(32);
    const storeStarted = performance.now();
    // Initialization writes directly so it does not invalidate its own single flight.
    await this.platformStore.store(
      this.authorizationStateIntegrityKeyAccount(),
      key.toString('base64'),
    );
    observe?.({ source: 'created', retrieveMs, storeMs: performance.now() - storeStarted });
    return key;
  }

  /** Generate and stage a replacement key without changing the live key. */
  async stageKeyRotation(machineId: string): Promise<{ publicKey: Buffer }> {
    validateKey(machineId);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await this.platformStore.store(this.privateKeyStageAccount(machineId), privateKeyPem);
    return { publicKey: publicKey.export({ type: 'spki', format: 'der' }) };
  }

  async commitKeyRotation(machineId: string): Promise<void> {
    validateKey(machineId);
    const staged = await this.platformStore.retrieve(this.privateKeyStageAccount(machineId));
    if (staged === null) {
      throw new Error('commitKeyRotation: no staged key to commit');
    }
    await this.platformStore.store(this.privateKeyCommitAccount(machineId), '1');
    await this.rollRotationForward(machineId);
  }

  async abortKeyRotation(machineId: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.delete(this.privateKeyStageAccount(machineId));
  }

  async resumeKeyRotation(machineId: string): Promise<void> {
    validateKey(machineId);
    const marker = await this.platformStore.retrieve(this.privateKeyCommitAccount(machineId));
    if (marker !== null) {
      await this.rollRotationForward(machineId);
      return;
    }
    await this.platformStore.delete(this.privateKeyStageAccount(machineId));
  }

  async deleteMachineCredential(machineId: string): Promise<void> {
    validateKey(machineId);
    await this.platformStore.delete(this.privateKeyAccount(machineId));
    await this.platformStore.delete(this.privateKeyStageAccount(machineId));
    await this.platformStore.delete(this.privateKeyCommitAccount(machineId));
    await this.platformStore.delete(this.credentialAccount(machineId));
    await this.platformStore.delete(this.serverSigningPublicKeyAccount(machineId));
    await this.platformStore.delete(this.machineIdAccount());
  }
}
