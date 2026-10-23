import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RepoIoError,
  RepoLockTimeoutError,
  RepoMappingNotFoundError,
  RepoValidationError,
} from './errors';
import { resolveProfileDataDir } from '../session/paths';
import { resolveCanonicalDirectory } from './discovery';
import type {
  RepoMappingStoreData,
  RepoMappingStoreOptions,
  ServiceRepoBinding,
  ServiceId,
} from './types';
import { REPO_STATE_VERSION, toRepositoryPath, toServiceId } from './types';

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 40;
const DEFAULT_STALE_LOCK_MS = 30_000;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const readString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RepoValidationError(`Invalid or missing "${fieldName}".`);
  }
  return value;
};

const normalizeIso = (value: string, fieldName: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RepoValidationError(`Invalid date in "${fieldName}".`);
  }
  return date.toISOString();
};

const resolveBaseDir = (): string => {
  if (process.env['HEYHEY_REPO_DIR']) {
    return process.env['HEYHEY_REPO_DIR'];
  }
  return resolveProfileDataDir();
};

const nowIso = (now: () => Date): string => now().toISOString();

const validateStoreData = (value: unknown): RepoMappingStoreData => {
  if (!isObject(value)) {
    throw new RepoValidationError('Repository mapping payload is not a JSON object.');
  }

  const stateVersion = value['state_version'];
  if (typeof stateVersion !== 'number' || !Number.isInteger(stateVersion) || stateVersion <= 0) {
    throw new RepoValidationError('Invalid or missing "state_version" in repo mappings.');
  }

  const mappingsRaw = value['mappings'];
  if (!Array.isArray(mappingsRaw)) {
    throw new RepoValidationError('Invalid or missing "mappings" in repo mappings.');
  }

  const mappings = mappingsRaw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new RepoValidationError(`Invalid mapping entry at index ${String(index)}.`);
    }

    return {
      serviceId: readString(entry['serviceId'], `mappings[${String(index)}].serviceId`),
      repositoryPath: readString(
        entry['repositoryPath'],
        `mappings[${String(index)}].repositoryPath`,
      ),
      createdAt: normalizeIso(
        readString(entry['createdAt'], `mappings[${String(index)}].createdAt`),
        `mappings[${String(index)}].createdAt`,
      ),
      updatedAt: normalizeIso(
        readString(entry['updatedAt'], `mappings[${String(index)}].updatedAt`),
        `mappings[${String(index)}].updatedAt`,
      ),
    };
  });

  return {
    state_version: stateVersion,
    updatedAt: normalizeIso(readString(value['updatedAt'], 'updatedAt'), 'updatedAt'),
    mappings,
  };
};

const createInitialStoreData = (now: () => Date): RepoMappingStoreData => ({
  state_version: REPO_STATE_VERSION,
  updatedAt: nowIso(now),
  mappings: [],
});

export class RepoMappingStore {
  private readonly mappingPath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  private readonly staleLockMs: number;
  private readonly listeners = new Set<() => void>();

  constructor(options: RepoMappingStoreOptions = {}) {
    const baseDir = resolveBaseDir();
    this.mappingPath = options.mappingPath ?? path.join(baseDir, 'repos.json');
    this.lockPath = options.lockPath ?? path.join(baseDir, 'repos.lock');
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.lockTimeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.lockRetryDelayMs = options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
    this.staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.mappingPath), { recursive: true, mode: 0o700 });
      await fs.chmod(path.dirname(this.mappingPath), 0o700);
    } catch (error) {
      throw new RepoIoError(
        `Failed to create repository mapping directory: ${path.dirname(this.mappingPath)}`,
        error,
      );
    }
  }

  private async readStoreUnsafe(): Promise<RepoMappingStoreData> {
    let text: string;
    try {
      text = await fs.readFile(this.mappingPath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createInitialStoreData(this.now);
      }
      throw new RepoIoError(`Failed reading mapping file ${this.mappingPath}`, error);
    }

    try {
      return validateStoreData(JSON.parse(text));
    } catch (error) {
      if (error instanceof RepoValidationError) {
        throw error;
      }
      throw new RepoValidationError(
        `Repository mappings file ${this.mappingPath} is invalid JSON.`,
        error,
      );
    }
  }

  private async writeAtomic(payload: string): Promise<void> {
    const tempPath = `${this.mappingPath}.tmp-${this.randomId()}`;

    try {
      await fs.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tempPath, this.mappingPath);
      await fs.chmod(this.mappingPath, 0o600);
    } catch (error) {
      throw new RepoIoError(`Failed writing mapping file ${this.mappingPath}`, error);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async writeStoreUnsafe(data: RepoMappingStoreData): Promise<void> {
    await this.writeAtomic(JSON.stringify(data, null, 2));
  }

  private toBinding(value: RepoMappingStoreData['mappings'][number]): ServiceRepoBinding {
    return {
      serviceId: toServiceId(value.serviceId),
      repositoryPath: toRepositoryPath(value.repositoryPath),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDir();

    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let lockHandle: fs.FileHandle | null = null;
      try {
        lockHandle = await fs.open(this.lockPath, 'wx', 0o600);
        const lockPayload = JSON.stringify({ pid: process.pid, createdAt: nowIso(this.now) });
        await lockHandle.writeFile(lockPayload, { encoding: 'utf8' });
        await lockHandle.close();
        lockHandle = null;

        try {
          return await operation();
        } finally {
          await fs.unlink(this.lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (lockHandle) {
          await lockHandle.close().catch(() => undefined);
          await fs.unlink(this.lockPath).catch(() => undefined);
        }

        if (isNodeError(error) && error.code === 'EEXIST') {
          try {
            const stat = await fs.stat(this.lockPath);
            if (Date.now() - stat.mtimeMs > this.staleLockMs) {
              await fs.unlink(this.lockPath).catch(() => undefined);
              continue;
            }
          } catch {
            // Another writer may have released lock; continue retry loop.
          }

          if (Date.now() >= deadline) {
            throw new RepoLockTimeoutError(`Timed out waiting for lock ${this.lockPath}`);
          }

          await sleep(this.lockRetryDelayMs);
          continue;
        }

        if (error instanceof RepoIoError || error instanceof RepoValidationError) {
          throw error;
        }

        throw new RepoIoError(
          `Failed while updating repository mappings with lock ${this.lockPath}`,
          error,
        );
      }
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async listBindings(): Promise<ServiceRepoBinding[]> {
    const data = await this.withLock(async () => this.readStoreUnsafe());
    return data.mappings
      .map((mapping) => this.toBinding(mapping))
      .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  }

  async getBinding(serviceId: ServiceId): Promise<ServiceRepoBinding | null> {
    const data = await this.withLock(async () => this.readStoreUnsafe());
    const entry = data.mappings.find((mapping) => mapping.serviceId === serviceId);
    return entry ? this.toBinding(entry) : null;
  }

  async setBinding(serviceId: ServiceId, repositoryPathInput: string): Promise<ServiceRepoBinding> {
    const canonicalDirectory = await resolveCanonicalDirectory(repositoryPathInput);
    const saved = await this.withLock(async () => {
      const data = await this.readStoreUnsafe();
      const existing = data.mappings.find((mapping) => mapping.serviceId === serviceId);
      const timestamp = nowIso(this.now);

      if (existing) {
        existing.repositoryPath = canonicalDirectory;
        existing.updatedAt = timestamp;
      } else {
        data.mappings.push({
          serviceId,
          repositoryPath: canonicalDirectory,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      data.updatedAt = timestamp;
      await this.writeStoreUnsafe(data);

      const persisted = data.mappings.find((mapping) => mapping.serviceId === serviceId);
      if (!persisted) {
        throw new RepoIoError(`Failed to persist mapping for service: ${serviceId}`);
      }

      return this.toBinding(persisted);
    });
    this.notify();
    return saved;
  }

  async removeBinding(serviceId: ServiceId): Promise<boolean> {
    const removed = await this.withLock(async () => {
      const data = await this.readStoreUnsafe();
      const before = data.mappings.length;
      data.mappings = data.mappings.filter((mapping) => mapping.serviceId !== serviceId);

      if (data.mappings.length === before) {
        return false;
      }

      data.updatedAt = nowIso(this.now);
      await this.writeStoreUnsafe(data);
      return true;
    });
    if (removed) {
      this.notify();
    }
    return removed;
  }

  async resolvePathForService(serviceId: ServiceId): Promise<string> {
    const binding = await this.getBinding(serviceId);
    if (!binding) {
      throw new RepoMappingNotFoundError(`No repository mapping found for service: ${serviceId}`);
    }
    return binding.repositoryPath;
  }
}
