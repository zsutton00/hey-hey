import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoMappingNotFoundError } from '../errors';
import { RepoMappingStore } from '../store';
import { toServiceId } from '../types';

const tempDir = path.join(process.cwd(), 'tmp-repo-store-test');
const configDir = path.join(tempDir, 'config');

const createRepo = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), '{"name":"svc"}', 'utf8');
};

describe('repo mapping store', () => {
  beforeEach(async () => {
    process.env['HEYHEY_REPO_DIR'] = configDir;
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env['HEYHEY_REPO_DIR'];
  });

  it('persists and reloads a marker-free Service directory binding', async () => {
    const repoA = path.join(tempDir, 'repo-a');
    await fs.mkdir(repoA);

    const store = new RepoMappingStore();
    const saved = await store.setBinding(toServiceId('svc-1'), repoA);

    expect(saved.serviceId).toBe('svc-1');
    expect(saved.repositoryPath).toBe(repoA);

    const reloadedStore = new RepoMappingStore();
    const loaded = await reloadedStore.getBinding(toServiceId('svc-1'));
    expect(loaded?.repositoryPath).toBe(repoA);
  });

  it('handles concurrent writes safely', async () => {
    const repoPaths = Array.from({ length: 6 }, (_, index) =>
      path.join(tempDir, `repo-${String(index + 1)}`),
    );
    await Promise.all(repoPaths.map((repoPath) => createRepo(repoPath)));

    const store = new RepoMappingStore();

    await Promise.all(
      repoPaths.map((repoPath, index) =>
        store.setBinding(toServiceId(`svc-${String(index + 1)}`), repoPath),
      ),
    );

    const mappings = await store.listBindings();
    expect(mappings).toHaveLength(6);
  });

  it('removes mappings and throws when resolving missing services', async () => {
    const repoA = path.join(tempDir, 'repo-a');
    await createRepo(repoA);

    const store = new RepoMappingStore();
    await store.setBinding(toServiceId('svc-1'), repoA);

    const removed = await store.removeBinding(toServiceId('svc-1'));
    expect(removed).toBe(true);

    await expect(store.resolvePathForService(toServiceId('svc-1'))).rejects.toBeInstanceOf(
      RepoMappingNotFoundError,
    );
  });
});
