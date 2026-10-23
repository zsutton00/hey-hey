import type { ServerLogger } from '../server/logger';
import { cullRunStore, type CullRunStoreResult } from './cull-run-store';
import { RunRetentionSettingsStore } from './run-retention-settings';
import { RunStore } from './run-store';

const DAY_MS = 24 * 60 * 60 * 1000;

export class RunRetentionMaintenance {
  private pass: Promise<CullRunStoreResult | null> | null = null;

  public constructor(
    private readonly runStore: RunStore,
    private readonly settings: RunRetentionSettingsStore,
    private readonly logger: ServerLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public startAfterReadiness(): void {
    if (this.pass) {
      this.logger.debug('run_retention.skipped', { reason: 'already_running' });
      return;
    }
    this.logger.info('run_retention.started');
    this.pass = this.runOnce()
      .catch((error: Error) => {
        this.logger.error('run_retention.failed', { error });
        return null;
      })
      .finally(() => {
        this.pass = null;
      });
  }

  private async runOnce(): Promise<CullRunStoreResult | null> {
    const setting = await this.settings.load();
    if (!setting.enabled) {
      this.logger.info('run_retention.skipped', { reason: 'disabled' });
      return null;
    }
    const completedBefore = new Date(this.now().getTime() - setting.days * DAY_MS);
    const result = await cullRunStore({
      apply: true,
      completedBefore,
      retentionOnly: true,
      runStore: this.runStore,
    });
    if (result.incompatibleRunCount > 0) {
      this.logger.info('run_retention.preserved', {
        reason: 'incompatible',
        runCount: result.incompatibleRunCount,
      });
    }
    this.logger.info('run_retention.completed', {
      retentionDays: setting.days,
      reclaimedRuns: result.expiredCompletedRunCount,
      reclaimedBytes: result.deletedLogicalBytes,
      incompatibleRunsPreserved: result.incompatibleRunCount,
    });
    return result;
  }
}
