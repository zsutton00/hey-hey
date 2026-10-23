import { describe, expect, it, vi } from 'vitest';
import type { TaskMonitorMachineDiagnosticView } from '../agents/task-monitor/state-machine/diagnostics';
import { MACHINE_HISTORY_USAGE, runMachineHistoryCommand } from './machine-history';

const view: TaskMonitorMachineDiagnosticView = {
  identity: { machineType: 'TASK_MONITOR', instanceId: 'monitor-1' },
  currentRevision: 4,
  currentState: {
    lifecycleState: 'RUNNING',
    controlState: 'PAUSED',
    executionState: 'OBSERVING_RUN',
    interventionState: 'CLEAR',
    inputState: 'WAITING_FOR_INPUT',
  },
  selectedWorkCorrelation: {
    taskMonitorId: 'monitor-1',
    selectedTaskId: 'task-1',
    cursor: 0,
    agentSessionId: 'agent-session-1',
    activeRunAgentSessionId: 'agent-session-1',
    conversationId: 'conversation-1',
    coordinationCause: null,
    coordinationCorrelationId: null,
  },
  pendingEffects: [],
  transitionHistory: [],
};

describe('runMachineHistoryCommand', () => {
  it('prints the diagnostic projection for the selected instance', async () => {
    const inspect = vi.fn().mockResolvedValue(view);
    const log = vi.fn();

    await expect(runMachineHistoryCommand(['monitor-1'], { inspect, log })).resolves.toBe(true);

    expect(inspect).toHaveBeenCalledWith('monitor-1');
    expect(log).toHaveBeenCalledWith(JSON.stringify(view, null, 2));
  });

  it('rejects missing and unknown instance identities without writing', async () => {
    const logError = vi.fn();
    await expect(runMachineHistoryCommand([], { logError })).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith(MACHINE_HISTORY_USAGE);

    const inspect = vi.fn().mockResolvedValue(null);
    await expect(runMachineHistoryCommand(['missing'], { inspect, logError })).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith('Machine instance missing was not found.');
  });
});
