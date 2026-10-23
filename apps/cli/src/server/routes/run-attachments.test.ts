import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../run/run';
import { StructuredServerLogger } from '../logger';
import { AttachmentOpenerUnavailableError, type ShowAttachment } from '../attachment-opener';
import { RunReadPreparationError } from '../restore-persisted-runs';
import { RunAttachmentStore, MAX_RUN_ATTACHMENT_BYTES } from '../run-attachment-store';
import { createRunAttachmentsRouter } from './run-attachments';

const runId = '44444444-4444-4444-8444-444444444444';
describe('Run attachment uploads', () => {
  const servers: Server[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    await Promise.all(
      directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });
  const harness = async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-route-'));
    directories.push(baseDir);
    const logs: string[] = [];
    const machine = vi.fn(async (): Promise<string | null> => 'machine');
    const restore = vi.fn(async (): Promise<Run> => ({}) as Run);
    const store = new RunAttachmentStore(baseDir);
    const show = vi.fn<ShowAttachment>(async (filePath) =>
      filePath.endsWith('.png') ? 'opened' : 'revealed',
    );
    const app = express();
    app.use(
      '/api/local/runs',
      createRunAttachmentsRouter({
        allowedOrigins: ['https://allowed.test'],
        keyPairStore: { loadCurrentMachineId: machine },
        restoreCoordinator: { restore },
        attachmentStore: store,
        showAttachment: show,
        logger: new StructuredServerLogger({
          minLevel: 'debug',
          writeLine: (line) => logs.push(line),
        }),
      }),
    );
    app.use(express.json());
    app.post('/api/local/runs/unrelated', (_req, res) => res.sendStatus(200));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const root = `http://127.0.0.1:${address.port}/api/local/runs`;
    const url = `${root}/${runId}/attachments`;
    const upload = (
      query = 'machineId=machine&fileName=example.txt',
      body: Buffer = Buffer.from('secret file bytes'),
      origin = 'https://allowed.test',
    ) =>
      fetch(`${url}?${query}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(body),
      });
    const open = (
      attachmentId: string,
      fileName: string,
      { machineId = 'machine', origin = 'https://allowed.test', run = runId } = {},
    ) =>
      fetch(
        `${root}/${run}/attachments/${attachmentId}/open?machineId=${machineId}&fileName=${encodeURIComponent(fileName)}`,
        { method: 'POST', headers: { origin } },
      );
    return { baseDir, logs, machine, restore, store, show, root, url, upload, open };
  };
  it('rejects unsupported formats and spoofed text without blocking supported uploads', async () => {
    const h = await harness();
    const unsupported = await h.upload('machineId=machine&fileName=file.pdf', Buffer.from('%PDF'));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error.code).toBe('INVALID_REQUEST');
    expect((await h.upload('machineId=machine&fileName=bad.txt', Buffer.from([255]))).status).toBe(
      400,
    );
    expect((await h.upload()).status).toBe(200);
    expect(h.logs.join('')).not.toContain('%PDF');
  });
  it('stores exact bytes without logging them or using grants', async () => {
    const h = await harness();
    const response = await h.upload();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.operation).toBe('run.attachments.upload');
    expect(payload.result.attachment.sizeBytes).toBe(17);
    const attachment = payload.result.attachment;
    expect(
      await fs.readFile(
        path.join(
          h.baseDir,
          'run-attachments',
          runId,
          attachment.attachmentId,
          attachment.fileName,
        ),
        'utf8',
      ),
    ).toBe('secret file bytes');
    expect(h.logs.join('')).not.toContain('secret file bytes');
    expect(h.restore).toHaveBeenCalledWith(runId);
  });
  it.each(['', '.', '..', 'dir/file', 'dir\\file', 'a\0b'])(
    'rejects file name %j without writing',
    async (name) => {
      const h = await harness();
      expect(
        (await h.upload(`machineId=machine&fileName=${encodeURIComponent(name)}`)).status,
      ).toBe(400);
      expect(await fs.readdir(h.baseDir)).toEqual([]);
      expect(h.restore).not.toHaveBeenCalled();
    },
  );
  it.each([
    'machineId=machine&fileName=a&fileName=b',
    'machineId=machine&machineId=other&fileName=a',
    'fileName=a',
    'machineId=machine',
    'machineId=&fileName=a',
  ])('rejects invalid query %s', async (query) => {
    const h = await harness();
    expect((await h.upload(query)).status).toBe(400);
    expect(await fs.readdir(h.baseDir)).toEqual([]);
  });
  it('uses upload errors for blocked origins and allows preflight without touching other routes', async () => {
    const h = await harness();
    const blocked = await h.upload(undefined, undefined, 'https://blocked.test');
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).operation).toBe('run.attachments.upload');
    expect(
      (await fetch(h.url, { method: 'OPTIONS', headers: { origin: 'https://allowed.test' } }))
        .status,
    ).toBe(204);
    const denied = await fetch(h.url, {
      method: 'OPTIONS',
      headers: { origin: 'https://blocked.test' },
    });
    expect((await denied.json()).operation).toBe('run.attachments.upload');
    expect(
      (
        await fetch(`${h.root}/unrelated`, {
          method: 'POST',
          headers: { origin: 'https://blocked.test' },
        })
      ).status,
    ).toBe(200);
    expect(h.machine).not.toHaveBeenCalled();
  });
  it('isolates machine admission failures', async () => {
    const h = await harness();
    expect((await h.upload('machineId=other&fileName=a')).status).toBe(409);
    h.machine.mockResolvedValueOnce(null);
    expect((await h.upload()).status).toBe(503);
    h.machine.mockRejectedValueOnce(new Error('identity secret'));
    expect((await h.upload()).status).toBe(503);
    expect((await h.upload()).status).toBe(200);
    expect(h.logs.join('')).not.toContain('identity secret');
  });
  it('rejects an unknown Run and keeps another request usable', async () => {
    const h = await harness();
    h.restore.mockRejectedValueOnce(new RunReadPreparationError('RUN_NOT_FOUND', 'missing'));
    expect((await h.upload()).status).toBe(404);
    expect(await fs.readdir(h.baseDir)).toEqual([]);
    const otherUrl = h.url.replace(runId, '55555555-5555-4555-8555-555555555555');
    expect(
      (
        await fetch(`${otherUrl}?machineId=machine&fileName=healthy.txt`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: 'healthy bytes',
        })
      ).status,
    ).toBe(200);
  });
  it('accepts 25 MiB and rejects oversized bodies without files or raw errors', async () => {
    const h = await harness();
    const large = await h.upload(undefined, Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES + 1));
    expect(large.status).toBe(413);
    expect((await large.json()).error.code).toBe('FILE_TOO_LARGE');
    expect(await fs.readdir(h.baseDir)).toEqual([]);
    expect((await h.upload(undefined, Buffer.alloc(MAX_RUN_ATTACHMENT_BYTES, 65))).status).toBe(
      200,
    );
  });
  it('creates no partial file for an aborted body', async () => {
    const h = await harness();
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${h.url}?machineId=machine&fileName=a`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'content-length': '100000' },
      });
      req.on('error', () => resolve());
      req.write(Buffer.alloc(100));
      setTimeout(() => req.destroy(), 30);
    });
    expect(await fs.readdir(h.baseDir)).toEqual([]);
    expect((await h.upload()).status).toBe(200);
  });
  it('cleans failed writes and permits a later upload', async () => {
    const h = await harness();
    const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('private bytes'));
    expect((await h.upload()).status).toBe(500);
    expect(await fs.readdir(path.join(h.baseDir, 'run-attachments', runId))).toEqual([]);
    write.mockRestore();
    expect((await h.upload()).status).toBe(200);
    expect(h.logs.join('')).not.toContain('private bytes');
  });

  describe('open', () => {
    const missingId = '66666666-6666-4666-8666-666666666666';
    it('opens an image and reveals a script without returning its path', async () => {
      const h = await harness();
      const image = await h.store.save(
        runId,
        'photo.png',
        Buffer.from('png'),
        new AbortController().signal,
      );
      const script = await h.store.save(
        runId,
        'run.sh',
        Buffer.from('echo hi'),
        new AbortController().signal,
      );
      const opened = await h.open(image.attachmentId, image.fileName);
      expect(opened.status).toBe(200);
      const body = await opened.json();
      expect(body).toEqual({
        requestId: expect.any(String),
        operation: 'run.attachments.open',
        status: 'success',
        result: { runId, attachmentId: image.attachmentId, action: 'opened' },
      });
      expect(JSON.stringify(body)).not.toContain(h.baseDir);
      const revealed = await (await h.open(script.attachmentId, script.fileName)).json();
      expect(revealed.result.action).toBe('revealed');
      expect(h.show).toHaveBeenLastCalledWith(
        path.join(h.baseDir, 'run-attachments', runId, script.attachmentId, 'run.sh'),
      );
      expect(h.logs.join('')).not.toContain(h.baseDir);
    });
    it('applies the upload origin and machine checks', async () => {
      const h = await harness();
      const image = await h.store.save(
        runId,
        'photo.png',
        Buffer.from('png'),
        new AbortController().signal,
      );
      const blocked = await h.open(image.attachmentId, image.fileName, {
        origin: 'https://blocked.test',
      });
      expect(blocked.status).toBe(403);
      expect((await blocked.json()).operation).toBe('run.attachments.open');
      const preflight = await fetch(`${h.url}/${image.attachmentId}/open`, {
        method: 'OPTIONS',
        headers: { origin: 'https://allowed.test' },
      });
      expect(preflight.status).toBe(204);
      const mismatch = await h.open(image.attachmentId, image.fileName, { machineId: 'other' });
      expect(mismatch.status).toBe(409);
      expect((await mismatch.json()).error.code).toBe('MACHINE_NOT_BOUND');
      expect(h.show).not.toHaveBeenCalled();
    });
    it('reports a culled Run and a missing attachment as not found', async () => {
      const h = await harness();
      h.restore.mockRejectedValueOnce(new RunReadPreparationError('RUN_NOT_FOUND', 'culled'));
      const culled = await h.open(missingId, 'photo.png');
      expect(culled.status).toBe(404);
      expect((await culled.json()).error.code).toBe('ATTACHMENT_NOT_FOUND');
      const missing = await h.open(missingId, 'photo.png');
      expect(missing.status).toBe(404);
      expect((await missing.json()).error.code).toBe('ATTACHMENT_NOT_FOUND');
      expect(h.show).not.toHaveBeenCalled();
    });
    it('cannot reach another Run or a path outside the attachment', async () => {
      const h = await harness();
      const otherRun = '55555555-5555-4555-8555-555555555555';
      const foreign = await h.store.save(
        otherRun,
        'photo.png',
        Buffer.from('png'),
        new AbortController().signal,
      );
      expect((await h.open(foreign.attachmentId, foreign.fileName)).status).toBe(404);
      for (const name of ['../photo.png', '..', 'a/b.png'])
        expect((await h.open(foreign.attachmentId, name, { run: otherRun })).status).toBe(400);
      expect((await h.open('not-a-uuid', 'photo.png')).status).toBe(400);
      expect(h.show).not.toHaveBeenCalled();
    });
    it('reports a missing opener as unavailable', async () => {
      const h = await harness();
      const image = await h.store.save(
        runId,
        'photo.png',
        Buffer.from('png'),
        new AbortController().signal,
      );
      h.show.mockRejectedValueOnce(new AttachmentOpenerUnavailableError('xdg-open'));
      const unavailable = await h.open(image.attachmentId, image.fileName);
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json()).error.code).toBe('OPENER_UNAVAILABLE');
      h.show.mockRejectedValueOnce(new Error('boom'));
      expect((await (await h.open(image.attachmentId, image.fileName)).json()).error.code).toBe(
        'OPEN_FAILED',
      );
    });
  });
});
