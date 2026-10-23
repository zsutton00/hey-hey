import { describe, expect, it, vi } from 'vitest';
import { RunStore } from '../../run-store';
import { ConversationRunResolver } from './conversation-run-resolver';
import { StructuredServerLogger } from '../logger';

const makeRunStore = (): RunStore => Object.create(RunStore.prototype) as RunStore;

describe('ConversationRunResolver', () => {
  it.each([true, false])(
    'keeps missing metadata temporarily unavailable (indexed: %s)',
    async (indexed) => {
      const store = makeRunStore();
      vi.spyOn(store, 'lookupByConversationId').mockReturnValue(indexed ? 'run-1' : null);
      vi.spyOn(store, 'lookupByAgentSessionId').mockReturnValue('run-1');
      vi.spyOn(store, 'getRunMetadata').mockResolvedValue(null);
      const history = vi.spyOn(store, 'getRun');
      expect(await new ConversationRunResolver(store).resolve('conversation', 'session')).toEqual({
        status: 'temporarily_unavailable',
        reason: indexed ? 'indexed_run_not_available' : 'agent_session_run_not_available',
      });
      expect(history).not.toHaveBeenCalled();
    },
  );

  it('records correlated timings for delayed metadata and failed storage, without reading history', async () => {
    const store = makeRunStore();
    vi.spyOn(store, 'lookupByConversationId').mockReturnValue('run-1');
    const metadata = vi.spyOn(store, 'getRunMetadata').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { contextMetadata: { agentSessionId: 'session' } } as never;
    });
    const history = vi.spyOn(store, 'getRun');
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'debug',
      writeLine: (line) => lines.push(line),
    });
    const resolver = new ConversationRunResolver(store, logger);
    expect(await resolver.resolve('conversation', 'other-session')).toEqual({
      status: 'rejected',
      reason: 'agent_session_mismatch',
    });
    expect(
      lines.some(
        (line) =>
          line.includes('run_lookup.completed') &&
          line.includes('agent_session_mismatch') &&
          line.includes('elapsedMs'),
      ),
    ).toBe(true);
    metadata.mockRejectedValue(new Error('storage failure'));
    await expect(resolver.resolve('conversation', 'session')).rejects.toThrow('storage failure');
    expect(
      lines.some((line) => line.includes('run_lookup.failed') && line.includes('conversation')),
    ).toBe(true);
    expect(history).not.toHaveBeenCalled();
  });

  it('resolves the canonical Task Monitor conversation to its coordinator Run and Agent Session', async () => {
    const runStore = makeRunStore();
    vi.spyOn(runStore, 'lookupByConversationId').mockReturnValue('run-1');
    vi.spyOn(runStore, 'getRunMetadata').mockResolvedValue({
      contextMetadata: { agentSessionId: 'agent-session-1' },
    } as never);
    const resolver = new ConversationRunResolver(runStore);

    await expect(resolver.resolve('task-monitor-conversation', 'agent-session-1')).resolves.toEqual(
      {
        status: 'resolved',
        runId: 'run-1',
        conversationId: 'task-monitor-conversation',
        agentSessionId: 'agent-session-1',
      },
    );
    expect(resolver.resolveForDispatch('task-monitor-conversation')).toEqual({
      status: 'resolved',
      runId: 'run-1',
      conversationId: 'task-monitor-conversation',
    });
  });

  it('resolves from the expected Agent Session when its direct conversation index is rebuilding', async () => {
    const runStore = makeRunStore();
    vi.spyOn(runStore, 'lookupByConversationId').mockReturnValue(null);
    vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue('run-1');
    vi.spyOn(runStore, 'getRunMetadata').mockResolvedValue({
      contextMetadata: { agentSessionId: 'agent-session-1' },
      conversationId: 'task-monitor-conversation',
    } as never);

    await expect(
      new ConversationRunResolver(runStore).resolve('task-monitor-conversation', 'agent-session-1'),
    ).resolves.toEqual({
      status: 'resolved',
      runId: 'run-1',
      conversationId: 'task-monitor-conversation',
      agentSessionId: 'agent-session-1',
    });
  });

  it('rejects a conversation that differs from the Agent Session conversation', async () => {
    const runStore = makeRunStore();
    vi.spyOn(runStore, 'lookupByConversationId').mockReturnValue(null);
    vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue('run-1');
    vi.spyOn(runStore, 'getRunMetadata').mockResolvedValue({
      contextMetadata: { agentSessionId: 'agent-session-1' },
      conversationId: 'canonical-conversation',
    } as never);

    await expect(
      new ConversationRunResolver(runStore).resolve('unrelated-conversation', 'agent-session-1'),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'agent_session_conversation_mismatch',
    });
  });

  it('rejects a follow-up whose start failed for a missing folder, and keeps other gaps retryable', async () => {
    const store = makeRunStore();
    vi.spyOn(store, 'lookupByConversationId').mockReturnValue(null);
    vi.spyOn(store, 'lookupByAgentSessionId').mockReturnValue(null);
    const lookup = vi.fn().mockResolvedValueOnce(['service-1']).mockResolvedValue(null);
    const resolver = new ConversationRunResolver(store, undefined, lookup);

    expect(await resolver.resolve('conversation', 'session')).toEqual({
      status: 'rejected',
      reason: 'service_folder_not_bound',
      serviceIds: ['service-1'],
    });
    expect(lookup).toHaveBeenCalledWith('conversation', 'session');
    expect(await resolver.resolve('conversation')).toEqual({
      status: 'temporarily_unavailable',
      reason: 'conversation_binding_not_available',
    });
  });
});
