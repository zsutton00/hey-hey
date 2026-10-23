import { describe, expect, it } from 'vitest';
import type { LocalQuickPromptPayload } from '../../../shared/agent-bridge-contract/index';
import { quickHandler } from '../quick.handler';

const makePayload = (
  overrides: Partial<LocalQuickPromptPayload> = {},
): LocalQuickPromptPayload => ({
  startupInput: {
    task: {
      id: 'task-1',
      title: 'Rename the mode',
      taskType: 'STANDARD',
      description: 'Change the user-facing session method copy.',
      acceptanceCriteria: 'The launch prompt contains task context.',
    },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  userMessage: 'Please implement this directly.',
  ...overrides,
});

describe('quickHandler', () => {
  it('registers as the stable quick provider-session handler', () => {
    expect(quickHandler.promptType).toBe('quick');
    expect(quickHandler.runnerKind).toBe('provider_session');
  });

  it('requires changed-file reporting through report_changed_files', () => {
    expect(quickHandler.requiresChangedFileReporting).toBe(true);
    expect(quickHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'report_changed_files',
    ]);
    expect(quickHandler.buildPrompt(makePayload())).toContain('report_changed_files');
  });

  it('does not declare a startup report workflow or extra setup contract', async () => {
    const payload = makePayload();
    const prepare = quickHandler.prepare;
    if (!prepare) throw new Error('expected quick handler prepare hook');

    await expect(
      prepare(
        { agentic_session_id: 'session-1', services: [] } as unknown as Parameters<
          typeof prepare
        >[0],
        payload,
        {} as Parameters<typeof prepare>[2],
      ),
    ).resolves.toEqual({ payload });
    expect(quickHandler.reports).toEqual([]);
  });

  it('projects every Run Service and its authoritative worktree into the prompt', async () => {
    const payload = makePayload();
    const prepare = quickHandler.prepare;
    if (!prepare) throw new Error('expected quick handler prepare hook');

    const prepared = await prepare(
      {
        agentic_session_id: 'session-1',
        services: [
          { id: 'service-a', path: '/host/service-a' },
          { id: 'service-b', path: '/host/service-b' },
        ],
        launchServiceId: 'service-b',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/task-only',
          },
          'service-b': {
            repoPath: '/host/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/task-only',
          },
        },
      } as unknown as Parameters<typeof prepare>[0],
      payload,
      {} as Parameters<typeof prepare>[2],
    );

    const systemPrompt = quickHandler.buildPrompt(prepared.payload);

    expect(systemPrompt).toMatchSnapshot();
    expect(systemPrompt).toContain('## Services in scope');
    expect(systemPrompt).toContain('Launch service `service-b` at `/worktrees/service-b`');
    expect(systemPrompt).toContain('`service-a` at `/worktrees/service-a`');
    expect(systemPrompt).not.toContain('/host/service-a');
    expect(systemPrompt).not.toContain('/host/service-b');
  });

  it('fails closed when the Run has an incomplete worktree projection', async () => {
    const payload = makePayload();
    const prepare = quickHandler.prepare;
    if (!prepare) throw new Error('expected quick handler prepare hook');

    const prepared = await prepare(
      {
        agentic_session_id: 'session-1',
        services: [
          { id: 'service-a', path: '/host/service-a' },
          { id: 'service-b', path: '/host/service-b' },
        ],
        launchServiceId: 'service-a',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/task-only',
          },
        },
      } as unknown as Parameters<typeof prepare>[0],
      payload,
      {} as Parameters<typeof prepare>[2],
    );

    expect(() => quickHandler.buildPrompt(prepared.payload)).toThrow(
      'Worktree-backed Services context is incomplete; every in-scope Service requires an explicit worktree path.',
    );
  });

  it('leaves Task Only task context to the canonical provider projection', () => {
    const payload = makePayload();

    const systemPrompt = quickHandler.buildPrompt(payload);
    const appendedUserMessage = quickHandler.addUserMessage(payload);
    if (!appendedUserMessage) throw new Error('expected appended user message');
    const resolvedPrompt = `${systemPrompt}\n\n${appendedUserMessage}`;

    expect(systemPrompt).toContain('You are in a Task Only coding session.');
    expect(systemPrompt).toContain('## Repository edit authority');
    expect(systemPrompt).toContain('Mentions of a Service or repository');
    expect(systemPrompt).toContain(
      'do not authorize inspection, edits, commits, or mutating commands',
    );
    expect(systemPrompt).toContain(
      "requires that repository's explicit corresponding worktree path",
    );
    expect(systemPrompt).toContain('Never use, inspect, or edit its host or main checkout');
    expect(systemPrompt).toContain(
      "The user's kickoff prompt takes precedence. Treat the canonical focal entity projection as context for that prompt.",
    );
    expect(systemPrompt).toContain('canonical focal entity projection');
    expect(systemPrompt).not.toContain('Rename the mode');
    expect(systemPrompt).not.toContain('Change the user-facing session method copy.');
    expect(systemPrompt).not.toContain('The launch prompt contains task context.');

    expect(resolvedPrompt.indexOf('canonical focal entity projection')).toBeLessThan(
      resolvedPrompt.indexOf('Please implement this directly.'),
    );
  });

  it('does not render any copied task fields when acceptance criteria are absent', () => {
    const payload = makePayload({
      startupInput: {
        task: {
          id: 'task-2',
          title: 'Task without acceptance criteria',
          taskType: 'STANDARD',
          description: 'Still render the core task context.',
        },
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
    });

    const systemPrompt = quickHandler.buildPrompt(payload);

    expect(systemPrompt).not.toContain('Task without acceptance criteria');
    expect(systemPrompt).not.toContain('Still render the core task context.');
    expect(systemPrompt).not.toContain('acceptanceCriteria');
  });

  it('omits prompt precedence guidance when no kickoff prompt is defined', () => {
    const payload = makePayload({ userMessage: '' });

    const systemPrompt = quickHandler.buildPrompt(payload);

    expect(systemPrompt).not.toContain(
      "The user's kickoff prompt takes precedence. Treat the selected task below as context for that prompt.",
    );
  });
});
