import { describe, expect, it, vi } from 'vitest';

import { CommitHandler, decideReadOnlyCommitPermission } from '../commit/commit.handler';
import type { SubagentPermissionContext } from '../prompt-type-handler';
import { makeCreateReportProxy } from '../submission-tools/create-report-proxy.test-support';

const commitHandler = new CommitHandler(makeCreateReportProxy());

const decide = (toolName: string, input: Record<string, unknown>) =>
  decideReadOnlyCommitPermission({
    toolName,
    input,
    touchedFiles: ['/repo/src/a.ts'],
    touchedFilesSet: new Set(['/repo/src/a.ts']),
    allowedRepoRoots: new Set(['/repo']),
    logger: { warn: vi.fn() } as never,
    runId: 'run-1',
  } satisfies SubagentPermissionContext);

describe('commit agent policy', () => {
  it('exposes only the typed result tool plus read-only inspection tools', () => {
    expect(commitHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'submit_commit_message',
    ]);
    expect(commitHandler.subagentConfig?.builtinAllowedTools).toEqual(['Read', 'Bash']);
  });

  it('allows bounded reads and read-only git commands', async () => {
    await expect(decide('Read', { file_path: '/repo/src/a.ts' })).resolves.toEqual({
      behavior: 'allow',
    });
    await expect(decide('Bash', { command: 'git -C /repo diff -- src/a.ts' })).resolves.toEqual({
      behavior: 'allow',
    });
  });

  it('rejects git writes and reads outside canonical scope', async () => {
    await expect(decide('Bash', { command: 'git add src/a.ts' })).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(decide('Bash', { command: 'git commit -m nope' })).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(decide('Bash', { command: 'git -C /repo status' })).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(decide('Read', { file_path: '/repo/src/other.ts' })).resolves.toMatchObject({
      behavior: 'deny',
    });
  });

  it('rejects write-capable and external-helper options on read-only git subcommands', async () => {
    for (const command of [
      'git -C /repo diff --output=/tmp/leak -- src/a.ts',
      'git -C /repo diff --ext-diff -- src/a.ts',
      'git -C /repo diff --textconv -- src/a.ts',
      'git -C /repo log --output /tmp/leak',
      'git -C /repo show --output=/tmp/leak HEAD',
    ]) {
      await expect(decide('Bash', { command })).resolves.toMatchObject({
        behavior: 'deny',
      });
    }
  });
});
