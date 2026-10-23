import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type {
  ControllerCredentialPublicKey,
  ControllerCredentialSummaryDto,
  MachineEnrollmentActivatedBindingDto,
} from '../shared/api/index';
import { KeyPairStore } from './keypair';
import { canonicalizeJson, type CanonicalJsonValue } from '../shared/canonical-json';

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_FILE_ENV = 'HEYHEY_CONTROLLER_REGISTRY_DIR';
const DEFAULT_REGISTRY_DIRECTORY = path.join(os.homedir(), '.heyhey-cli', 'controllers');
const INTEGRITY_KEY_LENGTH = 32;

const controllerRegistryEntrySchema = z
  .object({
    enrollmentId: z.string(),
    machineId: z.string(),
    machineName: z.string(),
    osFamily: z.enum(['macos', 'windows', 'linux']),
    cliVersion: z.string(),
    authorizationProtocolVersion: z.literal(2),
    accountId: z.string(),
    organizationId: z.string(),
    controllerLabel: z.string(),
    controllerCredentialId: z.string(),
    controllerCredentialPublicKey: z
      .object({
        kty: z.literal('EC'),
        crv: z.literal('P-256'),
        x: z
          .string()
          .length(43)
          .regex(/^[A-Za-z0-9_-]+$/u),
        y: z
          .string()
          .length(43)
          .regex(/^[A-Za-z0-9_-]+$/u),
      })
      .strict(),
    controllerCredentialFingerprint: z.string(),
    backupEligible: z.boolean(),
    backupState: z.boolean(),
    enrolledAt: z.string(),
  })
  .strict();
const controllerRegistryContentsSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SCHEMA_VERSION),
    controllers: z.array(controllerRegistryEntrySchema),
  })
  .strict();
const controllerRegistryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SCHEMA_VERSION),
    contents: controllerRegistryContentsSchema,
    integrity: z.string(),
  })
  .strict();

export interface ControllerRegistryEntry extends MachineEnrollmentActivatedBindingDto {
  authorizationProtocolVersion: 2;
  enrolledAt: string;
}

export interface ControllerRegistryContents {
  schemaVersion: 1;
  controllers: ControllerRegistryEntry[];
}

interface ControllerRegistryEnvelope {
  schemaVersion: 1;
  contents: ControllerRegistryContents;
  integrity: string;
}

export interface ControllerRegistryStoreOptions {
  keyPairStore: KeyPairStore;
  /** Explicit file path used by tests and by callers with an app-data root. */
  filePath?: string;
  /** Directory under which the backend/profile namespace is encoded. */
  directory?: string;
  namespaceOverride?: string;
}

const isRecord = (
  value: object | null | CanonicalJsonValue,
): value is Record<string, CanonicalJsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, CanonicalJsonValue>,
  keys: readonly string[],
): boolean => Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');

const isString = (value: CanonicalJsonValue | undefined): value is string =>
  typeof value === 'string';

const isBoolean = (value: CanonicalJsonValue | undefined): value is boolean =>
  typeof value === 'boolean';

const isControllerCredentialPublicKey = (
  value: CanonicalJsonValue | undefined,
): value is ControllerCredentialPublicKey & CanonicalJsonValue => {
  if (value === undefined || !isRecord(value) || !hasExactKeys(value, ['kty', 'crv', 'x', 'y'])) {
    return false;
  }
  return (
    value['kty'] === 'EC' &&
    value['crv'] === 'P-256' &&
    isString(value['x']) &&
    /^[A-Za-z0-9_-]{43}$/u.test(value['x']) &&
    isString(value['y']) &&
    /^[A-Za-z0-9_-]{43}$/u.test(value['y'])
  );
};

const isControllerRegistryEntry = (value: object | null): value is ControllerRegistryEntry => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      'enrollmentId',
      'machineId',
      'machineName',
      'osFamily',
      'cliVersion',
      'authorizationProtocolVersion',
      'accountId',
      'organizationId',
      'controllerLabel',
      'controllerCredentialId',
      'controllerCredentialPublicKey',
      'controllerCredentialFingerprint',
      'backupEligible',
      'backupState',
      'enrolledAt',
    ])
  ) {
    return false;
  }

  return (
    isString(value['enrollmentId']) &&
    isString(value['machineId']) &&
    isString(value['machineName']) &&
    isString(value['osFamily']) &&
    isString(value['cliVersion']) &&
    value['authorizationProtocolVersion'] === 2 &&
    isString(value['accountId']) &&
    isString(value['organizationId']) &&
    isString(value['controllerLabel']) &&
    isString(value['controllerCredentialId']) &&
    isControllerCredentialPublicKey(value['controllerCredentialPublicKey']) &&
    isString(value['controllerCredentialFingerprint']) &&
    isBoolean(value['backupEligible']) &&
    isBoolean(value['backupState']) &&
    isString(value['enrolledAt'])
  );
};

const isControllerRegistryContents = (
  value: object | null,
): value is ControllerRegistryContents => {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'controllers'])) return false;
  const version = value['schemaVersion'];
  const controllers = value['controllers'];
  return (
    version === REGISTRY_SCHEMA_VERSION &&
    Array.isArray(controllers) &&
    controllers.every((controller) => isRecord(controller) && isControllerRegistryEntry(controller))
  );
};

const asCanonicalContents = (contents: ControllerRegistryContents): CanonicalJsonValue => ({
  schemaVersion: contents.schemaVersion,
  controllers: contents.controllers.map((entry) => ({
    enrollmentId: entry.enrollmentId,
    machineId: entry.machineId,
    machineName: entry.machineName,
    osFamily: entry.osFamily,
    cliVersion: entry.cliVersion,
    authorizationProtocolVersion: entry.authorizationProtocolVersion,
    accountId: entry.accountId,
    organizationId: entry.organizationId,
    controllerLabel: entry.controllerLabel,
    controllerCredentialId: entry.controllerCredentialId,
    controllerCredentialPublicKey: {
      kty: entry.controllerCredentialPublicKey.kty,
      crv: entry.controllerCredentialPublicKey.crv,
      x: entry.controllerCredentialPublicKey.x,
      y: entry.controllerCredentialPublicKey.y,
    },
    controllerCredentialFingerprint: entry.controllerCredentialFingerprint,
    backupEligible: entry.backupEligible,
    backupState: entry.backupState,
    enrolledAt: entry.enrolledAt,
  })),
});

const asCanonicalEnvelope = (envelope: ControllerRegistryEnvelope): CanonicalJsonValue => ({
  schemaVersion: envelope.schemaVersion,
  contents: asCanonicalContents(envelope.contents),
  integrity: envelope.integrity,
});

const encodeNamespace = (namespace: string): string =>
  Buffer.from(namespace || 'default', 'utf8').toString('base64url');

/**
 * Durable, integrity-protected controller metadata. The registry is not a
 * credential store: its HMAC key is. This keeps public controller metadata
 * inspectable while making tampering fail closed after a process restart.
 */
export class ControllerRegistryStore {
  private static readonly writeLocks = new Map<string, Promise<void>>();

  private readonly keyPairStore: KeyPairStore;
  private readonly filePath: string;

  public constructor(options: ControllerRegistryStoreOptions) {
    this.keyPairStore = options.keyPairStore;
    const namespace = options.namespaceOverride ?? options.keyPairStore.getAccountNamespace();
    this.filePath =
      options.filePath ??
      path.join(
        options.directory ?? process.env[REGISTRY_FILE_ENV] ?? DEFAULT_REGISTRY_DIRECTORY,
        `${encodeNamespace(namespace)}.json`,
      );
  }

  public get path(): string {
    return this.filePath;
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = ControllerRegistryStore.writeLocks.get(this.filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    ControllerRegistryStore.writeLocks.set(this.filePath, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (ControllerRegistryStore.writeLocks.get(this.filePath) === current) {
        ControllerRegistryStore.writeLocks.delete(this.filePath);
      }
    }
  }

  private async loadIntegrityKey(): Promise<Buffer> {
    const stored = await this.keyPairStore.loadControllerRegistryIntegrityKey();
    if (stored === null) {
      throw new Error('Controller registry integrity key is not available.');
    }
    const key = Buffer.from(stored, 'base64');
    if (key.length !== INTEGRITY_KEY_LENGTH) {
      throw new Error('Controller registry integrity key has an invalid length.');
    }
    return key;
  }

  private async ensureIntegrityKey(): Promise<Buffer> {
    const existing = await this.keyPairStore.loadControllerRegistryIntegrityKey();
    if (existing !== null) return this.loadIntegrityKey();

    const key = randomBytes(INTEGRITY_KEY_LENGTH);
    await this.keyPairStore.storeControllerRegistryIntegrityKey(key.toString('base64'));
    return key;
  }

  private async readUnlocked(): Promise<ControllerRegistryContents | null> {
    let serialized: string;
    try {
      serialized = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }

    let parsedResult: ReturnType<typeof controllerRegistryEnvelopeSchema.safeParse>;
    try {
      parsedResult = controllerRegistryEnvelopeSchema.safeParse(JSON.parse(serialized));
    } catch (error) {
      throw new Error('Controller registry is not valid JSON.', { cause: error });
    }
    if (!parsedResult.success) {
      throw new Error('Controller registry has an invalid closed schema.');
    }
    const parsed = parsedResult.data;

    const key = await this.loadIntegrityKey();
    const expected = createHmac('sha256', key)
      .update(canonicalizeJson(asCanonicalContents(parsed.contents)))
      .digest('hex');
    const actual = Buffer.from(parsed.integrity, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
      throw new Error('Controller registry integrity verification failed.');
    }
    return parsed.contents;
  }

  public async read(): Promise<ControllerRegistryContents | null> {
    return this.withWriteLock(() => this.readUnlocked());
  }

  public async write(contents: ControllerRegistryContents): Promise<void> {
    const canonicalContents = asCanonicalContents(contents);
    if (!isRecord(canonicalContents) || !isControllerRegistryContents(canonicalContents)) {
      throw new Error('Controller registry contents have an invalid closed schema.');
    }
    await this.withWriteLock(() => this.writeUnlocked(contents));
  }

  public async replace(contents: ControllerRegistryContents): Promise<void> {
    return this.write(contents);
  }

  public async upsert(entry: ControllerRegistryEntry): Promise<void> {
    await this.withWriteLock(async () => {
      const current = await this.readUnlocked();
      const contents: ControllerRegistryContents = current ?? {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        controllers: [],
      };
      const controllers = contents.controllers.filter(
        (candidate) =>
          !(
            candidate.machineId === entry.machineId &&
            candidate.controllerCredentialId === entry.controllerCredentialId
          ),
      );
      controllers.push(entry);
      await this.writeUnlocked({ schemaVersion: REGISTRY_SCHEMA_VERSION, controllers });
    });
  }

  /** Remove one controller while retaining every other controller on the machine. */
  public async remove(machineId: string, controllerCredentialId: string): Promise<boolean> {
    return this.withWriteLock(async () => {
      const current = await this.readUnlocked();
      if (!current) return false;
      const controllers = current.controllers.filter(
        (candidate) =>
          !(
            candidate.machineId === machineId &&
            candidate.controllerCredentialId === controllerCredentialId
          ),
      );
      if (controllers.length === current.controllers.length) return false;
      await this.writeUnlocked({ schemaVersion: REGISTRY_SCHEMA_VERSION, controllers });
      return true;
    });
  }

  /** Remove every controller for one machine after the server has revoked it. */
  public async removeMachine(machineId: string): Promise<void> {
    await this.withWriteLock(async () => {
      const current = await this.readUnlocked();
      if (!current) return;
      const controllers = current.controllers.filter(
        (candidate) => candidate.machineId !== machineId,
      );
      if (controllers.length !== current.controllers.length) {
        await this.writeUnlocked({ schemaVersion: REGISTRY_SCHEMA_VERSION, controllers });
      }
    });
  }

  /**
   * Apply the server's closed controller snapshot without inventing local
   * metadata. Unknown server controllers are returned for diagnostics, but
   * the server's disclosure-only inventory never widens the local authority
   * allowlist.
   */
  public async reconcileMachine(
    machineId: string,
    serverControllers: readonly ControllerCredentialSummaryDto[],
    revokedControllerCredentialIds: ReadonlySet<string> = new Set(),
  ): Promise<{ unknownServerControllerIds: string[] }> {
    return this.withWriteLock(async () => {
      const current = await this.readUnlocked();
      if (!current) {
        return {
          unknownServerControllerIds: serverControllers
            .filter((controller) => controller.revocationState === 'ACTIVE')
            .map((controller) => controller.credentialId),
        };
      }

      const activeServerIds = new Set(
        serverControllers
          .filter((controller) => controller.revocationState === 'ACTIVE')
          .map((controller) => controller.credentialId),
      );
      const localMachineEntries = current.controllers.filter(
        (candidate) => candidate.machineId === machineId,
      );
      const unknownServerControllerIds = serverControllers
        .filter(
          (controller) =>
            controller.revocationState === 'ACTIVE' &&
            !localMachineEntries.some(
              (entry) => entry.controllerCredentialId === controller.credentialId,
            ),
        )
        .map((controller) => controller.credentialId);

      let changed = false;
      const controllers = current.controllers
        .filter((entry) => {
          const keep =
            entry.machineId !== machineId ||
            (activeServerIds.has(entry.controllerCredentialId) &&
              !revokedControllerCredentialIds.has(entry.controllerCredentialId));
          if (!keep) changed = true;
          return keep;
        })
        .map((entry) => {
          if (entry.machineId !== machineId) return entry;
          const server = serverControllers.find(
            (controller) => controller.credentialId === entry.controllerCredentialId,
          );
          if (!server) return entry;
          if (
            entry.controllerLabel !== server.label ||
            entry.backupEligible !== server.backupEligible ||
            entry.backupState !== server.backupState ||
            entry.controllerCredentialPublicKey.kty !== server.controllerCredentialPublicKey.kty ||
            entry.controllerCredentialPublicKey.crv !== server.controllerCredentialPublicKey.crv ||
            entry.controllerCredentialPublicKey.x !== server.controllerCredentialPublicKey.x ||
            entry.controllerCredentialPublicKey.y !== server.controllerCredentialPublicKey.y
          ) {
            changed = true;
          }
          return {
            ...entry,
            controllerLabel: server.label,
            controllerCredentialPublicKey: server.controllerCredentialPublicKey,
            backupEligible: server.backupEligible,
            backupState: server.backupState,
          };
        });

      if (controllers.length !== current.controllers.length) changed = true;
      if (changed) {
        await this.writeUnlocked({ schemaVersion: REGISTRY_SCHEMA_VERSION, controllers });
      }
      return { unknownServerControllerIds };
    });
  }

  private async writeUnlocked(contents: ControllerRegistryContents): Promise<void> {
    const key = await this.ensureIntegrityKey();
    const envelope: ControllerRegistryEnvelope = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      contents,
      integrity: createHmac('sha256', key)
        .update(canonicalizeJson(asCanonicalContents(contents)))
        .digest('hex'),
    };
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomBytes(8).toString('hex')}.tmp`,
    );
    try {
      await fs.writeFile(temporaryPath, `${canonicalizeJson(asCanonicalEnvelope(envelope))}\n`, {
        mode: 0o600,
      });
      await fs.chmod(temporaryPath, 0o600);
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
      } catch (cleanupError) {
        if (
          !(
            cleanupError instanceof Error &&
            'code' in cleanupError &&
            cleanupError.code === 'ENOENT'
          )
        ) {
          throw cleanupError;
        }
      }
      throw error;
    }
  }
}
