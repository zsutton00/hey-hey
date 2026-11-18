import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelDownloader } from './model-downloader';
import type { DownloadDetail } from './pull-progress';

const content = Buffer.alloc(300_000, 'model');
const digest = createHash('sha256').update(content).digest('hex');
let server: Server;
let baseUrl: string;
let directory: string;
let announceLength = true;

beforeEach(async () => {
  announceLength = true;
  directory = await mkdtemp(join(tmpdir(), 'heyhey-model-'));
  server = createServer((_request, response) => {
    if (announceLength) {
      response.setHeader('content-length', content.length);
    }
    response.write(content.subarray(0, 100_000));
    setTimeout(() => response.end(content.subarray(100_000)), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.close();
  await rm(directory, { recursive: true, force: true });
});

const downloader = (sha256: string) =>
  new ModelDownloader([{ name: 'model.onnx', path: 'model.onnx', sha256 }], baseUrl);

describe('model download progress', () => {
  it('reports bytes against the announced size and keeps the verified file', async () => {
    const details: DownloadDetail[] = [];
    await downloader(digest).ensure(
      directory,
      () => undefined,
      (detail) => {
        if (detail) {
          details.push(detail);
        }
      },
    );

    expect(details.at(-1)).toMatchObject({
      bytesDone: content.length,
      bytesTotal: content.length,
      percent: 100,
    });
    expect(await readFile(join(directory, 'model.onnx'))).toEqual(content);
  });

  it('shows activity without a percentage when the size is not announced', async () => {
    announceLength = false;
    const details: DownloadDetail[] = [];
    await downloader(digest).ensure(
      directory,
      () => undefined,
      (detail) => {
        if (detail) {
          details.push(detail);
        }
      },
    );

    expect(details.length).toBeGreaterThan(0);
    expect(details.every((detail) => detail.percent === null && detail.bytesTotal === null)).toBe(
      true,
    );
  });

  it('removes the partial file and installs nothing when the checksum does not match', async () => {
    await expect(downloader('0'.repeat(64)).ensure(directory, () => undefined)).rejects.toThrow(
      /checksum mismatch/u,
    );
    expect(await readdir(directory)).toEqual([]);
  });
});
