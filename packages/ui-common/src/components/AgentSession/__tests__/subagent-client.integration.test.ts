import axios, { type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiRuntime } from '../../../clients/createApiRuntime';
import { registerRuntimeClients } from '../../../clients/serviceClients';
import { requestSubagentInteraction } from '../operations/AgentOperationProvider';
import type { MachineDto } from '../../../api';

const rail = vi.hoisted(() => ({
  grant: { kind: 'bounded_grant', grantId: '20000000-0000-4000-8000-000000000001' } as const,
  calls: [] as Array<{ machineId: string; action: unknown }>,
  deny: false,
}));
vi.mock('../../../data/hooks/useControllerAuthorizedAction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../data/hooks/useControllerAuthorizedAction')>()),
  executeControllerAuthorizedAction: vi.fn(async ({ machine, action, submit }: {
    machine: MachineDto; action: unknown; submit: (input: { authorization: unknown }) => Promise<unknown>;
  }) => {
    rail.calls.push({ machineId: machine.machineId, action });
    if (rail.deny) return { outcome: 'DENIED', reason: 'GRANT_NOT_ACTIVE', retryable: false };
    return { outcome: 'ADMITTED', data: await submit({ authorization: rail.grant }) };
  }),
}));

const machine = { machineId: 'machine', executionReadiness: 'READY' } as MachineDto;

beforeEach(() => {
  rail.calls = [];
  rail.deny = false;
});
afterEach(() => vi.useRealTimers());

describe('UI subagent command to generated API client', () => {
  it.each(['foreground', 'background'] as const)('submits a %s command and reads the wrapped admission/dispatch response', async (mode) => {
    vi.useFakeTimers();
    const interactionId = '10000000-0000-4000-8000-000000000001';
    const sessionId = '10000000-0000-4000-8000-000000000002';
    const runId = '10000000-0000-4000-8000-000000000003';
    const requests: Array<{ url: string; method: string; body: any }> = [];
    let reads = 0;
    const adapter: AxiosAdapter = async (config) => {
      const url = new URL(config.url!, config.baseURL).pathname;
      requests.push({ url, method: config.method!, body: config.data ? JSON.parse(config.data) : undefined });
      let data: any;
      if (config.method === 'post') {
        expect(url).toBe(`/api/v1/organizations/org/projects/project/agent-sessions/${sessionId}/subagent-interactions`);
        data = { interaction: { id: interactionId, state: 'DISPATCHING' }, replayed: false };
      } else {
        expect(url).toBe(`/api/v1/organizations/org/projects/project/agent-interactions/${interactionId}`);
        data = { id: interactionId, state: ++reads === 1 ? 'WAITING' : 'DELIVERED' };
      }
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } };
    };
    const transport = axios.create({ adapter });
    const runtime = createApiRuntime({ baseUrl: 'http://local-test.invalid/api/v1', transport: {
      axios: transport, request: (config) => transport.request(config), setAuthToken: () => {}, onUnauthorized: () => () => {},
    } });
    registerRuntimeClients(runtime.clients);
    const onAccepted = vi.fn();
    let completed = false;
    const pending = requestSubagentInteraction({ organizationId: 'org', projectId: 'project',
      agentSessionId: sessionId, runId, interactionId, intent: { kind: 'subagent', mode, capability: 'research', objective: 'Inspect the implementation' }, serviceIds: ['service-a'], onAccepted, machine,
    }).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onAccepted).toHaveBeenCalledWith(interactionId);
    expect(completed).toBe(mode === 'background');
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(requests[0].body).toEqual({
      id: interactionId, attemptId: interactionId, sourceSessionId: sessionId, sourceRunId: runId,
      mode: mode.toUpperCase(), capability: 'RESEARCH', objective: 'Inspect the implementation',
      serviceIds: ['service-a'], idempotencyKey: interactionId, expectedRevision: 0,
      authorization: rail.grant,
    });
    expect(rail.calls).toEqual([{
      machineId: 'machine',
      action: {
        requestId: expect.any(String), actionCategory: 'CONVERSATION', actionType: 'CONVERSATION_TRIGGER',
        targetKind: 'AGENT_SESSION', targetId: sessionId,
      },
    }]);
    expect(reads).toBe(mode === 'foreground' ? 2 : 1);
  });

  it('surfaces controller denial without submitting the child request', async () => {
    rail.deny = true;
    const onAccepted = vi.fn();
    await expect(requestSubagentInteraction({ organizationId: 'org', projectId: 'project',
      agentSessionId: 'session', runId: 'session', interactionId: 'interaction',
      intent: { kind: 'subagent', mode: 'background', capability: 'research', objective: 'Inspect' },
      serviceIds: [], onAccepted, machine,
    })).rejects.toThrow('The controller denied this child request: GRANT_NOT_ACTIVE');
    expect(rail.calls).toHaveLength(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
