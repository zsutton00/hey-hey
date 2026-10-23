import { describe, expect, it, vi } from 'vitest';
import { RUN_CONFORMANCE_PROTOCOL } from '../conformance/protocol';
import { DeterministicE2ERunner } from './deterministic-e2e-runner';

describe('DeterministicE2ERunner', () => {
  it('emits scripted output through the owning Run callback in order', async () => {
    const onAgentOutput = vi.fn();
    const complete = vi.fn();
    const runner = new DeterministicE2ERunner(
      {
        run: { runId: 'run-1', onAgentOutput, setHasProviderSession: vi.fn() },
      } as never,
      {
        claim: () => ({
          protocol: RUN_CONFORMANCE_PROTOCOL,
          name: 'ordered',
          expectedFinal: {},
          commands: [
            { kind: 'emit', output: { kind: 'assistant_delta', text: 'one' } },
            { kind: 'emit', output: { kind: 'assistant_complete', text: 'two' } },
          ],
        }),
        recordOutput: vi.fn(),
        complete,
      } as never,
    );
    await runner.run(new AbortController().signal);
    expect(onAgentOutput.mock.calls.map(([message]) => message.event.payload.summary)).toEqual([
      'one',
      'two',
    ]);
    expect(complete).toHaveBeenCalledWith('run-1');
  });

  it('rejects commands outside the browser-provider subset', async () => {
    const runner = new DeterministicE2ERunner(
      { run: { runId: 'run-1' } } as never,
      {
        claim: () => ({
          protocol: RUN_CONFORMANCE_PROTOCOL,
          name: 'invalid',
          expectedFinal: {},
          commands: [{ kind: 'cancel' }],
        }),
      } as never,
    );
    await expect(runner.run(new AbortController().signal)).rejects.toThrow(/Unexpected/);
  });
});
