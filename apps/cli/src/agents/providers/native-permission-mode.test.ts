import { describe, expect, it, vi } from 'vitest';
import { NativePermissionModeProbe } from './native-permission-mode';
import type { AgentProviderId } from './provider-config';

describe('NativePermissionModeProbe', () => {
  it('enables auto mode for an installation at or above the verified version', async () => {
    const probe = new NativePermissionModeProbe(async (providerId) =>
      providerId === 'claude' ? '2.1.327 (Claude Code)\n' : 'codex-cli 0.171.2\n',
    );

    await expect(probe.resolve('claude')).resolves.toEqual({
      mode: 'auto',
      installedVersion: '2.1.327',
    });
    await expect(probe.resolve('codex')).resolves.toEqual({
      mode: 'auto',
      installedVersion: '0.171.2',
    });
  });

  it('reports an older installation as unavailable, not as a denial', async () => {
    const probe = new NativePermissionModeProbe(async () => '2.0.9 (Claude Code)');

    await expect(probe.resolve('claude')).resolves.toEqual({
      mode: null,
      reason: 'installed_version_too_old',
      installedVersion: '2.0.9',
    });
  });

  it('reports unreadable or missing installations with the cause, and retries them', async () => {
    const read = vi
      .fn<(providerId: AgentProviderId) => Promise<string>>()
      .mockRejectedValueOnce(new Error('spawn claude ENOENT'))
      .mockResolvedValueOnce('garbage')
      .mockResolvedValue('2.1.327 (Claude Code)');
    const probe = new NativePermissionModeProbe(read);

    await expect(probe.resolve('claude')).resolves.toMatchObject({
      mode: null,
      reason: 'version_unreadable',
      cause: 'spawn claude ENOENT',
    });
    await expect(probe.resolve('claude')).resolves.toMatchObject({ reason: 'version_unreadable' });
    await expect(probe.resolve('claude')).resolves.toMatchObject({ mode: 'auto' });
    await probe.resolve('claude');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('never probes a provider without a native mode', async () => {
    const read = vi.fn();

    await expect(new NativePermissionModeProbe(read).resolve('opencode')).resolves.toEqual({
      mode: null,
      reason: 'provider_has_no_native_mode',
    });
    expect(read).not.toHaveBeenCalled();
  });
});
