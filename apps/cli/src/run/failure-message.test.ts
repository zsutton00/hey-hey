import { describe, expect, it } from 'vitest';

import { ProjectAssistantPreparationError } from '../agents/project-assistant/nearest-parent-feature';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import { failureMessage, startupFailureCause } from './failure-message';

describe('startup failure message', () => {
  it('states the real cause of a preparation failure', () => {
    const cause = startupFailureCause(
      new ProjectAssistantPreparationError(
        'Project Assistant could not read parent feature f1: HTTP 403 from /features/f1.',
      ),
    );

    expect(failureMessage('STARTUP_FAILED', [], { cause, reference: 'run r1' })).toBe(
      [
        'The session could not start because its preparation failed.',
        '**Cause:** Project Assistant could not read parent feature f1: HTTP 403 from /features/f1.',
        '**Reference:** `run r1`',
        'Fix that, then send your message again.',
      ].join('\n\n'),
    );
  });

  it('never exposes the raw message of an unclassified error', () => {
    const cause = startupFailureCause(new TypeError('token sk-secret in url'));

    expect(cause).toBe('Unexpected TypeError while preparing the session.');
  });

  it('reports the error code for API failures', () => {
    const cause = startupFailureCause(new LocalAgentApiError('INTERNAL', 'Boom', 500));

    expect(cause).toBe('Boom (INTERNAL)');
  });
});
