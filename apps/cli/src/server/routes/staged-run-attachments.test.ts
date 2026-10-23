import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger } from '../logger';
import { RunAttachmentStore, MAX_RUN_ATTACHMENT_BYTES } from '../run-attachment-store';
import { createStagedRunAttachmentsRouter } from './staged-run-attachments';

describe('Staged Run attachment uploads', () => {
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
    const store = new RunAttachmentStore(baseDir);
    const app = express();
    app.use(
      '/api/local/run-attachments',
      createStagedRunAttachmentsRouter({
        allowedOrigins: ['https://allowed.test'],
        keyPairStore: { loadCurrentMachineId: machine },
        attachmentStore: store,
        logger: new StructuredServerLogger({
          minLevel: 'debug',
          writeLine: (line) => logs.push(line),
        }),
      }),
    );
    app.use(express.json());
    app.post('/api/local/run-attachments/unrelated', (_req, res) => res.sendStatus(200));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const root = `http://127.0.0.1:${address.port}/api/local/run-attachments`;
    const url = `${root}/staging`;
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
    return { baseDir, logs, machine, store, root, url, upload };
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
  it.each([
    ['image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
    ['image.jpg', Buffer.from([255, 216, 255, 1])],
    ['image.webp', Buffer.from('RIFF0000WEBPdata')],
  ])('stores supported image %s unchanged', async (fileName, bytes) => {
    const h = await harness();
    const response = await h.upload(`machineId=machine&fileName=${fileName}`, bytes);
    expect(response.status).toBe(200);
    const { attachment } = (await response.json()).result;
    expect(
      await fs.readFile(
        path.join(h.baseDir, 'run-attachments-staging', attachment.attachmentId, fileName),
      ),
    ).toEqual(bytes);
  });
  it('rejects a non-binary body without writing and keeps uploads usable', async () => {
    const h = await harness();
    const response = await fetch(`${h.url}?machineId=machine&fileName=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_REQUEST');
    expect(await fs.readdir(h.baseDir)).toEqual([]);
    expect((await h.upload()).status).toBe(200);
  });
  it('stores exact bytes without logging them or using grants', async () => {
    const h = await harness();
    const response = await h.upload();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.operation).toBe('run.attachments.stage');
    expect(payload.result.attachment.sizeBytes).toBe(17);
    const attachment = payload.result.attachment;
    expect(
      await fs.readFile(
        path.join(
          h.baseDir,
          'run-attachments-staging',
          attachment.attachmentId,
          attachment.fileName,
        ),
        'utf8',
      ),
    ).toBe('secret file bytes');
    expect(h.logs.join('')).not.toContain('secret file bytes');
    expect(payload.result).toEqual({ attachment });
    expect(Object.keys(attachment).sort()).toEqual(['attachmentId', 'fileName', 'sizeBytes']);
  });
  it.each(['', '.', '..', 'dir/file', 'dir\\file', 'a\0b'])(
    'rejects file name %j without writing',
    async (name) => {
      const h = await harness();
      expect(
        (await h.upload(`machineId=machine&fileName=${encodeURIComponent(name)}`)).status,
      ).toBe(400);
      expect(await fs.readdir(h.baseDir)).toEqual([]);
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
    expect((await blocked.json()).operation).toBe('run.attachments.stage');
    expect(
      (await fetch(h.url, { method: 'OPTIONS', headers: { origin: 'https://allowed.test' } }))
        .status,
    ).toBe(204);
    const denied = await fetch(h.url, {
      method: 'OPTIONS',
      headers: { origin: 'https://blocked.test' },
    });
    expect((await denied.json()).operation).toBe('run.attachments.stage');
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
    expect(await fs.readdir(path.join(h.baseDir, 'run-attachments-staging'))).toEqual([]);
    write.mockRestore();
    expect((await h.upload()).status).toBe(200);
    expect(h.logs.join('')).not.toContain('private bytes');
  });
});
