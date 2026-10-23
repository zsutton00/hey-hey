import { describe, expect, it } from 'vitest';

import type { LocalCommitPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import type { Prepared } from '../../../shared/agent-bridge-contract/contract';
import { buildCommitPrompt } from '../commit-prompt';

const payload: Prepared<LocalCommitPromptPayload> = {
  changedFiles: ['/repo/src/foo.ts', '/repo/src/bar.ts'],
  taskId: 'caller-task-id-is-advisory',
  codingSessionId: 'caller-session-id-is-advisory',
  userMessage: '',
  services: [{ id: 'service-cli', path: '/repo' }],
};

describe('buildCommitPrompt', () => {
  it('snapshots the complete message-only agent contract', () => {
    expect(buildCommitPrompt(payload)).toMatchSnapshot();
  });

  it('snapshots the empty-scope contract', () => {
    expect(buildCommitPrompt({ ...payload, changedFiles: [] })).toMatchSnapshot();
  });
});
