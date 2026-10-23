import { describe, expect, it, vi } from 'vitest';

import { mapCodexEvent } from '../../../providers/codex/codex-event-mapper';
import type { LocalAgentOutputEvent } from '../../../../run/types';
import { createTestRunRegistryWiring } from '../../../../server/__tests__/helpers/test-run-registry';
import { AgentOutputEvents } from '../../../../server/agent-output-events';
import { NOOP_LOGGER } from '../../../../server/logger';
import { TaskMonitorProviderEventAdmission } from '../../../../server/task-monitor-provider-event-admission';
import { TaskMonitorStateMachineInputAdapter } from '../../../../server/state-machine-input-adapter';
import { taskMonitorExactActionInputFromProviderEvent } from '../provider-event-adapter';

const event = (): LocalAgentOutputEvent => ({
  runId: '40000000-0000-4000-8000-000000000004',
  source: 'provider',
  eventType: 'permission_request_detected',
  timestamp: '2026-08-08T12:00:00.000Z',
  sessionId: 'provider-session',
  agentId: 'codex',
  payload: {
    messageType: 'provider_event',
    canonical_event_type: 'permission_request',
    normalization: { success: true },
    canonical_event: {
      canonical_event_type: 'permission_request',
      timestamp: '2026-08-08T12:00:00.000Z',
      permission_request: {
        id: 'provider-action-1',
        action: 'exec',
        target: 'pnpm deploy',
        fingerprint: 'sha256:exact-action',
        created_at: '2026-08-08T12:00:00.000Z',
        expires_at: '2026-08-08T12:05:00.000Z',
      },
    },
  },
});

const realCodexPermissionEvent = (): LocalAgentOutputEvent => {
  const mapped = mapCodexEvent({
    provider: 'codex',
    runId: '40000000-0000-4000-8000-000000000004',
    eventType: 'item/commandExecution/requestApproval',
    timestamp: '2026-08-08T12:00:00.000Z',
    sessionId: 'provider-session',
    agentId: 'codex',
    rawEvent: {
      id: 'provider-action-1',
      params: { command: ['pnpm', 'deploy'], cwd: '/workspace' },
    },
    config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
  });
  if (!mapped.resolvedEventType) throw new Error('Expected a resolved Codex permission event.');
  return {
    runId: '40000000-0000-4000-8000-000000000004',
    source: 'provider',
    eventType: mapped.resolvedEventType,
    timestamp: '2026-08-08T12:00:00.000Z',
    sessionId: 'provider-session',
    agentId: 'codex',
    payload: mapped.payload,
  };
};

const owner = {
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  agentSessionId: '20000000-0000-4000-8000-000000000002',
  runId: '40000000-0000-4000-8000-000000000004',
};

const observedDuringValidity = (): number => Date.parse('2026-08-08T12:01:00.000Z');

describe('Task Monitor provider event adapter', () => {
  it('connects Task Monitor-owned live Run output to addressed machine admission', async () => {
    const registry = createTestRunRegistryWiring().runRegistry;
    vi.spyOn(registry, 'get').mockReturnValue({
      agentSessionId: owner.agentSessionId,
      taskMonitorId: owner.taskMonitorId,
      session: { contextMetadata: { taskMonitorId: owner.taskMonitorId } },
    } as never);
    const inputAdapter = Object.create(
      TaskMonitorStateMachineInputAdapter.prototype,
    ) as TaskMonitorStateMachineInputAdapter;
    const admitVerified = vi.spyOn(inputAdapter, 'admitVerified').mockResolvedValue({
      status: 'accepted',
      ingressId: 'provider-action',
      snapshot: {} as never,
      effects: [],
    });
    const events = new AgentOutputEvents();
    const admission = new TaskMonitorProviderEventAdmission(
      registry,
      inputAdapter,
      NOOP_LOGGER,
      observedDuringValidity,
    );
    admission.start(events);
    const { runId, ...envelope } = realCodexPermissionEvent();

    events.publish({ kind: 'agent_output', runId, envelope });
    await vi.waitFor(() => expect(admitVerified).toHaveBeenCalledOnce());
    expect(admitVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'PROVIDER_INTERVENTION',
        identity: { machineType: 'TASK_MONITOR', instanceId: owner.taskMonitorId },
        ingressId: `provider-action:${owner.runId}:provider-action-1`,
        action: 'exec',
        target: 'pnpm deploy',
        createdAt: '2026-08-08T12:00:00.000Z',
        expiresAt: '2026-08-08T12:05:00.000Z',
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    );

    admission.dispose();
    events.publish({ kind: 'agent_output', runId, envelope });
    await Promise.resolve();
    expect(admitVerified).toHaveBeenCalledOnce();
  });

  it('admits one normalized exact action with canonical owner and immutable facts', () => {
    expect(
      taskMonitorExactActionInputFromProviderEvent(
        { owner, event: event() },
        () => '30000000-0000-4000-8000-000000000003',
        observedDuringValidity,
      ),
    ).toEqual({
      source: 'PROVIDER_INTERVENTION',
      identity: { machineType: 'TASK_MONITOR', instanceId: owner.taskMonitorId },
      ingressId: `provider-action:${owner.runId}:provider-action-1`,
      taskMonitorId: owner.taskMonitorId,
      interventionId: '30000000-0000-4000-8000-000000000003',
      providerActionId: 'provider-action-1',
      providerSessionId: 'provider-session',
      runId: owner.runId,
      agentSessionId: owner.agentSessionId,
      action: 'exec',
      target: 'pnpm deploy',
      fingerprint: 'sha256:exact-action',
      createdAt: '2026-08-08T12:00:00.000Z',
      expiresAt: '2026-08-08T12:05:00.000Z',
    });
  });

  it('scopes ingress replay identity to the owning Run', () => {
    const first = taskMonitorExactActionInputFromProviderEvent(
      { owner, event: event() },
      () => '30000000-0000-4000-8000-000000000003',
      observedDuringValidity,
    );
    const otherOwner = {
      ...owner,
      runId: '50000000-0000-4000-8000-000000000005',
    };
    const second = taskMonitorExactActionInputFromProviderEvent(
      { owner: otherOwner, event: { ...event(), runId: otherOwner.runId } },
      () => '60000000-0000-4000-8000-000000000006',
      observedDuringValidity,
    );

    expect(first?.ingressId).not.toBe(second?.ingressId);
  });

  it.each([
    ['unowned Run', { runId: '50000000-0000-4000-8000-000000000005' }],
    ['local source', { source: 'local' as const }],
    ['malformed payload', { payload: { messageType: 'provider_event' } }],
  ])('rejects %s without minting an intervention', (_name, override) => {
    let minted = false;
    expect(
      taskMonitorExactActionInputFromProviderEvent(
        { owner, event: { ...event(), ...override } },
        () => {
          minted = true;
          return '30000000-0000-4000-8000-000000000003';
        },
        observedDuringValidity,
      ),
    ).toBeNull();
    expect(minted).toBe(false);
  });

  it('rejects an exact-action request observed after its expiry without minting an intervention', () => {
    let minted = false;
    expect(
      taskMonitorExactActionInputFromProviderEvent(
        { owner, event: event() },
        () => {
          minted = true;
          return '30000000-0000-4000-8000-000000000003';
        },
        () => Date.parse('2026-08-08T12:05:00.000Z'),
      ),
    ).toBeNull();
    expect(minted).toBe(false);
  });
});
