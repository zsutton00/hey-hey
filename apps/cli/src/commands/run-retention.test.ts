import { describe, expect, it, vi } from 'vitest';
import { RunRetentionSettingsStore } from '../run-store/run-retention-settings';
import { runRunRetentionCommand } from './run-retention';

describe('runRunRetentionCommand', () => {
  it('sets and disables automatic retention', async () => {
    const settings = new RunRetentionSettingsStore('/unused');
    const set = vi.spyOn(settings, 'set').mockResolvedValue();
    const log = vi.fn();
    await expect(runRunRetentionCommand(['set', '45'], { settings, log })).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ enabled: true, days: 45 });
    await expect(runRunRetentionCommand(['disable'], { settings, log })).resolves.toBe(true);
    expect(set).toHaveBeenLastCalledWith({ enabled: false });
  });

  it('rejects invalid periods', async () => {
    const logError = vi.fn();
    await expect(runRunRetentionCommand(['set', '0'], { logError })).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith('Run retention days must be a positive integer.');
  });
});
