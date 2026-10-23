import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeWalkthroughExcerpt } from '../../shared/api';
import { verifyWalkthroughExcerpt, verifyChangeWalkthrough, walkthroughServiceRoot } from './change-walkthrough-sources';
import { createTestRun } from '../../run/run.test-support';

const serviceId = '11111111-1111-4111-8111-111111111111';
const targetRunId = '22222222-2222-4222-8222-222222222222';
const checkedAt = '2026-10-15T00:00:00Z';
const excerpt: ChangeWalkthroughExcerpt = {
  serviceId,
  file: 'policy.ts',
  startLine: 1,
  endLine: 1,
  language: 'typescript',
  code: 'allow = false;',
  sourceVersion: { kind: 'WORKSPACE' },
  verification: { status: 'VERIFIED', checkedAt },
};
const roots: string[] = [];
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-'));
  roots.push(root);
  await writeFile(path.join(root, 'policy.ts'), excerpt.code + '\n');
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('walkthrough sources', () => {
  it('never falls back to a host checkout when a worktree session has missing resolved state', () => {
    expect(
      walkthroughServiceRoot(
        {
          agentic_session_id: targetRunId,
          services: [{ id: serviceId, path: '/host' }],
          worktree: { enabled: true },
        },
        serviceId,
      ),
    ).toBeNull();
  });

  it('checks literal inclusive lines and rejects changed, escaping and missing sources independently', async () => {
    const root = await workspace();
    const outside = await workspace();
    await symlink(path.join(outside, 'policy.ts'), path.join(root, 'escape.ts'));
    const results = await Promise.all([
      verifyWalkthroughExcerpt(excerpt, root, checkedAt),
      verifyWalkthroughExcerpt({ ...excerpt, code: 'invented' }, root, checkedAt),
      verifyWalkthroughExcerpt({ ...excerpt, file: '../policy.ts' }, root, checkedAt),
      verifyWalkthroughExcerpt({ ...excerpt, file: 'escape.ts' }, root, checkedAt),
      verifyWalkthroughExcerpt({ ...excerpt, endLine: 2 }, root, checkedAt),
      verifyWalkthroughExcerpt(excerpt, null, checkedAt),
    ]);
    expect(results.map((result) => result.verification.status)).toEqual([
      'VERIFIED',
      'UNRESOLVED',
      'UNRESOLVED',
      'UNRESOLVED',
      'UNRESOLVED',
      'UNRESOLVED',
    ]);
  });

  it('verifies historical code against an immutable commit rather than current content', async () => {
    const root = await workspace();
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'policy.ts'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'initial'],
      { cwd: root },
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    await writeFile(path.join(root, 'policy.ts'), 'allow = true;\n');
    expect(
      (
        await verifyWalkthroughExcerpt(
          { ...excerpt, sourceVersion: { kind: 'GIT', revision } },
          root,
          checkedAt,
        )
      ).verification.status,
    ).toBe('VERIFIED');
    expect((await verifyWalkthroughExcerpt(excerpt, root, checkedAt)).verification.status).toBe(
      'UNRESOLVED',
    );
  });

  it('stamps target identity, uses worktrees, and preserves ordered multi-file changes with one invalid source', async () => {
    const host = await workspace();
    const worktree = await workspace();
    await writeFile(path.join(host, 'policy.ts'), 'wrong checkout\n');
    await mkdir(path.join(worktree, 'src'));
    await writeFile(path.join(worktree, 'src/consumer.ts'), 'checkPermission();\n');
    const session = createTestRun().session;
    session.agentic_session_id = targetRunId;
    session.services = [{ id: serviceId, path: host }];
    session.worktreeState = {
      [serviceId]: { worktreePath: worktree, repoPath: host, branch: 'test' },
    };
    const result = await verifyChangeWalkthrough(
      {
        reportType: 'CHANGE_WALKTHROUGH',
        targetRunId: serviceId,
        summary: 'Important behavior first',
        groups: [
          {
            title: 'Permission behavior',
            changes: [
              {
                title: 'Deny by default',
                context: 'One policy feeds the consumer',
                walkthrough: [
                  { excerpt, explanation: 'A small change controls authorization' },
                  {
                    excerpt: { ...excerpt, file: 'src/consumer.ts', code: 'checkPermission();' },
                    explanation: 'The consumer enforces it',
                  },
                  {
                    excerpt: { ...excerpt, file: 'missing.ts' },
                    explanation: 'Unavailable supporting evidence',
                  },
                ],
                behavioralConsequence: 'Unauthorized access is denied',
              },
            ],
          },
          { title: 'Supporting changes', changes: [] },
        ],
      },
      session,
      checkedAt,
    );
    expect(result.targetRunId).toBe(targetRunId);
    expect(result.groups.map((g) => g.title)).toEqual([
      'Permission behavior',
      'Supporting changes',
    ]);
    expect(
      result.groups[0]?.changes[0]?.walkthrough.map((s) => s.excerpt.verification.status),
    ).toEqual(['VERIFIED', 'VERIFIED', 'UNRESOLVED']);
  });
});
