import { describe, expect, it, vi } from 'vitest';
import { ReportType } from '../shared/api/generated/api';
import { NOOP_LOGGER } from './logger';
import type { CanonicalSettledTurnMonitorEvent } from './monitors/normalizer';
import type { PlatformAuth } from './platform-auth-context';
import { TaskMonitorSettlementMachineAdapter } from './task-monitor-settlement-machine-adapter';

const MONITOR_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const RUN_ID = '30000000-0000-4000-8000-000000000003';
const TURN_ID = '40000000-0000-4000-8000-000000000004';
const AUTH = {
  accessToken: 'token',
  organizationId: 'org',
  projectId: 'project',
  userId: 'user',
} satisfies PlatformAuth;

const event = (
  promptType = 'quick',
  agentSessionId = SESSION_ID,
): CanonicalSettledTurnMonitorEvent => ({
  kind: 'settled_turn',
  eventType: 'settled_turn',
  origin: 'self',
  entityId: agentSessionId,
  timestamp: '2026-08-09T12:00:00.000Z',
  agentSessionId,
  turnId: TURN_ID,
  promptType,
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: null,
  reports: [{ reportId: '50000000-0000-4000-8000-000000000005', reportType: ReportType.Implement }],
  settledAt: '2026-08-09T12:00:00.000Z',
});

const harness = (activeRunAgentSessionId: string | null = SESSION_ID) => {
  const readAgentSession = vi.fn().mockResolvedValue({
    autoDecide: false,
    conversationId: '60000000-0000-4000-8000-000000000006',
    config: {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'gpt-5.6',
      taskMonitorId: MONITOR_ID,
    },
  });
  const findByInstanceId = vi.fn().mockResolvedValue({
    snapshot: {
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      context: { activeRunAgentSessionId },
    },
  });
  const lookupByAgentSessionId = vi.fn().mockReturnValue(RUN_ID);
  const admitVerified = vi.fn().mockResolvedValue({
    status: 'accepted',
    ingressId: `settled-turn:${TURN_ID}`,
    snapshot: {},
    effects: [],
  });
  return {
    readAgentSession,
    findByInstanceId,
    lookupByAgentSessionId,
    admitVerified,
    adapter: new TaskMonitorSettlementMachineAdapter(
      { readAgentSession } as never,
      { lookupByAgentSessionId } as never,
      { findByInstanceId } as never,
      { admitVerified } as never,
      NOOP_LOGGER,
    ),
  };
};

describe('TaskMonitorSettlementMachineAdapter', () => {
  it.each([
    ['quick', 'IMPLEMENTATION'],
    ['free_form', 'IMPLEMENTATION'],
    ['coding_freeform', 'IMPLEMENTATION'],
    ['implement', 'IMPLEMENTATION'],
    ['code_review', 'REVIEW'],
  ] as const)('maps a released %s Turn to a closed %s input', async (promptType, phase) => {
    const owner = harness();

    await expect(owner.adapter.invoke(event(promptType), AUTH)).resolves.toEqual({
      status: 'HANDLED',
      supervisor: 'TASK_MONITOR',
    });

    expect(owner.admitVerified).toHaveBeenCalledWith({
      source: 'EXECUTION_TURN_RELEASED',
      phase,
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      ingressId: `settled-turn:${TURN_ID}`,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      turnId: TURN_ID,
      settledAt: '2026-08-09T12:00:00.000Z',
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [
        { reportId: '50000000-0000-4000-8000-000000000005', reportType: ReportType.Implement },
      ],
    });
  });

  it.each(['project_assistant', 'startup_session', 'session_monitor'])(
    'releases an inapplicable %s Turn',
    async (promptType) => {
      const owner = harness();

      await expect(owner.adapter.invoke(event(promptType), AUTH)).resolves.toEqual({
        status: 'RELEASED',
        supervisor: 'TASK_MONITOR',
        reason: 'TASK_MONITOR_NOT_APPLICABLE',
      });
      expect(owner.readAgentSession).not.toHaveBeenCalled();
      expect(owner.admitVerified).not.toHaveBeenCalled();
    },
  );

  it('releases evidence that does not match the durable active Agent Session', async () => {
    const owner = harness('70000000-0000-4000-8000-000000000007');

    await expect(owner.adapter.invoke(event(), AUTH)).resolves.toMatchObject({
      status: 'RELEASED',
    });
    expect(owner.lookupByAgentSessionId).not.toHaveBeenCalled();
    expect(owner.admitVerified).not.toHaveBeenCalled();
  });

  it('releases evidence without a canonical Task Monitor owner', async () => {
    const owner = harness();
    owner.readAgentSession.mockResolvedValue({ autoDecide: false, config: null });

    await expect(owner.adapter.invoke(event(), AUTH)).resolves.toMatchObject({
      status: 'RELEASED',
    });
    expect(owner.findByInstanceId).not.toHaveBeenCalled();
  });

  it('releases lifecycle-irrelevant admission and fails unexpected admission errors', async () => {
    const irrelevant = harness();
    irrelevant.admitVerified.mockResolvedValue({
      status: 'rejected',
      code: 'transition_rejected',
      reason: 'stale',
    });
    await expect(irrelevant.adapter.invoke(event(), AUTH)).resolves.toEqual({
      status: 'RELEASED',
      supervisor: 'TASK_MONITOR',
      reason: 'TASK_MONITOR_INPUT_IRRELEVANT',
    });

    const failed = harness();
    failed.admitVerified.mockResolvedValue({
      status: 'rejected',
      code: 'input_rejected',
      reason: 'broken boundary',
    });
    await expect(failed.adapter.invoke(event(), AUTH)).resolves.toEqual({
      status: 'FAILED',
      supervisor: 'TASK_MONITOR',
      reason: 'broken boundary',
    });
  });
});
