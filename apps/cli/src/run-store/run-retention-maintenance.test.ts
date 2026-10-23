import { describe, expect, it, vi } from 'vitest';
import type { ServerLogger } from '../server/logger';
import { RunRetentionMaintenance } from './run-retention-maintenance';
import { RunRetentionSettingsStore } from './run-retention-settings';
import { RunStore } from './run-store';

const createLogger = (): ServerLogger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
});

describe('RunRetentionMaintenance', () => {
  it('does not run when disabled and admits only one in-flight start', async () => {
    const settings = new RunRetentionSettingsStore('/unused');
    let release: (() => void) | undefined;
    const load = vi.spyOn(settings, 'load').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ enabled: false });
        }),
    );
    const logger = createLogger();
    const store = new RunStore();
    const scan = vi.spyOn(store, 'scanRunMetadataForRetention');
    const remove = vi.spyOn(store, 'deleteCompletedFamiliesForRetention');
    const maintenance = new RunRetentionMaintenance(store, settings, logger);

    maintenance.startAfterReadiness();
    maintenance.startAfterReadiness();
    expect(load).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith('run_retention.skipped', {
      reason: 'already_running',
    });
    release?.();
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith('run_retention.skipped', { reason: 'disabled' });
    });
    expect(scan).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
