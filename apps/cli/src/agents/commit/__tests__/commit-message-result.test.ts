import { describe, expect, it } from 'vitest';

import { CommitMessageResultStore } from '../commit-message-result';

describe('CommitMessageResultStore', () => {
  it('accepts and consumes one schema-valid message', async () => {
    const store = new CommitMessageResultStore();
    expect(
      store.tool.execute({ runId: 'run-1', args: { message: 'fix: validate commit scope' } }),
    ).toEqual({ content: [{ type: 'text', text: 'Commit message accepted.' }] });
    expect(store.consume('run-1')).toBe('fix: validate commit scope');
    expect(store.consume('run-1')).toBeNull();
  });

  it('rejects multiline messages and runtime-owned trailers', () => {
    const store = new CommitMessageResultStore();
    expect(() =>
      store.tool.execute({ runId: 'run-1', args: { message: 'fix: subject\nbody' } }),
    ).toThrow('single line');
    expect(() =>
      store.tool.execute({ runId: 'run-1', args: { message: 'Task-Id: caller-owned' } }),
    ).toThrow('runtime-owned trailers');
    expect(() =>
      store.tool.execute({ runId: 'run-1', args: { message: 'Service-Id: caller-owned' } }),
    ).toThrow('runtime-owned trailers');
  });
});
