import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RunAttachmentNotFoundError,
  RunAttachmentStore,
  MAX_RUN_ATTACHMENT_BYTES,
} from './run-attachment-store';

const runId = '44444444-4444-4444-8444-444444444444';
describe('RunAttachmentStore', () => {
  const directories: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });
  const harness = async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-'));
    directories.push(baseDir);
    return {
      baseDir,
      store: new RunAttachmentStore(baseDir),
      signal: new AbortController().signal,
    };
  };
  it('stores exact bytes and unchanged names in distinct directories', async () => {
    const { baseDir, store, signal } = await harness();
    const bytes = Buffer.from([0, 255, 1, 2]);
    const first = await store.save(runId, ' file ü.txt ', bytes, signal);
    const second = await store.save(runId, first.fileName, bytes, signal);
    expect(first.fileName).toBe(' file ü.txt ');
    expect(first.sizeBytes).toBe(4);
    expect(first.attachmentId).not.toBe(second.attachmentId);
    expect(
      await fs.readFile(
        path.join(baseDir, 'run-attachments', runId, first.attachmentId, first.fileName),
      ),
    ).toEqual(bytes);
  });
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b'])(
    'rejects invalid name %j before filesystem access',
    async (fileName) => {
      const { baseDir, store, signal } = await harness();
      await expect(store.save(runId, fileName, Buffer.from('x'), signal)).rejects.toThrow();
      expect(await fs.readdir(baseDir)).toEqual([]);
    },
  );
  it('accepts the cap and rejects one byte above it', async () => {
    const { store, signal } = await harness();
    expect(
      (await store.save(runId, 'cap', Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES), signal)).sizeBytes,
    ).toBe(MAX_RUN_ATTACHMENT_BYTES);
    await expect(
      store.save(runId, 'large', Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES + 1), signal),
    ).rejects.toThrow();
  });
  it('removes only a failed attachment and keeps another upload usable', async () => {
    const { baseDir, store, signal } = await harness();
    const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('write failed'));
    await expect(store.save(runId, 'failed', Buffer.from('x'), signal)).rejects.toThrow();
    expect(await fs.readdir(path.join(baseDir, 'run-attachments', runId))).toEqual([]);
    write.mockRestore();
    await expect(store.save(runId, 'healthy', Buffer.from('y'), signal)).resolves.toMatchObject({
      sizeBytes: 1,
    });
  });
  it('cleans an attachment aborted during writing', async () => {
    const { baseDir, store } = await harness();
    const controller = new AbortController();
    const original = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      await original(...args);
      controller.abort();
    });
    await expect(store.save(runId, 'abort', Buffer.from('x'), controller.signal)).rejects.toThrow();
    expect(await fs.readdir(path.join(baseDir, 'run-attachments', runId))).toEqual([]);
  });

  describe('saveStaged', () => {
    it('stores exact bytes and unchanged names in distinct directories', async () => {
      const { baseDir, store, signal } = await harness();
      const bytes = Buffer.from([0, 255, 1, 2]);
      const first = await store.saveStaged(' file ü.txt ', bytes, signal);
      const second = await store.saveStaged(first.fileName, bytes, signal);
      expect(first.fileName).toBe(' file ü.txt ');
      expect(first.sizeBytes).toBe(4);
      expect(first.attachmentId).not.toBe(second.attachmentId);
      expect(
        await fs.readFile(
          path.join(baseDir, 'run-attachments-staging', first.attachmentId, first.fileName),
        ),
      ).toEqual(bytes);
    });
    it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b'])(
      'rejects invalid name %j before filesystem access',
      async (fileName) => {
        const { baseDir, store, signal } = await harness();
        await expect(store.saveStaged(fileName, Buffer.from('x'), signal)).rejects.toThrow();
        expect(await fs.readdir(baseDir)).toEqual([]);
      },
    );
    it('accepts the cap and rejects one byte above it', async () => {
      const { store, signal } = await harness();
      expect(
        (await store.saveStaged('cap', Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES), signal)).sizeBytes,
      ).toBe(MAX_RUN_ATTACHMENT_BYTES);
      await expect(
        store.saveStaged('large', Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES + 1), signal),
      ).rejects.toThrow();
    });
    it('removes only a failed attachment and keeps another upload usable', async () => {
      const { baseDir, store, signal } = await harness();
      const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('write failed'));
      await expect(store.saveStaged('failed', Buffer.from('x'), signal)).rejects.toThrow();
      expect(await fs.readdir(path.join(baseDir, 'run-attachments-staging'))).toEqual([]);
      write.mockRestore();
      await expect(store.saveStaged('healthy', Buffer.from('y'), signal)).resolves.toMatchObject({
        sizeBytes: 1,
      });
    });
    it('cleans an attachment aborted during writing', async () => {
      const { baseDir, store } = await harness();
      const controller = new AbortController();
      const original = fs.writeFile.bind(fs);
      vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
        await original(...args);
        controller.abort();
      });
      await expect(
        store.saveStaged('abort', Buffer.from('x'), controller.signal),
      ).rejects.toThrow();
      expect(await fs.readdir(path.join(baseDir, 'run-attachments-staging'))).toEqual([]);
    });

    it('produces references that existing binding moves into a Run', async () => {
      const { baseDir, store, signal } = await harness();
      const attachment = await store.saveStaged('note.md', Buffer.from('unchanged'), signal);
      await store.bindStaged(runId, [attachment]);
      expect(await fs.readFile((await store.resolvePaths(runId, [attachment]))[0]!, 'utf8')).toBe(
        'unchanged',
      );
      expect(await fs.readdir(path.join(baseDir, 'run-attachments-staging'))).toEqual([]);
    });
    it('does not write when already aborted', async () => {
      const { baseDir, store } = await harness();
      const controller = new AbortController();
      controller.abort();
      await expect(
        store.saveStaged('a.txt', Buffer.from('a'), controller.signal),
      ).rejects.toThrow();
      expect(await fs.readdir(baseDir)).toEqual([]);
    });
  });

  describe('bindStaged', () => {
    const first = { attachmentId: '66666666-6666-4666-8666-666666666666', fileName: 'notes.md' };
    const second = { attachmentId: '77777777-7777-4777-8777-777777777777', fileName: 'image.png' };
    const stage = async (baseDir: string, reference: typeof first) => {
      const directory = path.join(baseDir, 'run-attachments-staging', reference.attachmentId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, reference.fileName), 'exact content');
    };
    it('moves references unchanged and retries without replacing bound content', async () => {
      const { baseDir, store } = await harness();
      await stage(baseDir, first);
      await store.bindStaged(runId, [first]);
      await stage(baseDir, first);
      await fs.writeFile(
        path.join(baseDir, 'run-attachments-staging', first.attachmentId, first.fileName),
        'new content',
      );
      await store.bindStaged(runId, [first]);
      expect(await fs.readFile((await store.resolvePaths(runId, [first]))[0]!, 'utf8')).toBe(
        'exact content',
      );
    });
    it('preflights all files and leaves a valid file available after a missing reference', async () => {
      const { baseDir, store } = await harness();
      await stage(baseDir, first);
      await expect(store.bindStaged(runId, [first, second])).rejects.toMatchObject({
        code: 'ATTACHMENT_NOT_FOUND',
      });
      expect(
        await fs.readFile(
          path.join(baseDir, 'run-attachments-staging', first.attachmentId, first.fileName),
          'utf8',
        ),
      ).toBe('exact content');
      await store.bindStaged(runId, [first]);
      expect(await store.resolvePaths(runId, [first])).toHaveLength(1);
    });
    it('completes an interrupted move on retry', async () => {
      const { baseDir, store } = await harness();
      await stage(baseDir, first);
      await stage(baseDir, second);
      const rename = fs.rename.bind(fs);
      const spy = vi
        .spyOn(fs, 'rename')
        .mockImplementationOnce(rename)
        .mockRejectedValueOnce(new Error('interrupted'));
      await expect(store.bindStaged(runId, [first, second])).rejects.toThrow('interrupted');
      spy.mockRestore();
      await store.bindStaged(runId, [first, second]);
      expect(await store.resolvePaths(runId, [first, second])).toHaveLength(2);
    });
    it('rejects traversal and symlink files', async () => {
      const { baseDir, store } = await harness();
      await stage(baseDir, first);
      await expect(
        store.bindStaged(runId, [{ ...first, fileName: '../notes.md' }]),
      ).rejects.toBeInstanceOf(RunAttachmentNotFoundError);
      const directory = path.join(baseDir, 'run-attachments-staging', second.attachmentId);
      await fs.mkdir(directory);
      await fs.symlink(
        path.join(baseDir, 'run-attachments-staging', first.attachmentId, first.fileName),
        path.join(directory, second.fileName),
      );
      await expect(store.bindStaged(runId, [second])).rejects.toBeInstanceOf(
        RunAttachmentNotFoundError,
      );
    });
    it('does no filesystem work for an empty list', async () => {
      const { baseDir, store } = await harness();
      await store.bindStaged(runId, []);
      expect(await fs.readdir(baseDir)).toEqual([]);
    });
  });

  describe('resolvePaths', () => {
    const otherRunId = '55555555-5555-4555-8555-555555555555';
    const missingId = '66666666-6666-4666-8666-666666666666';
    it('resolves stored references to absolute file paths in order', async () => {
      const { baseDir, store, signal } = await harness();
      const first = await store.save(runId, 'a.txt', Buffer.from('a'), signal);
      const second = await store.save(runId, 'b.txt', Buffer.from('b'), signal);
      const paths = await store.resolvePaths(runId, [second, first]);
      expect(paths).toEqual([
        path.join(baseDir, 'run-attachments', runId, second.attachmentId, 'b.txt'),
        path.join(baseDir, 'run-attachments', runId, first.attachmentId, 'a.txt'),
      ]);
      expect(paths.every((filePath) => path.isAbsolute(filePath))).toBe(true);
    });
    it('resolves an empty list without touching the filesystem', async () => {
      const { baseDir, store } = await harness();
      expect(await store.resolvePaths(runId, [])).toEqual([]);
      expect(await fs.readdir(baseDir)).toEqual([]);
    });
    it('rejects a missing file with a typed error', async () => {
      const { store } = await harness();
      const error = await store
        .resolvePaths(runId, [{ attachmentId: missingId, fileName: 'gone.txt' }])
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RunAttachmentNotFoundError);
      expect(error).toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    });
    it("rejects another Run's attachment", async () => {
      const { store, signal } = await harness();
      const foreign = await store.save(otherRunId, 'a.txt', Buffer.from('a'), signal);
      await expect(store.resolvePaths(runId, [foreign])).rejects.toBeInstanceOf(
        RunAttachmentNotFoundError,
      );
    });
    it.each(['../../55555555-5555-4555-8555-555555555555/x/a.txt', '..', 'a/b', ''])(
      'rejects traversal fileName %j',
      async (fileName) => {
        const { store, signal } = await harness();
        const stored = await store.save(runId, 'a.txt', Buffer.from('a'), signal);
        await expect(
          store.resolvePaths(runId, [{ attachmentId: stored.attachmentId, fileName }]),
        ).rejects.toBeInstanceOf(RunAttachmentNotFoundError);
      },
    );
    it('rejects a traversal attachmentId', async () => {
      const { store } = await harness();
      await expect(
        store.resolvePaths(runId, [{ attachmentId: '..', fileName: runId }]),
      ).rejects.toBeInstanceOf(RunAttachmentNotFoundError);
    });
    it('rejects a directory in place of a file', async () => {
      const { baseDir, store } = await harness();
      await fs.mkdir(path.join(baseDir, 'run-attachments', runId, missingId, 'folder'), {
        recursive: true,
      });
      await expect(
        store.resolvePaths(runId, [{ attachmentId: missingId, fileName: 'folder' }]),
      ).rejects.toBeInstanceOf(RunAttachmentNotFoundError);
    });
  });
});
