import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveBaseDir } from '../session/paths';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import {
  storedProviders,
  providerUsageSchema,
  unreportedUsage,
  type ProviderUsage,
  type UsageProvider,
} from './provider-usage';

export type ProviderUsageRead =
  | { status: 'reported' | 'unreported'; usage: ProviderUsage }
  | { status: 'storage_failure'; provider: UsageProvider };

export class ProviderUsageStore {
  private readonly directory: string;
  private readonly queues = new Map<UsageProvider, Promise<void>>();
  public constructor(
    baseDir = resolveBaseDir(),
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {
    this.directory = path.join(baseDir, 'provider-usage');
  }
  private file(provider: UsageProvider): string {
    return path.join(this.directory, `${provider}.json`);
  }
  public async read(provider: UsageProvider): Promise<ProviderUsageRead> {
    try {
      const parsed = providerUsageSchema.safeParse(
        JSON.parse(await fs.readFile(this.file(provider), 'utf8')),
      );
      if (!parsed.success || parsed.data.provider !== provider || parsed.data.observedAt === null) {
        this.logger.warn('provider_usage.read.invalid', { provider });
        return { status: 'storage_failure', provider };
      }
      return { status: 'reported', usage: parsed.data };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { status: 'unreported', usage: unreportedUsage(provider) };
      }
      this.logger.warn('provider_usage.read.failed', { provider });
      return { status: 'storage_failure', provider };
    }
  }
  public async readAll(): Promise<ProviderUsageRead[]> {
    this.logger.debug('provider_usage.read_all.started', { providerCount: storedProviders.length });
    const readings = await Promise.all(
      storedProviders.map(async (provider): Promise<ProviderUsageRead> => {
        this.logger.debug('provider_usage.read.started', { provider });
        try {
          const reading = await this.read(provider);
          this.logger.debug('provider_usage.read.completed', {
            provider,
            status: reading.status,
          });
          return reading;
        } catch {
          this.logger.warn('provider_usage.read.failed', {
            provider,
            reason: 'unexpected_read_failure',
          });
          return { status: 'storage_failure', provider };
        }
      }),
    );
    this.logger.debug('provider_usage.read_all.completed', {
      providerCount: readings.length,
      reportedCount: readings.filter((reading) => reading.status === 'reported').length,
      unreportedCount: readings.filter((reading) => reading.status === 'unreported').length,
      errorCount: readings.filter((reading) => reading.status === 'storage_failure').length,
    });
    return readings;
  }
  public async save(usage: ProviderUsage, reportedWindow?: 'fiveHour' | 'weekly'): Promise<void> {
    const snapshot = providerUsageSchema.parse(usage);
    const operation = (this.queues.get(usage.provider) ?? Promise.resolve()).then(() =>
      this.write(snapshot, reportedWindow),
    );
    void operation.catch(() => {
      this.logger.warn('provider_usage.write.failed', { provider: usage.provider });
    });
    this.queues.set(
      usage.provider,
      operation.catch(() => undefined),
    );
    return operation;
  }
  private async write(usage: ProviderUsage, reportedWindow?: 'fiveHour' | 'weekly'): Promise<void> {
    providerUsageSchema.parse(usage);
    if (usage.observedAt === null) throw new Error('A reported observation needs a timestamp');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.logger.debug('provider_usage.write.started', { provider: usage.provider });
    // A filesystem lock serializes separate stores/processes, including the stale-read check.
    const lock = `${this.file(usage.provider)}.lock`;
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fs.mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        await delay(10);
      }
    }
    if (!acquired) throw new Error('Provider snapshot is locked');
    const temporary = `${this.file(usage.provider)}.${randomUUID()}.tmp`;
    try {
      const current = await this.read(usage.provider);
      if (current.status === 'storage_failure') throw new Error('Provider snapshot cannot be read');
      if (
        current.usage.observedAt !== null &&
        Date.parse(current.usage.observedAt) > Date.parse(usage.observedAt)
      ) {
        this.logger.debug('provider_usage.write.stale', { provider: usage.provider });
        return;
      }
      const snapshot = reportedWindow
        ? {
            ...current.usage,
            observedAt: usage.observedAt,
            [reportedWindow]: usage[reportedWindow],
          }
        : usage;
      await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.file(usage.provider));
      this.logger.debug('provider_usage.write.saved', {
        provider: usage.provider,
        observedAt: usage.observedAt,
      });
    } finally {
      try {
        await fs.rm(temporary, { force: true });
      } finally {
        await fs.rmdir(lock);
      }
    }
  }
  public async flush(): Promise<void> {
    await Promise.all(this.queues.values());
  }
}
