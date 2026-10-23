import { describe, expect, it } from 'vitest';
import type { AgenticSession, AgenticSessionContextMetadata } from '../session/types';
import {
  groupFileChangeProjectionsByService,
  isConservativePathCorrection,
  latestFileChangeFacts,
  projectFileChanges,
  resolveRunFilePath,
  type CanonicalFileChangeFact,
} from './file-change-facts';

const makeSession = (): AgenticSession => ({
  entity: null,
  agentic_session_id: 'run-1',
  services: [
    { id: 'service-a', path: '/repos/a' },
    { id: 'service-b', path: '/repos/b' },
  ],
  launchServiceId: 'service-a',
  provider: 'codex',
  provider_session_id: 'provider-1',
  provider_conversation_id: 'thread-1',
  status: 'running',
  conversationId: 'conversation-1',
  contextMetadata: {} as AgenticSessionContextMetadata,
  worktreeState: {
    'service-a': { repoPath: '/repos/a', worktreePath: '/worktrees/a', branch: 'feature' },
    'service-b': { repoPath: '/repos/b', worktreePath: '/worktrees/b', branch: 'feature' },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  events: [],
});

const fact = (overrides: Partial<CanonicalFileChangeFact>): CanonicalFileChangeFact => ({
  factId: 'fact-1',
  runId: 'run-1',
  turnId: 'turn-1',
  provider: 'codex',
  providerSessionId: 'provider-1',
  providerThreadId: 'thread-1',
  providerTurnId: 'provider-turn-1',
  serviceId: 'service-a',
  repoRelativePath: 'src/a.ts',
  occurredAt: '2026-01-01T00:00:00.000Z',
  evidence: { kind: 'baseline', diff: '', baselineContent: null, postContent: 'a' },
  ...overrides,
});

describe('canonical file-change facts', () => {
  it.each([
    ['tests/feature.ts', '__tests__/feature.tsx', true],
    ['src/featur.ts', 'src/feature.ts', true],
    ['src/feature.ts', 'other/feature.ts', false],
    ['src/a.ts', 'src/completely-different.ts', false],
  ])('bounds conservative path correction from %s to %s', (claim, candidate, expected) => {
    expect(isConservativePathCorrection(claim, candidate)).toBe(expected);
  });
  it('resolves relative paths against the launch-service worktree', () => {
    expect(resolveRunFilePath(makeSession(), 'src/a.ts')).toEqual({
      serviceId: 'service-a',
      repositoryRoot: '/worktrees/a',
      absolutePath: '/worktrees/a/src/a.ts',
      repoRelativePath: 'src/a.ts',
    });
  });

  it('resolves absolute paths to the owning service and rejects out-of-root paths', () => {
    expect(resolveRunFilePath(makeSession(), '/worktrees/b/src/b.ts')?.serviceId).toBe('service-b');
    expect(resolveRunFilePath(makeSession(), '/tmp/unrelated.ts')).toBeNull();
    expect(resolveRunFilePath(makeSession(), '../../outside.ts')).toBeNull();
  });

  it('builds per-turn and cumulative projections without duplicate membership', () => {
    const facts = [
      fact({ factId: 'one' }),
      fact({
        factId: 'two',
        evidence: { kind: 'baseline', diff: '', baselineContent: 'a', postContent: 'b' },
      }),
      fact({ factId: 'three', turnId: 'turn-2', repoRelativePath: 'src/b.ts' }),
    ];
    expect(projectFileChanges(facts)).toEqual([
      { serviceId: 'service-a', repoRelativePath: 'src/a.ts' },
      { serviceId: 'service-a', repoRelativePath: 'src/b.ts' },
    ]);
    expect(projectFileChanges(facts, 'turn-1')).toEqual([
      { serviceId: 'service-a', repoRelativePath: 'src/a.ts' },
    ]);
    expect(latestFileChangeFacts(facts).map((entry) => entry.factId)).toEqual(['two', 'three']);
  });

  it('groups canonical projections by service without conflating duplicate repo-relative paths', () => {
    expect(
      groupFileChangeProjectionsByService([
        { serviceId: 'service-b', repoRelativePath: 'src/shared.ts' },
        { serviceId: 'service-a', repoRelativePath: 'src/shared.ts' },
        { serviceId: 'service-a', repoRelativePath: 'src/a.ts' },
        { serviceId: 'service-a', repoRelativePath: 'src/a.ts' },
      ]),
    ).toEqual([
      { serviceId: 'service-a', filesChanged: ['src/a.ts', 'src/shared.ts'] },
      { serviceId: 'service-b', filesChanged: ['src/shared.ts'] },
    ]);
  });
});
