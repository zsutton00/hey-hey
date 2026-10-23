import { describe, expect, it } from 'vitest';
import type { AgenticSession } from '../../session/types';
import type { LocalDebugPromptPayload } from '../../shared/agent-bridge-contract/index';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { debugHandler } from './debug.handler';

describe('debugHandler worktree Services context', () => {
  it('uses the Run-owned worktree projection instead of host checkout paths', async () => {
    const run = {
      agentic_session_id: 'run-debug-1',
      services: [
        { id: 'service-a', path: '/host/service-a' },
        { id: 'service-b', path: '/host/service-b' },
      ],
      launchServiceId: 'service-b',
      worktreeState: {
        'service-a': {
          repoPath: '/host/service-a',
          worktreePath: '/worktrees/service-a',
          branch: 'feature/worktrees',
        },
        'service-b': {
          repoPath: '/host/service-b',
          worktreePath: '/worktrees/service-b',
          branch: 'feature/worktrees',
        },
      },
    } as unknown as AgenticSession;
    const payload = {
      userMessage: '',
      startupInput: {
        task: {
          id: 'task-1',
          title: 'Debug worktree prompts',
          taskType: 'BUG',
          description: 'Diagnose the prompt workspace.',
        },
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
    } as LocalDebugPromptPayload;

    const prepare = debugHandler.prepare;
    expect(prepare).toBeDefined();
    if (!prepare) return;
    const prepared = await prepare(run, payload, createPromptTypeHandlerTestDeps());
    const prompt = debugHandler.buildPrompt(prepared.payload);

    expect(prompt).toContain('Launch service `service-b` at `/worktrees/service-b`');
    expect(prompt).toContain('`service-a` at `/worktrees/service-a`');
    expect(prompt).not.toContain('/host/service-a');
    expect(prompt).not.toContain('/host/service-b');
  });
});
