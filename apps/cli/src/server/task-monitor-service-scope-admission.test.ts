import type { AgentSessionServiceScopeRequest } from '@hey-hey/contracts/api/models';
import { describe, expect, it, vi } from 'vitest';

import { NOOP_LOGGER } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import {
  TaskMonitorServiceScopeAdmission,
  serviceScopeFingerprint,
} from './task-monitor-service-scope-admission';

const request: AgentSessionServiceScopeRequest = {
  id: 'scope-request-1',
  runId: 'run-1',
  sessionId: 'session-1',
  agentId: 'coding_freeform',
  agentType: 'claude',
  timestamp: '2026-07-01T00:00:00.000Z',
  idempotencyToken: 'token-1',
  currentServiceIds: ['svc-1'],
  requestedServiceIds: ['svc-1', 'svc-2'],
  reason: 'The Task also changes the API.',
};

describe('Service scope request admission to the Task Monitor', () => {
  it('admits the request as a monitor-owned Service scope action keyed to its own request id', async () => {
    const admitVerified = vi.fn(async () => ({ status: 'accepted' as const }));
    const admission = new TaskMonitorServiceScopeAdmission(
      { admitVerified } as unknown as TaskMonitorStateMachineInputAdapter,
      NOOP_LOGGER,
    );

    await expect(
      admission.admit({
        taskMonitorId: 'monitor-1',
        runId: 'run-1',
        agentSessionId: 'agent-session-1',
        request,
        additionalServiceNames: ['API'],
      }),
    ).resolves.toEqual({ status: 'admitted' });

    expect(admitVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'PROVIDER_INTERVENTION',
        requestKind: 'SERVICE_SCOPE',
        userRequired: false,
        providerActionId: 'scope-request-1',
        providerSessionId: 'session-1',
        fingerprint: serviceScopeFingerprint(request),
        target: expect.stringContaining('API'),
      }),
    );
  });

  it('reports a rejection with its code and reason so the caller can hand the request to a person', async () => {
    const admission = new TaskMonitorServiceScopeAdmission(
      {
        admitVerified: vi.fn(async () => ({
          status: 'rejected' as const,
          code: 'transition_rejected',
          reason: 'Task Monitor is not observing a Run.',
        })),
      } as unknown as TaskMonitorStateMachineInputAdapter,
      NOOP_LOGGER,
    );

    await expect(
      admission.admit({
        taskMonitorId: 'monitor-1',
        runId: 'run-1',
        agentSessionId: 'agent-session-1',
        request,
        additionalServiceNames: ['API'],
      }),
    ).resolves.toEqual({
      status: 'rejected',
      code: 'transition_rejected',
      reason: 'Task Monitor is not observing a Run.',
    });
  });

  it('fingerprints the Services added and the reason, so a different ask needs a new decision', () => {
    const same = { ...request, id: 'another-id', idempotencyToken: 'token-2' };

    expect(serviceScopeFingerprint(same)).toBe(serviceScopeFingerprint(request));
    expect(serviceScopeFingerprint({ ...request, reason: 'A different reason.' })).not.toBe(
      serviceScopeFingerprint(request),
    );
    expect(
      serviceScopeFingerprint({ ...request, requestedServiceIds: ['svc-1', 'svc-3'] }),
    ).not.toBe(serviceScopeFingerprint(request));
  });
});
