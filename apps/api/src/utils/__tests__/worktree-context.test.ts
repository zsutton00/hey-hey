import {
  createWorktreeDatabaseName,
  hasGitMetadata,
  normalizeWorkspaceId,
} from '../worktree-context';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('worktree context', () => {
  it('normalizes workspace IDs for PostgreSQL identifiers', () => {
    expect(normalizeWorkspaceId('Feature/My long-branch')).toBe(
      'feature_my_long_branch',
    );
  });

  it('creates stable collision-resistant database names within PostgreSQL limits', () => {
    const workspaceId = `Feature/${'very-long-name-'.repeat(8)}`;
    const first = createWorktreeDatabaseName(workspaceId);
    const second = createWorktreeDatabaseName(workspaceId);

    expect(first).toBe(second);
    expect(first).toMatch(/^hey_hey_wt_[a-z0-9_]+_[a-f0-9]{8}$/);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(createWorktreeDatabaseName('feature-a')).not.toBe(
      createWorktreeDatabaseName('feature_a'),
    );
  });

  it('rejects workspace IDs without database-safe characters', () => {
    expect(() => normalizeWorkspaceId('---')).toThrow(
      'has no database-safe characters',
    );
  });

  it('finds Git metadata from nested checkout directories', () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'worktree-context-'));
    const nestedDirectory = join(repositoryRoot, 'src', 'nested');
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(repositoryRoot, '.git'), 'gitdir: elsewhere');

    expect(hasGitMetadata(nestedDirectory)).toBe(true);
    expect(hasGitMetadata(tmpdir())).toBe(false);
  });
});
