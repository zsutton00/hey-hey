import { describe, expect, it } from 'vitest';

import { classifyCodexEventRoute } from './codex-root-turn-event-gate';

describe('classifyCodexEventRoute', () => {
  it('accepts the client-owned root identity and rejects descendant completion candidates', () => {
    const root = { threadId: 'root-thread', turnId: 'root-turn' };

    expect(classifyCodexEventRoute(null, { threadId: 'root-thread', turnId: null })).toBe(
      'unresolved',
    );
    expect(classifyCodexEventRoute(root, { threadId: 'root-thread', turnId: 'root-turn' })).toBe(
      'root',
    );
    expect(classifyCodexEventRoute(root, { threadId: 'child-thread', turnId: 'child-turn' })).toBe(
      'descendant',
    );
    expect(classifyCodexEventRoute(root, { threadId: 'root-thread', turnId: 'root-turn' })).toBe(
      'root',
    );
  });

  it('does not let a stale same-thread turn redefine the client-owned root turn', () => {
    const root = { threadId: 'root-thread', turnId: 'new-root-turn' };

    expect(
      classifyCodexEventRoute(root, { threadId: 'root-thread', turnId: 'previous-turn' }),
    ).toBe('descendant');
    expect(
      classifyCodexEventRoute(root, { threadId: 'root-thread', turnId: 'new-root-turn' }),
    ).toBe('root');
  });

  it('leaves routed events unresolved until the client establishes the root turn', () => {
    expect(
      classifyCodexEventRoute(null, { threadId: 'root-thread', turnId: 'previous-turn' }),
    ).toBe('unresolved');
    expect(
      classifyCodexEventRoute(
        { threadId: 'root-thread', turnId: 'root-turn' },
        { threadId: null, turnId: null },
      ),
    ).toBe('unresolved');
  });
});
