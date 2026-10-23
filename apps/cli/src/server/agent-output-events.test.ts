import { describe, expect, it, vi } from 'vitest';
import { createTestRunRegistryWiring } from './__tests__/helpers/test-run-registry';
import { AgentOutputEvents, AgentOutputSourceBridge } from './agent-output-events';
import { AgentSource } from './monitors/normalizer';

describe('AgentOutputEvents', () => {
  it('delivers output through the named source bridge and supports disposal', () => {
    const { runRegistry } = createTestRunRegistryWiring();
    const agentSource = new AgentSource(runRegistry);
    const ingest = vi.spyOn(agentSource, 'ingest').mockImplementation(() => undefined);
    const events = new AgentOutputEvents();
    const bridge = new AgentOutputSourceBridge(agentSource);
    const dispose = events.onAgentOutput(bridge.handle);
    const event = {
      kind: 'agent_output' as const,
      runId: 'run-1',
      envelope: {
        source: 'local' as const,
        eventType: 'assistant',
        timestamp: '2026-07-26T00:00:00.000Z',
        sessionId: null,
        agentId: null,
        payload: {},
      },
    };

    events.publish(event);
    expect(ingest).toHaveBeenCalledWith(event);

    dispose();
    events.publish(event);
    expect(ingest).toHaveBeenCalledOnce();
  });
});
