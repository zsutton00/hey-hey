import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverRepositories,
  resolveCanonicalDirectory,
  resolveRepositoryPath,
} from '../discovery';
import {
  RepoPathNotDirectoryError,
  RepoPathNotFoundError,
  RepoPathNotReadableError,
} from '../errors';

const tempDir = path.join(process.cwd(), 'tmp-repo-discovery-test');
const execFileAsync = promisify(execFile);
const supportsPermissionTests = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('repo discovery', () => {
  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('discovers marker-based repositories in subdirectories', async () => {
    const serviceDir = path.join(tempDir, 'service-a');
    await fs.mkdir(serviceDir, { recursive: true });
    await fs.writeFile(path.join(serviceDir, 'package.json'), '{"name":"service-a"}', 'utf8');

    const candidates = await discoverRepositories({ cwd: tempDir, maxDepth: 2 });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((candidate) => candidate.canonicalPath === serviceDir)).toBe(true);
  });

  it('resolves symlinked repository paths to canonical paths', async () => {
    const realRepoDir = path.join(tempDir, 'real-repo');
    const linkDir = path.join(tempDir, 'repo-link');

    await fs.mkdir(realRepoDir, { recursive: true });
    await fs.writeFile(
      path.join(realRepoDir, 'pyproject.toml'),
      '[project]\nname = "svc"\n',
      'utf8',
    );
    await fs.symlink(realRepoDir, linkDir);

    const resolved = await resolveRepositoryPath('./repo-link', { cwd: tempDir });

    expect(resolved.canonicalPath).toBe(realRepoDir);
    expect(resolved.markers).toContain('pyproject.toml');
  });

  it('resolves an empty non-Git directory without requiring repository markers', async () => {
    const emptyDirectory = path.join(tempDir, 'empty-service-directory');
    await fs.mkdir(emptyDirectory);

    await expect(resolveCanonicalDirectory(emptyDirectory)).resolves.toBe(
      await fs.realpath(emptyDirectory),
    );
  });

  it('preserves the exact nested directory selected inside a Git repository', async () => {
    const repositoryDirectory = path.join(tempDir, 'repository');
    const nestedDirectory = path.join(repositoryDirectory, 'packages', 'service-a');
    await fs.mkdir(nestedDirectory, { recursive: true });
    await execFileAsync('git', ['init', '--quiet', repositoryDirectory]);

    await expect(resolveCanonicalDirectory(nestedDirectory)).resolves.toBe(
      await fs.realpath(nestedDirectory),
    );
  });

  it('rejects a missing directory with a directory-specific error', async () => {
    const missingDirectory = path.join(tempDir, 'missing');

    await expect(resolveCanonicalDirectory(missingDirectory)).rejects.toMatchObject({
      constructor: RepoPathNotFoundError,
      message: `Selected directory does not exist: ${missingDirectory}`,
    });
  });

  it('rejects a selected file because it is not a directory', async () => {
    const filePath = path.join(tempDir, 'service.txt');
    await fs.writeFile(filePath, 'not a directory', 'utf8');

    await expect(resolveCanonicalDirectory(filePath)).rejects.toMatchObject({
      constructor: RepoPathNotDirectoryError,
      message: `Selected path is not a directory: ${filePath}`,
    });
  });

  it.skipIf(!supportsPermissionTests)(
    'rejects a directory that is not readable and traversable',
    async () => {
      const inaccessibleDirectory = path.join(tempDir, 'inaccessible');
      await fs.mkdir(inaccessibleDirectory);
      await fs.chmod(inaccessibleDirectory, 0o000);

      try {
        await expect(resolveCanonicalDirectory(inaccessibleDirectory)).rejects.toMatchObject({
          constructor: RepoPathNotReadableError,
          message: `Selected directory is not readable and traversable: ${inaccessibleDirectory}`,
        });
      } finally {
        await fs.chmod(inaccessibleDirectory, 0o700);
      }
    },
  );
});
