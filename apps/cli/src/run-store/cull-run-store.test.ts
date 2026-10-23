/** @vitest-environment node */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateAgenticSessionInput } from '../session/types';
import { cullRunStore } from './cull-run-store';
import {
  legacyRunFamilyMemberFileName,
  RUN_FAMILY_MEMBERS,
  type RunFamilyMember,
} from './run-files';
import { RunStore } from './run-store';
import type { RunStorePaths } from './types';
import { RunAttachmentStore } from '../server/run-attachment-store';
import { randomUUID } from 'node:crypto';

const tempDirectories: string[] = [];

describe('staged attachment retention', () => {
  const cutoff = new Date('2026-07-01T00:00:00Z');
  const expired = new Date('2026-06-01T00:00:00Z');
  const setup = async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'staging-retention-'));
    tempDirectories.push(baseDir);
    const stage = async (modifiedAt = expired) => {
      const attachmentId = randomUUID();
      const directory = path.join(baseDir, 'run-attachments-staging', attachmentId);
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, 'notes.txt');
      await fs.writeFile(file, 'exact bytes');
      await fs.utimes(file, modifiedAt, modifiedAt);
      return { attachmentId, directory, file };
    };
    return { baseDir, stage };
  };
  it.each([false, true])(
    'previews and applies with runs directory present=%s',
    async (withRuns) => {
      const { baseDir, stage } = await setup();
      if (withRuns) await fs.mkdir(path.join(baseDir, 'runs'));
      const old = await stage();
      const equal = await stage(cutoff);
      const fresh = await stage(new Date('2026-08-01'));
      const preview = await cullRunStore({ baseDir, completedBefore: cutoff, retentionOnly: true });
      expect(preview.expiredStagedAttachmentCount).toBe(1);
      expect(preview.plannedPathCount).toBe(1);
      expect(preview.plannedLogicalBytes).toBe(11);
      expect(preview.entries).toEqual([
        {
          attachmentId: old.attachmentId,
          reason: 'expired_staged_attachment',
          paths: [old.directory],
          logicalBytes: 11,
          updatedAt: expired.toISOString(),
        },
      ]);
      expect(await fs.readFile(old.file, 'utf8')).toBe('exact bytes');
      const applied = await cullRunStore({
        baseDir,
        completedBefore: cutoff,
        apply: true,
        retentionOnly: true,
      });
      expect(applied.deletedPathCount).toBe(1);
      expect(applied.deletedLogicalBytes).toBe(11);
      expect(applied.expiredStagedAttachmentCount).toBe(1);
      await expect(fs.lstat(old.directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(equal.file, 'utf8')).toBe('exact bytes');
      expect(await fs.readFile(fresh.file, 'utf8')).toBe('exact bytes');
    },
  );
  it('preserves staging without a cutoff and directories containing fresh file data', async () => {
    const { baseDir, stage } = await setup();
    const old = await stage();
    const mixed = await stage();
    await fs.writeFile(path.join(mixed.directory, 'fresh.txt'), 'fresh');
    expect((await cullRunStore({ baseDir, apply: true })).expiredStagedAttachmentCount).toBe(0);
    await expect(fs.lstat(path.join(baseDir, 'runs'))).rejects.toMatchObject({ code: 'ENOENT' });
    const result = await cullRunStore({ baseDir, apply: true, completedBefore: cutoff });
    expect(result.expiredStagedAttachmentCount).toBe(1);
    expect(await fs.readFile(mixed.file, 'utf8')).toBe('exact bytes');
    await expect(fs.lstat(old.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('leaves bound files under completed-Run retention authority', async () => {
    const { baseDir } = await setup();
    const store = new RunAttachmentStore(baseDir);
    const attachment = await store.saveStaged(
      'notes.txt',
      Buffer.from('bound'),
      new AbortController().signal,
    );
    const runId = randomUUID();
    await store.bindStaged(runId, [attachment]);
    const file = (await store.resolvePaths(runId, [attachment]))[0]!;
    await fs.utimes(file, expired, expired);
    const result = await cullRunStore({ baseDir, completedBefore: cutoff, apply: true });
    expect(result.deletedPathCount).toBe(0);
    expect(await fs.readFile(file, 'utf8')).toBe('bound');
  });
  it('rechecks mtime and tolerates files moved during discovery', async () => {
    const { baseDir, stage } = await setup();
    const changed = await stage();
    const moved = await stage();
    const original = fs.lstat.bind(fs);
    let changedReads = 0;
    let movedReads = 0;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (args[0] === changed.file && ++changedReads === 2)
        await fs.utimes(changed.file, cutoff, cutoff);
      if (args[0] === moved.directory && ++movedReads === 2) {
        await fs.rename(moved.directory, path.join(baseDir, 'moved'));
      }
      return original(...args);
    });
    const result = await cullRunStore({
      baseDir,
      completedBefore: cutoff,
      apply: true,
      retentionOnly: true,
    });
    expect(result.plannedPathCount).toBe(2);
    expect(result.deletedPathCount).toBe(0);
    expect(await fs.readFile(changed.file, 'utf8')).toBe('exact bytes');
    expect(await fs.readFile(path.join(baseDir, 'moved', 'notes.txt'), 'utf8')).toBe('exact bytes');
  });
  it.each(['read', 'delete'])(
    'isolates a staging %s failure and safely diagnoses it',
    async (failure) => {
      const { baseDir, stage } = await setup();
      const bad = await stage();
      const healthy = await stage();
      const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (failure === 'read') {
        const original = fs.readdir.bind(fs);
        vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
          if (args[0] === bad.directory) throw new Error('private filesystem details');
          return original(...args);
        });
      } else {
        const original = fs.rm.bind(fs);
        vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
          if (args[0] === bad.directory) throw new Error('private filesystem details');
          return original(...args);
        });
      }
      const result = await cullRunStore({
        baseDir,
        completedBefore: cutoff,
        apply: true,
        retentionOnly: true,
      });
      expect(result.deletedPathCount).toBe(1);
      expect(await fs.readFile(bad.file, 'utf8')).toBe('exact bytes');
      await expect(fs.lstat(healthy.directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(logs).toHaveBeenCalled();
      expect(JSON.stringify(logs.mock.calls)).not.toContain('private filesystem details');
    },
  );
  it('preserves symlink directories, symlink files and unexpected nested layouts', async () => {
    const { baseDir, stage } = await setup();
    const outside = path.join(baseDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'untouched');
    await fs.utimes(path.join(outside, 'private.txt'), expired, expired);
    const linkedFile = await stage();
    await fs.symlink(path.join(outside, 'private.txt'), path.join(linkedFile.directory, 'link'));
    await fs.symlink(outside, path.join(baseDir, 'run-attachments-staging', randomUUID()));
    const nested = await stage();
    await fs.mkdir(path.join(nested.directory, 'nested'));
    const result = await cullRunStore({ baseDir, completedBefore: cutoff, apply: true });
    expect(result.deletedPathCount).toBe(0);
    expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe('untouched');
    const linkedRootBase = path.join(baseDir, 'linked-root-base');
    await fs.mkdir(linkedRootBase);
    await fs.symlink(
      path.join(baseDir, 'run-attachments-staging'),
      path.join(linkedRootBase, 'run-attachments-staging'),
    );
    expect(
      (await cullRunStore({ baseDir: linkedRootBase, completedBefore: cutoff, apply: true }))
        .deletedPathCount,
    ).toBe(0);
  });
});

const createPaths = (baseDir: string): RunStorePaths => ({
  baseDir,
  runsDir: path.join(baseDir, 'runs'),
  indexPath: path.join(baseDir, 'runs', 'run-index.json'),
  preferencesPath: path.join(baseDir, 'preferences.json'),
});

const createRunInput = (
  runId: string,
  status: 'idle' | 'running' | 'complete' = 'idle',
): CreateAgenticSessionInput => ({
  entity: null,
  agentic_session_id: runId,
  services: [{ id: 'service-1', path: '/repo' }],
  launchServiceId: 'service-1',
  provider: 'codex',
  provider_session_id: `provider-${runId}`,
  provider_conversation_id: `conversation-${runId}`,
  conversationId: `platform-conversation-${runId}`,
  status,
  contextMetadata: {
    capturedAt: '2026-07-20T00:00:00.000Z',
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId: `agent-session-${runId}`,
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
});

const readManifest = async (
  runsDir: string,
  runId: string,
): Promise<{
  generationId: string;
  members: Record<RunFamilyMember, { relativePath: string }>;
}> =>
  JSON.parse(await fs.readFile(path.join(runsDir, `${runId}.family.json`), 'utf8')) as {
    generationId: string;
    members: Record<RunFamilyMember, { relativePath: string }>;
  };

const copyCurrentFamilyToLegacy = async (runsDir: string, runId: string): Promise<string[]> => {
  const manifest = await readManifest(runsDir, runId);
  const copied: string[] = [];
  for (const member of RUN_FAMILY_MEMBERS) {
    const sourcePath = path.join(runsDir, manifest.members[member].relativePath);
    const targetPath = path.join(runsDir, legacyRunFamilyMemberFileName(runId, member));
    try {
      await fs.copyFile(sourcePath, targetPath);
      copied.push(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return copied;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('cullRunStore', () => {
  const attachment = async (baseDir: string, runId: string) => {
    const dir = path.join(baseDir, 'run-attachments', runId, 'attachment');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'file'), 'attached bytes');
    return path.join(baseDir, 'run-attachments', runId);
  };

  it('accounts for attachments in preview and removes only selected Run attachments', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-retention-'));
    tempDirectories.push(baseDir);
    const store = new RunStore({ paths: createPaths(baseDir), now: () => new Date('2026-06-01') });
    await store.initialize();
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const dirs: string[] = [];
    for (const [i, id] of ids.entries()) {
      await store.createRun(
        createRunInput(id, i === 0 ? 'complete' : i === 1 ? 'idle' : 'running'),
      );
      dirs.push(await attachment(baseDir, id));
    }
    const options = {
      baseDir,
      runStore: store,
      retentionOnly: true,
      completedBefore: new Date('2026-08-01'),
    };
    const preview = await cullRunStore(options);
    expect(preview.entries[0]?.paths).toContain(dirs[0]);
    const applied = await cullRunStore({ ...options, apply: true });
    expect(applied.deletedPathCount).toBe(preview.plannedPathCount);
    expect(applied.deletedLogicalBytes).toBe(preview.plannedLogicalBytes);
    await expect(fs.access(dirs[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(dirs[1]!)).resolves.toBeUndefined();
    await expect(fs.access(dirs[2]!)).resolves.toBeUndefined();
  });

  it('retains attachments when authority changes between selection and apply', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-authority-'));
    tempDirectories.push(baseDir);
    const store = new RunStore({ paths: createPaths(baseDir), now: () => new Date('2026-06-01') });
    await store.initialize();
    const id = '11111111-1111-4111-8111-111111111111';
    await store.createRun(createRunInput(id, 'complete'));
    const dir = await attachment(baseDir, id);
    const original = store.deleteCompletedFamiliesForRetention.bind(store);
    vi.spyOn(store, 'deleteCompletedFamiliesForRetention').mockImplementationOnce(async (input) => {
      await store.updateRunStatus(id, 'running');
      return original(input);
    });
    const result = await cullRunStore({
      baseDir,
      runStore: store,
      retentionOnly: true,
      apply: true,
      completedBefore: new Date('2026-08-01'),
    });
    expect(result.plannedPathCount).toBeGreaterThan(0);
    expect(result.deletedPathCount).toBe(0);
    await expect(fs.access(dir)).resolves.toBeUndefined();
  });

  it('keeps retryable Run evidence after attachment deletion fails and deletes independent Runs', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-isolation-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    const store = new RunStore({ paths, now: () => new Date('2026-06-01') });
    await store.initialize();
    const failed = '11111111-1111-4111-8111-111111111111';
    const healthy = '22222222-2222-4222-8222-222222222222';
    for (const id of [failed, healthy]) {
      await store.createRun(createRunInput(id, 'complete'));
      await attachment(baseDir, id);
    }
    const original = fs.rm.bind(fs);
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target === path.join(baseDir, 'run-attachments', failed)) throw new Error('denied');
      return original(target, options);
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await cullRunStore({
      baseDir,
      runStore: store,
      retentionOnly: true,
      apply: true,
      completedBefore: new Date('2026-08-01'),
    });
    expect(result.expiredCompletedRunCount).toBe(1);
    expect(log).toHaveBeenCalledWith('run.retention.failed', { runId: failed });
    await expect(
      fs.access(path.join(paths.runsDir, `${failed}.family.json`)),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(baseDir, 'run-attachments', failed))).resolves.toBeUndefined();
    await expect(fs.access(path.join(baseDir, 'run-attachments', healthy))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    vi.restoreAllMocks();
    expect(
      (
        await cullRunStore({
          baseDir,
          runStore: store,
          retentionOnly: true,
          apply: true,
          completedBefore: new Date('2026-08-01'),
        })
      ).expiredCompletedRunCount,
    ).toBe(1);
  });
  it('previews and removes only redundant legacy files and stale generations', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-cull-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    const store = new RunStore({ paths });
    await store.initialize();
    const runId = '11111111-1111-4111-8111-111111111111';
    await store.createRun(createRunInput(runId));
    const attachments = await attachment(baseDir, runId);
    const legacyPaths = await copyCurrentFamilyToLegacy(paths.runsDir, runId);
    const staleGenerationPath = path.join(
      paths.runsDir,
      '.run-families',
      runId,
      'stale-generation',
    );
    await fs.mkdir(staleGenerationPath, { recursive: true });
    await fs.writeFile(path.join(staleGenerationPath, 'events.data'), 'stale', 'utf8');

    const preview = await cullRunStore({ baseDir });

    expect(preview).toMatchObject({
      applied: false,
      compatibleRunCount: 1,
      incompatibleRunCount: 0,
      redundantLegacyFileCount: legacyPaths.length,
      staleGenerationCount: 1,
      expiredCompletedRunCount: 0,
      deletedPathCount: 0,
    });
    await expect(fs.access(legacyPaths[0]!)).resolves.toBeUndefined();
    await expect(fs.access(staleGenerationPath)).resolves.toBeUndefined();

    const applied = await cullRunStore({ baseDir, apply: true });

    expect(applied.deletedPathCount).toBe(legacyPaths.length + 1);
    await expect(fs.access(legacyPaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(staleGenerationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(attachments)).resolves.toBeUndefined();
    const reopened = new RunStore({ paths });
    await reopened.initialize();
    await expect(reopened.getRun(runId)).resolves.toMatchObject({ agentic_session_id: runId });
  });

  it('preserves every path for an incompatible family', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-cull-incompatible-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    const store = new RunStore({ paths });
    await store.initialize();
    const runId = '22222222-2222-4222-8222-222222222222';
    await store.createRun(createRunInput(runId));
    const attachments = await attachment(baseDir, runId);
    const legacyPaths = await copyCurrentFamilyToLegacy(paths.runsDir, runId);
    const manifestPath = path.join(paths.runsDir, `${runId}.family.json`);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.schemaVersion = 99;
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = await cullRunStore({ baseDir, apply: true });

    expect(result).toMatchObject({ incompatibleRunCount: 1, deletedPathCount: 0 });
    await expect(fs.access(manifestPath)).resolves.toBeUndefined();
    await expect(fs.access(legacyPaths[0]!)).resolves.toBeUndefined();
    await expect(fs.access(attachments)).resolves.toBeUndefined();
  });

  it('deletes only expired completed Runs after protecting the newest completed Runs', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-cull-retention-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    let now = new Date('2026-06-01T00:00:00.000Z');
    const store = new RunStore({ paths, now: () => now });
    await store.initialize();
    const oldRunId = '33333333-3333-4333-8333-333333333333';
    const recentRunId = '44444444-4444-4444-8444-444444444444';
    await store.createRun(createRunInput(oldRunId, 'complete'));
    now = new Date('2026-07-20T00:00:00.000Z');
    await store.createRun(createRunInput(recentRunId, 'complete'));

    const result = await cullRunStore({
      baseDir,
      apply: true,
      completedBefore: new Date('2026-08-01T00:00:00.000Z'),
      keepRecentCompleted: 1,
      retentionOnly: true,
    });

    expect(result.expiredCompletedRunCount).toBe(1);
    await expect(
      fs.access(path.join(paths.runsDir, `${oldRunId}.family.json`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(paths.runsDir, `${recentRunId}.family.json`)),
    ).resolves.toBeUndefined();
    const reopened = new RunStore({ paths });
    await reopened.initialize();
    await expect(reopened.getRun(oldRunId)).resolves.toBeNull();
    await expect(reopened.getRun(recentRunId)).resolves.toMatchObject({
      agentic_session_id: recentRunId,
    });
  });

  it('previews retention from metadata without reading large sidecars', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-run-cull-fast-preview-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    const store = new RunStore({
      paths,
      now: () => new Date('2026-06-01T00:00:00.000Z'),
    });
    await store.initialize();
    const runId = '55555555-5555-4555-8555-555555555555';
    await store.createRun(createRunInput(runId, 'complete'));
    const attachments = await attachment(baseDir, runId);
    const manifest = await readManifest(paths.runsDir, runId);
    await fs.writeFile(
      path.join(paths.runsDir, manifest.members.events.relativePath),
      'not valid event JSON',
      'utf8',
    );

    const preview = await cullRunStore({
      baseDir,
      completedBefore: new Date('2026-08-01T00:00:00.000Z'),
      retentionOnly: true,
    });

    expect(preview).toMatchObject({
      compatibleRunCount: 1,
      expiredCompletedRunCount: 1,
      deletedPathCount: 0,
    });
    await expect(
      fs.access(path.join(paths.runsDir, `${runId}.family.json`)),
    ).resolves.toBeUndefined();

    const applied = await cullRunStore({
      baseDir,
      apply: true,
      completedBefore: new Date('2026-08-01T00:00:00.000Z'),
      retentionOnly: true,
    });

    expect(applied).toMatchObject({
      expiredCompletedRunCount: 0,
      incompatibleRunCount: 1,
      deletedPathCount: 0,
    });
    await expect(fs.access(attachments)).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(paths.runsDir, `${runId}.family.json`)),
    ).resolves.toBeUndefined();
  });
});
