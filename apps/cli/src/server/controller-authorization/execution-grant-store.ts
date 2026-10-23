import type { ServerLogger } from '../logger';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { KeyPairStore } from '../../credentials';
import { canonicalizeJson, type CanonicalJsonValue } from '../../shared/canonical-json';
import { StorageTimings } from './storage-timing';
import type { CreateExecutionGrantInput, ExecutionGrant, GrantAdmissionInput } from './types';
import {
  CURRENT_AGENT_OPERATION_CATEGORY,
  hasExactCurrentAgentOperations,
  isCurrentAgentOperation,
} from './types';

const SCHEMA_VERSION = 4;
const LEGACY_SCHEMA_VERSION_2 = 2;
const LEGACY_SCHEMA_VERSION_3 = 3;
const INTEGRITY_KEY_LENGTH = 32;
const DEFAULT_DIRECTORY = path.join(os.homedir(), '.heyhey-cli', 'authorization');

export interface ExecutionGrantStoreOptions {
  keyPairStore?: KeyPairStore;
  logger?: ServerLogger;
  filePath?: string;
  directory?: string;
  namespace?: string;
  integrityKey?: Buffer;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const isSha256Fingerprint = (value: unknown): value is string =>
  isString(value) && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);

const ACTION_CATEGORIES = new Set([
  'CONVERSATION',
  'PLATFORM_EVENT',
  'AUTHORITY_INCREASING_CONTROL',
  'TASK_MONITOR',
  'CLI_READ',
  'APPLICATION_EFFECT',
  'EXACT_ACTION',
]);
const CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS = new Map([
  ['FIVE_MINUTES', 5 * 60 * 1000],
  ['EIGHT_HOURS', 8 * 60 * 60 * 1000],
  ['ONE_DAY', 24 * 60 * 60 * 1000],
  ['ONE_WEEK', 7 * 24 * 60 * 60 * 1000],
  ['ONE_MONTH', 30 * 24 * 60 * 60 * 1000],
]);
const LEGACY_CONTROLLER_AUTHORIZATION_CADENCES = new Set([
  'EVERY_ACTION',
  'CURRENT_BROWSER_SESSION',
]);
type LegacyExecutionGrantV2 = Omit<ExecutionGrant, 'version' | 'allowedActionTypes'> & {
  version: 2;
};
type LegacyExecutionGrantV3 = Omit<LegacyExecutionGrantV2, 'version'> & {
  version: 3;
  target: {
    kind: string;
    id: string;
    revision: number | null;
  };
  agentSessionId: string | null;
};

const hasValidGrantBase = (value: Record<string, unknown>): boolean => {
  const categories = value['allowedActionCategories'];
  return (
    isString(value['grantId']) &&
    isString(value['namespace']) &&
    value['scope'] === 'controller_device_window' &&
    isString(value['controllerCredentialId']) &&
    isString(value['controllerInstallationId']) &&
    isString(value['machineId']) &&
    isString(value['userId']) &&
    isString(value['organizationId']) &&
    isString(value['cadence']) &&
    (CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.has(value['cadence']) ||
      LEGACY_CONTROLLER_AUTHORIZATION_CADENCES.has(value['cadence'])) &&
    isNumber(value['policyRevision']) &&
    value['policyRevision'] >= 1 &&
    Array.isArray(categories) &&
    categories.length > 0 &&
    categories.every((category) => isString(category) && ACTION_CATEGORIES.has(category)) &&
    isNumber(value['issuedAtMs']) &&
    isNumber(value['effectiveExpiresAtMs']) &&
    isString(value['descriptorHash']) &&
    /^[a-f0-9]{64}$/u.test(value['descriptorHash']) &&
    isSha256Fingerprint(value['controllerCredentialFingerprint']) &&
    isBoolean(value['suspended']) &&
    isBoolean(value['terminal']) &&
    isBoolean(value['revoked']) &&
    (value['lastUsedAtMs'] === null || isNumber(value['lastUsedAtMs']))
  );
};

const isLegacyGrantV2 = (value: unknown): value is LegacyExecutionGrantV2 =>
  isRecord(value) && value['version'] === LEGACY_SCHEMA_VERSION_2 && hasValidGrantBase(value);

const isLegacyGrantV3 = (value: unknown): value is LegacyExecutionGrantV3 =>
  isRecord(value) &&
  value['version'] === LEGACY_SCHEMA_VERSION_3 &&
  hasValidGrantBase(value) &&
  isRecord(value['target']) &&
  isString(value['target']['kind']) &&
  isString(value['target']['id']) &&
  (value['target']['revision'] === null || isNumber(value['target']['revision'])) &&
  (value['agentSessionId'] === null || isString(value['agentSessionId']));

const hasValidStoredCadenceLifetime = (value: Record<string, unknown>): boolean => {
  const cadence = value['cadence'];
  if (!isString(cadence)) return false;
  if (LEGACY_CONTROLLER_AUTHORIZATION_CADENCES.has(cadence)) return true;
  const ttlMs = CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.get(cadence);
  return (
    ttlMs !== undefined &&
    isNumber(value['issuedAtMs']) &&
    isNumber(value['effectiveExpiresAtMs']) &&
    value['effectiveExpiresAtMs'] - value['issuedAtMs'] === ttlMs
  );
};

// A stored grant may name an operation bundle from another CLI version. It is
// still integrity-checked, but only grants for the current bundle are active.
type StoredExecutionGrant = Omit<ExecutionGrant, 'allowedActionTypes'> & {
  allowedActionTypes: string[];
};

const isStoredGrant = (value: unknown): value is StoredExecutionGrant =>
  isRecord(value) &&
  value['version'] === SCHEMA_VERSION &&
  hasValidGrantBase(value) &&
  hasValidStoredCadenceLifetime(value) &&
  Array.isArray(value['allowedActionTypes']) &&
  value['allowedActionTypes'].every(isString);

const isCurrentGrant = (grant: StoredExecutionGrant): grant is ExecutionGrant =>
  CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.has(grant.cadence) &&
  hasExactCurrentAgentOperations(grant.allowedActionTypes);

const asCanonicalGrantBase = (
  grant: StoredExecutionGrant | LegacyExecutionGrantV2 | LegacyExecutionGrantV3,
) => ({
  version: grant.version,
  grantId: grant.grantId,
  namespace: grant.namespace,
  scope: grant.scope,
  controllerCredentialId: grant.controllerCredentialId,
  controllerInstallationId: grant.controllerInstallationId,
  machineId: grant.machineId,
  userId: grant.userId,
  organizationId: grant.organizationId,
  cadence: grant.cadence,
  policyRevision: grant.policyRevision,
  allowedActionCategories: [...grant.allowedActionCategories],
  issuedAtMs: grant.issuedAtMs,
  effectiveExpiresAtMs: grant.effectiveExpiresAtMs,
  descriptorHash: grant.descriptorHash,
  controllerCredentialFingerprint: grant.controllerCredentialFingerprint,
  suspended: grant.suspended,
  terminal: grant.terminal,
  revoked: grant.revoked,
  lastUsedAtMs: grant.lastUsedAtMs,
});

const asCanonicalGrant = (grant: StoredExecutionGrant): CanonicalJsonValue => ({
  ...asCanonicalGrantBase(grant),
  allowedActionTypes: [...grant.allowedActionTypes],
});

const asCanonicalLegacyGrantV3 = (grant: LegacyExecutionGrantV3): CanonicalJsonValue => ({
  ...asCanonicalGrantBase(grant),
  target: {
    kind: grant.target.kind,
    id: grant.target.id,
    revision: grant.target.revision,
  },
  agentSessionId: grant.agentSessionId,
});

const asCanonicalFile = (
  schemaVersion: 4,
  namespace: string,
  grants: readonly StoredExecutionGrant[],
): CanonicalJsonValue => ({
  schemaVersion,
  namespace,
  grants: grants.map(asCanonicalGrant),
});

const asCanonicalLegacyFileV2 = (
  namespace: string,
  grants: readonly LegacyExecutionGrantV2[],
): CanonicalJsonValue => ({
  schemaVersion: LEGACY_SCHEMA_VERSION_2,
  namespace,
  grants: grants.map(asCanonicalGrantBase),
});

const asCanonicalLegacyFileV3 = (
  namespace: string,
  grants: readonly LegacyExecutionGrantV3[],
): CanonicalJsonValue => ({
  schemaVersion: LEGACY_SCHEMA_VERSION_3,
  namespace,
  grants: grants.map(asCanonicalLegacyGrantV3),
});

const encodeNamespace = (namespace: string): string =>
  Buffer.from(namespace || 'default', 'utf8').toString('base64url');

/** Owns the only durable path for bounded local execution grants. */
export class ExecutionGrantStore {
  private static readonly locks = new Map<string, Promise<void>>();
  private readonly filePath: string;
  private readonly namespace: string;
  private readonly keyPairStore: KeyPairStore | undefined;
  private readonly suppliedIntegrityKey: Buffer | undefined;
  private readonly now: () => number;
  private readonly logger: ServerLogger | undefined;

  public constructor(options: ExecutionGrantStoreOptions) {
    this.keyPairStore = options.keyPairStore;
    this.logger = options.logger;
    this.suppliedIntegrityKey = options.integrityKey
      ? Buffer.from(options.integrityKey)
      : undefined;
    this.namespace = options.namespace ?? options.keyPairStore?.getAccountNamespace() ?? 'default';
    this.filePath =
      options.filePath ??
      path.join(
        options.directory ?? process.env['HEYHEY_AUTHORIZATION_DIR'] ?? DEFAULT_DIRECTORY,
        `${encodeNamespace(this.namespace)}.grants.json`,
      );
    this.now = options.now ?? (() => Date.now());
  }

  public get path(): string {
    return this.filePath;
  }

  private async withLock<T>(
    operation: (timings: StorageTimings) => Promise<T>,
    logger = this.logger,
  ): Promise<T> {
    const timings = new StorageTimings();
    const started = performance.now();
    logger?.debug('trigger-admission.execution-grant-store.lock_wait.started');
    const previous = ExecutionGrantStore.locks.get(this.filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    ExecutionGrantStore.locks.set(this.filePath, current);
    await previous;
    const acquired = performance.now();
    const lockWaitMs = acquired - started;
    logger?.debug('trigger-admission.execution-grant-store.storage.started', { lockWaitMs });
    try {
      const result = await operation(timings);
      logger?.debug('trigger-admission.execution-grant-store.storage.completed', {
        lockWaitMs,
        storageMs: performance.now() - acquired,
        ...timings.fields(),
      });
      return result;
    } catch (error) {
      logger?.debug('trigger-admission.execution-grant-store.storage.failed', {
        lockWaitMs,
        storageMs: performance.now() - acquired,
        ...timings.fields(),
      });
      throw error;
    } finally {
      release();
      if (ExecutionGrantStore.locks.get(this.filePath) === current) {
        ExecutionGrantStore.locks.delete(this.filePath);
      }
    }
  }

  private integrityKey(timings: StorageTimings): Promise<Buffer> {
    return timings.measure('integrityKey', async () => {
      if (this.suppliedIntegrityKey) {
        if (this.suppliedIntegrityKey.length !== INTEGRITY_KEY_LENGTH) {
          throw new Error('Execution grant integrity key has an invalid length.');
        }
        timings.noteIntegrityKey({ source: 'supplied' });
        return Buffer.from(this.suppliedIntegrityKey);
      }
      if (!this.keyPairStore) throw new Error('Execution grant protected storage is unavailable.');
      return this.keyPairStore.getAuthorizationStateIntegrityKey((timing) =>
        timings.noteIntegrityKey(timing),
      );
    });
  }

  private async readUnlocked(timings: StorageTimings): Promise<ExecutionGrant[]> {
    const integrityKey = await this.integrityKey(timings);
    let serialized: string;
    try {
      serialized = await timings.measure('fileRead', () => fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return [];
      throw new Error('Execution grant storage is unavailable.', { cause: error });
    }
    const grants = await timings.measure('validation', () =>
      this.validateSerialized(serialized, integrityKey),
    );
    timings.noteRecordCount(grants.length);
    const currentGrants = grants.filter(isCurrentGrant);
    if (currentGrants.length !== grants.length) {
      await this.writeUnlocked(currentGrants, timings);
    }
    return currentGrants;
  }

  private validateSerialized(serialized: string, integrityKey: Buffer): StoredExecutionGrant[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch (error) {
      throw new Error('Execution grant storage is corrupt.', { cause: error });
    }
    if (!isRecord(parsed) || parsed['namespace'] !== this.namespace) {
      throw new Error('Execution grant storage has an invalid closed schema.');
    }
    const grants = parsed['grants'];
    const integrity = parsed['integrity'];
    if (parsed['schemaVersion'] === LEGACY_SCHEMA_VERSION_2) {
      if (!Array.isArray(grants) || !grants.every(isLegacyGrantV2) || !isString(integrity)) {
        throw new Error('Execution grant storage has an invalid closed schema.');
      }
      const expected = createHmac('sha256', integrityKey)
        .update(canonicalizeJson(asCanonicalLegacyFileV2(this.namespace, grants)))
        .digest('hex');
      const actual = Buffer.from(integrity, 'hex');
      const expectedBytes = Buffer.from(expected, 'hex');
      if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
        throw new Error('Execution grant storage integrity verification failed.');
      }
      return [];
    }
    if (parsed['schemaVersion'] === LEGACY_SCHEMA_VERSION_3) {
      if (!Array.isArray(grants) || !grants.every(isLegacyGrantV3) || !isString(integrity)) {
        throw new Error('Execution grant storage has an invalid closed schema.');
      }
      const expected = createHmac('sha256', integrityKey)
        .update(canonicalizeJson(asCanonicalLegacyFileV3(this.namespace, grants)))
        .digest('hex');
      const actual = Buffer.from(integrity, 'hex');
      const expectedBytes = Buffer.from(expected, 'hex');
      if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
        throw new Error('Execution grant storage integrity verification failed.');
      }
      // Target-fragmented version 3 grants did not persist the exact generated
      // operation bundle and therefore cannot be widened safely.
      return [];
    }
    if (parsed['schemaVersion'] !== SCHEMA_VERSION) {
      throw new Error('Execution grant storage has an invalid closed schema.');
    }
    if (!Array.isArray(grants) || !grants.every(isStoredGrant) || !isString(integrity)) {
      throw new Error('Execution grant storage has an invalid closed schema.');
    }
    const expected = createHmac('sha256', integrityKey)
      .update(canonicalizeJson(asCanonicalFile(4, this.namespace, grants)))
      .digest('hex');
    const actual = Buffer.from(integrity, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
      throw new Error('Execution grant storage integrity verification failed.');
    }
    return grants;
  }

  private async writeUnlocked(grants: ExecutionGrant[], timings: StorageTimings): Promise<void> {
    const integrityKey = await this.integrityKey(timings);
    const serialized = await timings.measure('serialize', () => {
      const integrity = createHmac('sha256', integrityKey)
        .update(canonicalizeJson(asCanonicalFile(4, this.namespace, grants)))
        .digest('hex');
      const envelope: CanonicalJsonValue = {
        schemaVersion: 4,
        namespace: this.namespace,
        grants: grants.map(asCanonicalGrant),
        integrity,
      };
      return `${canonicalizeJson(envelope)}\n`;
    });
    await timings.measure('persist', () => this.persistUnlocked(serialized));
  }

  private async persistUnlocked(serialized: string): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomBytes(8).toString('hex')}.tmp`,
    );
    try {
      await fs.writeFile(temporaryPath, serialized, { mode: 0o600 });
      const handle = await fs.open(temporaryPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      try {
        await fs.unlink(temporaryPath);
      } catch {
        // Preserve the write failure; a stale temp file is harmless and does
        // not participate in the authenticated state.
      }
      throw new Error('Execution grant storage write failed.', { cause: error });
    }
  }

  public async list(): Promise<ExecutionGrant[]> {
    return this.withLock(async (timings) =>
      (await this.readUnlocked(timings)).map((grant) => ({
        ...grant,
        allowedActionTypes: [...grant.allowedActionTypes],
        allowedActionCategories: [...grant.allowedActionCategories],
      })),
    );
  }

  public async get(grantId: string): Promise<ExecutionGrant | null> {
    return this.withLock(async (timings) => {
      const grant = (await this.readUnlocked(timings)).find(
        (candidate) => candidate.grantId === grantId,
      );
      return grant
        ? {
            ...grant,
            allowedActionTypes: [...grant.allowedActionTypes],
            allowedActionCategories: [...grant.allowedActionCategories],
          }
        : null;
    });
  }

  public async create(
    input: CreateExecutionGrantInput,
    logger?: ServerLogger,
  ): Promise<ExecutionGrant> {
    return this.withLock(async (timings) => {
      const now = this.now();
      const descriptor = input.descriptor;
      const cadenceTtlMs = CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.get(descriptor.cadence);
      if (cadenceTtlMs === undefined)
        throw new Error('Removed controller authorization cadence cannot be persisted.');
      if (
        !Number.isSafeInteger(descriptor.effectiveExpiresAtMs) ||
        descriptor.effectiveExpiresAtMs <= now ||
        descriptor.effectiveExpiresAtMs - descriptor.issuedAtMs !== cadenceTtlMs
      )
        throw new Error('Grant expiry is invalid.');
      if (!Number.isSafeInteger(descriptor.issuedAtMs) || descriptor.issuedAtMs > now)
        throw new Error('Grant issue time is invalid.');
      if (!/^[a-f0-9]{64}$/u.test(input.descriptorHash))
        throw new Error('Grant descriptor hash is invalid.');
      if (!isSha256Fingerprint(input.controllerCredentialFingerprint))
        throw new Error('Grant fingerprint is invalid.');
      if (!descriptor.controllerCredentialId || !descriptor.controllerInstallationId) {
        throw new Error('Grant controller identities are invalid.');
      }
      const categories = [...new Set(descriptor.allowedActionCategories)];
      const allowedActionTypes = [...descriptor.allowedActionTypes];
      if (
        categories.length === 0 ||
        categories.some((category) => !ACTION_CATEGORIES.has(category))
      ) {
        throw new Error('Grant action-category allowlist is invalid.');
      }
      if (!hasExactCurrentAgentOperations(allowedActionTypes)) {
        throw new Error('Grant action-type allowlist is invalid.');
      }
      const grants = await this.readUnlocked(timings);
      const grant: ExecutionGrant = {
        version: 4,
        grantId: input.grantId,
        namespace: this.namespace,
        scope: descriptor.scope,
        controllerCredentialId: descriptor.controllerCredentialId,
        controllerInstallationId: descriptor.controllerInstallationId,
        machineId: descriptor.machineId,
        userId: descriptor.userId,
        organizationId: descriptor.organizationId,
        cadence: descriptor.cadence,
        policyRevision: descriptor.policyRevision,
        allowedActionTypes,
        allowedActionCategories: categories,
        issuedAtMs: descriptor.issuedAtMs,
        effectiveExpiresAtMs: descriptor.effectiveExpiresAtMs,
        descriptorHash: input.descriptorHash,
        controllerCredentialFingerprint: input.controllerCredentialFingerprint,
        suspended: false,
        terminal: false,
        revoked: false,
        lastUsedAtMs: null,
      };
      if (grants.some((candidate) => candidate.grantId === grant.grantId))
        throw new Error('Grant already exists.');
      grants.push(grant);
      await this.writeUnlocked(grants, timings);
      return {
        ...grant,
        allowedActionTypes: [...grant.allowedActionTypes],
        allowedActionCategories: [...grant.allowedActionCategories],
      };
    }, logger);
  }

  public async admit(input: GrantAdmissionInput, logger?: ServerLogger): Promise<ExecutionGrant> {
    return this.withLock(async (timings) => {
      const grants = await this.readUnlocked(timings);
      const index = grants.findIndex((candidate) => candidate.grantId === input.grantId);
      const current = index >= 0 ? grants[index] : undefined;
      if (!current) throw new Error('GRANT_NOT_ACTIVE');
      if (
        current.namespace !== this.namespace ||
        current.revoked ||
        current.suspended ||
        current.terminal ||
        current.effectiveExpiresAtMs <= this.now()
      ) {
        throw new Error('GRANT_NOT_ACTIVE');
      }
      if (
        current.machineId !== input.machineId ||
        current.userId !== input.userId ||
        current.organizationId !== input.organizationId ||
        !isCurrentAgentOperation(input.actionType) ||
        !current.allowedActionTypes.includes(input.actionType) ||
        CURRENT_AGENT_OPERATION_CATEGORY[input.actionType] !== input.actionCategory ||
        !current.allowedActionCategories.includes(input.actionCategory) ||
        !hasExactCurrentAgentOperations(current.allowedActionTypes)
      ) {
        throw new Error('GRANT_SCOPE_MISMATCH');
      }
      const updated: ExecutionGrant = { ...current, lastUsedAtMs: this.now() };
      grants[index] = updated;
      await this.writeUnlocked(grants, timings);
      return {
        ...updated,
        allowedActionTypes: [...updated.allowedActionTypes],
        allowedActionCategories: [...updated.allowedActionCategories],
      };
    }, logger);
  }

  private async transition(
    grantId: string,
    transition: 'suspend' | 'resume' | 'terminal' | 'revoke',
  ): Promise<void> {
    await this.withLock(async (timings) => {
      const grants = await this.readUnlocked(timings);
      const index = grants.findIndex((grant) => grant.grantId === grantId);
      if (index < 0) throw new Error('Grant not found.');
      const current = grants[index];
      if (!current) throw new Error('Grant not found.');
      if (transition === 'resume' && (current.revoked || current.terminal)) {
        throw new Error('Grant lifecycle cannot widen after terminal or revocation.');
      }
      if (transition === 'terminal' && current.revoked) {
        throw new Error('Revoked grants cannot become terminal.');
      }
      const next: ExecutionGrant =
        transition === 'suspend'
          ? { ...current, suspended: true }
          : transition === 'resume'
            ? { ...current, suspended: false }
            : transition === 'terminal'
              ? { ...current, terminal: true, suspended: true }
              : { ...current, revoked: true, suspended: true };
      grants[index] = next;
      await this.writeUnlocked(grants, timings);
    });
  }

  public suspend(grantId: string): Promise<void> {
    return this.transition(grantId, 'suspend');
  }
  public resume(grantId: string): Promise<void> {
    return this.transition(grantId, 'resume');
  }
  public markTerminal(grantId: string): Promise<void> {
    return this.transition(grantId, 'terminal');
  }
  public revoke(grantId: string): Promise<void> {
    return this.transition(grantId, 'revoke');
  }

  /** Revoke grants derived from one controller; repeated reductions are safe. */
  public async revokeForController(
    controllerCredentialId: string,
    controllerCredentialFingerprint?: string,
  ): Promise<number> {
    return this.withLock(async (timings) => {
      const grants = await this.readUnlocked(timings);
      let changed = 0;
      const next = grants.map((grant) => {
        const matches =
          grant.controllerCredentialId === controllerCredentialId ||
          (controllerCredentialFingerprint !== undefined &&
            grant.controllerCredentialFingerprint === controllerCredentialFingerprint);
        if (!matches || grant.revoked) return grant;
        changed += 1;
        return { ...grant, revoked: true, suspended: true };
      });
      if (changed > 0) await this.writeUnlocked(next, timings);
      return changed;
    });
  }

  /** Terminally remove every executable grant after machine revocation. */
  public async revokeAll(): Promise<number> {
    return this.withLock(async (timings) => {
      const grants = await this.readUnlocked(timings);
      let changed = 0;
      const next = grants.map((grant) => {
        if (grant.revoked) return grant;
        changed += 1;
        return { ...grant, revoked: true, suspended: true };
      });
      if (changed > 0) await this.writeUnlocked(next, timings);
      return changed;
    });
  }
}
