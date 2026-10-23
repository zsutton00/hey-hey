import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoMappingStore } from './store';
import { toServiceId } from './types';

const tempDirectories: string[] = [];

const createStore = async (): Promise<{ store: RepoMappingStore; repositoryPath: string }> => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-repo-observable-'));
  tempDirectories.push(baseDir);
  const repositoryPath = path.join(baseDir, 'repository');
  await fs.mkdir(repositoryPath);
  await fs.writeFile(path.join(repositoryPath, 'package.json'), '{"name":"test"}', 'utf8');
  const canonicalRepositoryPath = await fs.realpath(repositoryPath);
  return {
    store: new RepoMappingStore({
      mappingPath: path.join(baseDir, 'repos.json'),
      lockPath: path.join(baseDir, 'repos.lock'),
    }),
    repositoryPath: canonicalRepositoryPath,
  };
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('RepoMappingStore changes', () => {
  it('notifies listeners on setBinding', async () => {
    const { store, repositoryPath } = await createStore();
    const listener = vi.fn();
    store.onChange(listener);

    await store.setBinding(toServiceId('svc-1'), repositoryPath);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners when removeBinding actually removes something', async () => {
    const { store, repositoryPath } = await createStore();
    await store.setBinding(toServiceId('svc-1'), repositoryPath);
    const listener = vi.fn();
    store.onChange(listener);

    const removed = await store.removeBinding(toServiceId('svc-1'));

    expect(removed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when removeBinding removes nothing', async () => {
    const { store } = await createStore();
    const listener = vi.fn();
    store.onChange(listener);

    const removed = await store.removeBinding(toServiceId('svc-1'));

    expect(removed).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after the listener unsubscribes', async () => {
    const { store, repositoryPath } = await createStore();
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);

    unsubscribe();
    await store.setBinding(toServiceId('svc-1'), repositoryPath);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify for reads', async () => {
    const { store, repositoryPath } = await createStore();
    await store.setBinding(toServiceId('svc-1'), repositoryPath);
    const listener = vi.fn();
    store.onChange(listener);

    await expect(store.listBindings()).resolves.toHaveLength(1);
    await expect(store.resolvePathForService(toServiceId('svc-1'))).resolves.toBe(repositoryPath);
    expect(listener).not.toHaveBeenCalled();
  });
});
