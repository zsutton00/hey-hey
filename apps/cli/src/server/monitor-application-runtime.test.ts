import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

useTestCapabilityCatalog();

describe('MonitorApplicationRuntime Daily Session composition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps Daily Session out of the disabled pipeline and skips its startup work', async () => {
    const owners = createTestLocalAgentServerRuntimeOwners({ enableDailySession: false });
    const resolveAuth = vi.spyOn(owners.infrastructure.platformAuthContext, 'resolve');
    const loadSettings = vi.spyOn(owners.monitorRuntime.dailySessionSettingsStore, 'load');
    const findDailyRuns = vi.spyOn(owners.infrastructure.runStore, 'findRunsByPromptType');

    await owners.monitorRuntime.initialize();
    await owners.monitorRuntime.ensureDailySessionIdentity();

    expect(owners.monitorRuntime.monitorPipeline.getDebug().monitors).toEqual([
      expect.objectContaining({ id: 'session-monitor' }),
    ]);
    expect(loadSettings).not.toHaveBeenCalled();
    expect(findDailyRuns).not.toHaveBeenCalled();
    expect(resolveAuth).not.toHaveBeenCalled();
    expect(owners.monitorRuntime.taskMonitorEffectHandlers).toBeDefined();

    owners.monitorRuntime.dispose();
    await owners.infrastructure.dispose();
  });

  it('keeps Daily Session and Session Monitor available when explicitly enabled', async () => {
    const owners = createTestLocalAgentServerRuntimeOwners({ enableDailySession: true });

    await owners.monitorRuntime.initialize();

    expect(owners.monitorRuntime.monitorPipeline.getDebug().monitors).toEqual([
      expect.objectContaining({ id: 'daily-session' }),
      expect.objectContaining({ id: 'session-monitor' }),
    ]);
    expect(owners.monitorRuntime.taskMonitorEffectHandlers).toBeDefined();

    owners.monitorRuntime.dispose();
    await owners.infrastructure.dispose();
  });
});
