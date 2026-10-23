import { describe, expect, it } from 'vitest';
import { AgentSessionRunnerError } from './session-runner';

describe('AgentSessionRunnerError', () => {
  it('preserves the RUN_BUSY code recognized by the runner contract', () => {
    const error = new AgentSessionRunnerError('RUN_BUSY', 'A turn is already running.');

    expect(error.code).toBe('RUN_BUSY');
    expect(error.name).toBe('AgentSessionRunnerError');
  });
});
