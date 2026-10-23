import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import { RunStore } from '../../run-store/run-store';
import { NOOP_LOGGER } from '../logger';
import { MonitorProjectContext, resolvePersistedMonitorProject } from './project-context';
import { createTestPlatformWebSocketManager } from './test-owners.test-support';

const run = (input: { runId: string; projectId: string; createdAt: string }): AgenticSession =>
  ({
    agentic_session_id: input.runId,
    contextMetadata: { organizationId: 'org-1', projectId: input.projectId },
    createdAt: input.createdAt,
  }) as AgenticSession;

describe('resolvePersistedMonitorProject', () => {
  it('uses the newest persisted daily-session Run as the project subscription seed', () => {
    expect(
      resolvePersistedMonitorProject([
        run({ runId: 'older', projectId: 'project-old', createdAt: '2026-07-01T00:00:00Z' }),
        run({ runId: 'newer', projectId: 'project-new', createdAt: '2026-07-02T00:00:00Z' }),
      ]),
    ).toEqual({ status: 'found', projectId: 'project-new', runId: 'newer' });
  });

  it('fails closed when the newest persisted Run has no required project context', () => {
    expect(
      resolvePersistedMonitorProject([
        run({ runId: 'invalid', projectId: '  ', createdAt: '2026-07-02T00:00:00Z' }),
      ]),
    ).toEqual({ status: 'missing_project', runId: 'invalid' });
  });

  it('reports that no subscription seed exists when there is no persisted daily session', () => {
    expect(resolvePersistedMonitorProject([])).toEqual({ status: 'no_daily_session_run' });
  });

  it('restores the project-room subscription from persisted Daily Session state', async () => {
    const subscribeProject = vi.fn();
    const runStore = new RunStore();
    vi.spyOn(runStore, 'findRunsByPromptType').mockResolvedValue([
      run({ runId: 'daily-run', projectId: 'project-1', createdAt: '2026-07-02T00:00:00Z' }),
    ]);
    const platformWebSocketManager = createTestPlatformWebSocketManager();
    vi.spyOn(platformWebSocketManager, 'subscribeProject').mockImplementation(subscribeProject);
    const context = new MonitorProjectContext({
      runStore,
      platformWebSocketManager,
      logger: NOOP_LOGGER,
    });
    const projectId = await context.restore();

    expect(projectId).toBe('project-1');
    expect(subscribeProject).toHaveBeenCalledOnce();
    expect(subscribeProject).toHaveBeenCalledWith('project-1');
  });

  it('does not subscribe when persisted Daily Session context is missing a project', async () => {
    const subscribeProject = vi.fn();
    const runStore = new RunStore();
    vi.spyOn(runStore, 'findRunsByPromptType').mockResolvedValue([
      run({ runId: 'invalid', projectId: '', createdAt: '2026-07-02T00:00:00Z' }),
    ]);
    const platformWebSocketManager = createTestPlatformWebSocketManager();
    vi.spyOn(platformWebSocketManager, 'subscribeProject').mockImplementation(subscribeProject);
    const context = new MonitorProjectContext({
      runStore,
      platformWebSocketManager,
      logger: NOOP_LOGGER,
    });
    const projectId = await context.restore();

    expect(projectId).toBeNull();
    expect(subscribeProject).not.toHaveBeenCalled();
  });
});
