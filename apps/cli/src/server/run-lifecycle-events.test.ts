import { describe, expect, it, vi } from 'vitest';
import { RunStore } from '../run-store';
import { NOOP_LOGGER } from './logger';
import { createTestLocalAgentService } from './local-agent-service.test-support';
import { createTestPlatformAuthContext } from './monitors/test-owners.test-support';
import { EntityReportIndex } from './reports/entity-report-index';
import { ReportInfluenceRuntime } from './reports/report-influence-runtime';
import { RunCompletionEffects, RunLifecycleEvents } from './run-lifecycle-events';

describe('RunLifecycleEvents', () => {
  it('publishes registration and removal events independently', () => {
    const lifecycle = new RunLifecycleEvents();
    const registered: string[] = [];
    const removed: string[] = [];
    const unregisterRegistered = lifecycle.onRunRegistered((runId) => registered.push(runId));
    lifecycle.onRunRemoved((runId) => removed.push(runId));

    lifecycle.publishRunRegistered('run-1');
    lifecycle.publishRunRemoved('run-1');

    expect(registered).toEqual(['run-1']);
    expect(removed).toEqual(['run-1']);

    unregisterRegistered();
    lifecycle.publishRunRegistered('run-2');
    lifecycle.publishRunRemoved('run-2');

    expect(registered).toEqual(['run-1']);
    expect(removed).toEqual(['run-1', 'run-2']);
  });

  it('delivers completion to subscribed concrete effects and stops after unsubscribe', () => {
    const reportInfluenceRuntime = new ReportInfluenceRuntime({
      apiBaseUrl: 'https://api.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('Unexpected report influence fetch.');
      }),
      authContext: createTestPlatformAuthContext(null),
      runStore: new RunStore(),
      agentService: createTestLocalAgentService(),
      index: new EntityReportIndex(),
      logger: NOOP_LOGGER,
    });
    const handleRunFinished = vi
      .spyOn(reportInfluenceRuntime, 'handleRunFinished')
      .mockImplementation(() => undefined);
    const effects = new RunCompletionEffects(reportInfluenceRuntime);
    const lifecycle = new RunLifecycleEvents();
    const unsubscribe = lifecycle.onRunFinished(effects.handleRunFinished);

    lifecycle.publishRunFinished('run-1');
    expect(handleRunFinished).toHaveBeenCalledWith('run-1');

    unsubscribe();
    lifecycle.publishRunFinished('run-2');
    expect(handleRunFinished).not.toHaveBeenCalledWith('run-2');
  });
});
