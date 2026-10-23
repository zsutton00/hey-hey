import type { ServerLogger } from '../logger';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { KeyPairStore } from '../../credentials';
import { StorageTimings } from './storage-timing';
import { canonicalizeJson, type CanonicalJsonValue } from '../../shared/canonical-json';
import type { ReplayRecord } from './types';

export const AUTHORIZATION_REPLAY_RETENTION_MS = 10 * 60 * 1000;
const SCHEMA_VERSION = 1;
const INTEGRITY_KEY_LENGTH = 32;
const DEFAULT_DIRECTORY = path.join(os.homedir(), '.heyhey-cli', 'authorization');

export interface AuthorizationReplayStoreOptions {
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

const isRecordEntry = (value: unknown): value is ReplayRecord =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  value['id'].length > 0 &&
  typeof value['expiresAtMs'] === 'number' &&
  Number.isSafeInteger(value['expiresAtMs']);

const asCanonical = (
  schemaVersion: 1,
  namespace: string,
  records: readonly ReplayRecord[],
): CanonicalJsonValue => ({
  schemaVersion,
  namespace,
  records: records.map((record) => ({ id: record.id, expiresAtMs: record.expiresAtMs })),
});

const encodeNamespace = (namespace: string): string =>
  Buffer.from(namespace || 'default', 'utf8').toString('base64url');

/** Retains consumed authorization identities across process restarts. */
export class AuthorizationReplayStore {
  private static readonly locks = new Map<string, Promise<void>>();
  private readonly filePath: string;
  private readonly namespace: string;
  private readonly keyPairStore: KeyPairStore | undefined;
  private readonly suppliedIntegrityKey: Buffer | undefined;
  private readonly now: () => number;
  private readonly logger: ServerLogger | undefined;

  public constructor(options: AuthorizationReplayStoreOptions) {
    this.keyPairStore = options.keyPairStore;
    this.logger = options.logger;
    this.suppliedIntegrityKey = options.integrityKey ? Buffer.from(options.integrityKey) : undefined;
    this.namespace = options.namespace ?? options.keyPairStore?.getAccountNamespace() ?? 'default';
    this.filePath =
      options.filePath ??
      path.join(
        options.directory ?? process.env['HEYHEY_AUTHORIZATION_DIR'] ?? DEFAULT_DIRECTORY,
        `${encodeNamespace(this.namespace)}.replay.json`,
      );
    this.now = options.now ?? (() => Date.now());
  }

  public get path(): string { return this.filePath; }

  private async withLock<T>(operation: (timings: StorageTimings) => Promise<T>, logger = this.logger): Promise<T> {
    const timings = new StorageTimings();
    const started = performance.now();
    logger?.debug("trigger-admission.authorization-replay-store.lock_wait.started");
    const previous = AuthorizationReplayStore.locks.get(this.filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    AuthorizationReplayStore.locks.set(this.filePath, current);
    await previous;
    const acquired = performance.now();
    const lockWaitMs = acquired - started;
    logger?.debug("trigger-admission.authorization-replay-store.storage.started", { lockWaitMs });
    try {
      const result = await operation(timings);
      logger?.debug("trigger-admission.authorization-replay-store.storage.completed", {
        lockWaitMs, storageMs: performance.now() - acquired, ...timings.fields(),
      });
      return result;
    } catch (error) {
      logger?.debug("trigger-admission.authorization-replay-store.storage.failed", {
        lockWaitMs, storageMs: performance.now() - acquired, ...timings.fields(),
      });
      throw error;
    } finally {
      release();
      if (AuthorizationReplayStore.locks.get(this.filePath) === current) {
        AuthorizationReplayStore.locks.delete(this.filePath);
      }
    }
  }

  private integrityKey(timings: StorageTimings): Promise<Buffer> {
    return timings.measure('integrityKey', async () => {
      if (this.suppliedIntegrityKey) {
        if (this.suppliedIntegrityKey.length !== INTEGRITY_KEY_LENGTH) throw new Error('Authorization replay integrity key has an invalid length.');
        timings.noteIntegrityKey({ source: 'supplied' });
        return Buffer.from(this.suppliedIntegrityKey);
      }
      if (!this.keyPairStore) throw new Error('Authorization replay protected storage is unavailable.');
      return this.keyPairStore.getAuthorizationStateIntegrityKey((timing) => timings.noteIntegrityKey(timing));
    });
  }

  private async readUnlocked(timings: StorageTimings): Promise<ReplayRecord[]> {
    const integrityKey = await this.integrityKey(timings);
    let serialized: string;
    try {
      serialized = await timings.measure('fileRead', () => fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return [];
      throw new Error('Authorization replay storage is unavailable.', { cause: error });
    }
    const records = await timings.measure('validation', () => this.validateSerialized(serialized, integrityKey));
    timings.noteRecordCount(records.length);
    return records;
  }

  private validateSerialized(serialized: string, integrityKey: Buffer): ReplayRecord[] {
    let parsed: unknown;
    try { parsed = JSON.parse(serialized) as unknown; } catch (error) {
      throw new Error('Authorization replay storage is corrupt.', { cause: error });
    }
    if (!isRecord(parsed) || parsed['schemaVersion'] !== SCHEMA_VERSION || parsed['namespace'] !== this.namespace) {
      throw new Error('Authorization replay storage has an invalid closed schema.');
    }
    const records = parsed['records'];
    const integrity = parsed['integrity'];
    if (!Array.isArray(records) || !records.every(isRecordEntry) || typeof integrity !== 'string') {
      throw new Error('Authorization replay storage has an invalid closed schema.');
    }
    const expected = createHmac('sha256', integrityKey)
      .update(canonicalizeJson(asCanonical(1, this.namespace, records)))
      .digest('hex');
    const actual = Buffer.from(integrity, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
      throw new Error('Authorization replay storage integrity verification failed.');
    }
    return records;
  }

  private async writeUnlocked(records: ReplayRecord[], timings: StorageTimings): Promise<void> {
    const integrityKey = await this.integrityKey(timings);
    const serialized = await timings.measure('serialize', () => {
      const integrity = createHmac('sha256', integrityKey)
        .update(canonicalizeJson(asCanonical(1, this.namespace, records)))
        .digest('hex');
      const envelope: CanonicalJsonValue = {
        schemaVersion: 1,
        namespace: this.namespace,
        records: records.map((record) => ({ id: record.id, expiresAtMs: record.expiresAtMs })),
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
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomBytes(8).toString('hex')}.tmp`);
    try {
      await fs.writeFile(temporaryPath, serialized, { mode: 0o600 });
      const handle = await fs.open(temporaryPath, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      try { await fs.unlink(temporaryPath); } catch { /* preserve the original failure */ }
      throw new Error('Authorization replay storage write failed.', { cause: error });
    }
  }

  public async list(): Promise<ReplayRecord[]> {
    return this.withLock(async (timings) => (await this.readUnlocked(timings)).map((record) => ({ ...record })));
  }

  /** Atomically checks every identity and records all of them on success. */
  public async consumeMany(ids: readonly string[], requestedExpiryMs = this.now() + AUTHORIZATION_REPLAY_RETENTION_MS, logger?: ServerLogger): Promise<boolean> {
    return this.withLock(async (timings) => {
      const now = this.now();
      if (ids.length === 0 || ids.some((id) => id.length === 0) || !Number.isSafeInteger(requestedExpiryMs)) return false;
      const records = (await this.readUnlocked(timings)).filter((record) => record.expiresAtMs > now);
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.some((id) => records.some((record) => record.id === id))) return false;
      const expiry = Math.max(requestedExpiryMs, now + AUTHORIZATION_REPLAY_RETENTION_MS);
      records.push(...uniqueIds.map((id) => ({ id, expiresAtMs: expiry })));
      await this.writeUnlocked(records, timings);
      return true;
    }, logger);
  }

  public consume(id: string, requestedExpiryMs?: number, logger?: ServerLogger): Promise<boolean> {
    return this.consumeMany([id], requestedExpiryMs, logger);
  }
}
