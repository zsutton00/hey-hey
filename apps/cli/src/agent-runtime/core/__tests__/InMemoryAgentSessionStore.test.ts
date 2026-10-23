import { describe, expect, it } from 'vitest';
import { InMemoryAgentSessionStore } from '../InMemoryAgentSessionStore';
import { toAgentSessionId } from '../types';

describe('InMemoryAgentSessionStore', () => {
  it('persists and retrieves session metadata', async () => {
    const store = new InMemoryAgentSessionStore();
    const sessionId = toAgentSessionId('sess-1');

    await store.persist(sessionId, {
      adapter: 'claude',
      createdAt: 123,
    });

    await expect(store.retrieve(sessionId)).resolves.toEqual({
      adapter: 'claude',
      createdAt: 123,
    });
    expect(store.listSessionIds()).toEqual([sessionId]);
  });

  it('clears stored sessions', async () => {
    const store = new InMemoryAgentSessionStore();
    const sessionId = toAgentSessionId('sess-2');
    await store.persist(sessionId, {
      adapter: 'codex',
      createdAt: 999,
    });

    store.clear();

    await expect(store.retrieve(sessionId)).resolves.toBeNull();
    expect(store.listSessionIds()).toHaveLength(0);
  });
});
