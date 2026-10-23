import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeTurnContent, codexAttachmentInput } from '@hey-hey/ui-common/agents';
import { opencodeAttachmentParts } from './opencode/session-runner-opencode';
import { RunAttachmentStore } from '../../server/run-attachment-store';
import {
  RunAttachmentContentReader,
  readRunAttachmentContent,
} from './run-attachment-content-reader';

describe('uploaded attachment content', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('reads stored bytes in reference order and creates native inputs without changing user text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-content-'));
    directories.push(root);
    const store = new RunAttachmentStore(root);
    const runId = randomUUID();
    const text = '  π text\n\n';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    const a = await store.save(runId, 'notes.md', Buffer.from(text), new AbortController().signal);
    const b = await store.save(runId, 'image.png', png, new AbortController().signal);
    const references = [a, b].map(({ attachmentId, fileName }) => ({ attachmentId, fileName }));
    const contents = await new RunAttachmentContentReader(store).read(runId, references);
    expect(contents).toEqual([
      { kind: 'text', fileName: 'notes.md', text },
      {
        kind: 'image',
        fileName: 'image.png',
        mediaType: 'image/png',
        data: png.toString('base64'),
      },
    ]);
    const prompt = '  Read this.\n\n';
    expect(claudeTurnContent(prompt, contents)).toEqual([
      { type: 'text', text: prompt },
      { type: 'text', text: 'File: notes.md\n' + text },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
      },
    ]);
    expect(codexAttachmentInput(contents)).toEqual([
      { type: 'text', text: 'File: notes.md\n' + text, text_elements: [] },
      { type: 'image', url: 'data:image/png;base64,' + png.toString('base64') },
    ]);
    expect(opencodeAttachmentParts(contents)).toEqual([
      { type: 'text', text: 'File: notes.md\n' + text },
      {
        type: 'file',
        mime: 'image/png',
        filename: 'image.png',
        url: 'data:image/png;base64,' + png.toString('base64'),
      },
    ]);
    expect(JSON.stringify(references)).not.toContain(text);
    expect(JSON.stringify(references)).not.toContain(root);
    await expect(
      new RunAttachmentContentReader(store).read(randomUUID(), references),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    await fs.unlink(path.join(root, 'run-attachments', runId, a.attachmentId, a.fileName));
    await expect(
      new RunAttachmentContentReader(store).read(runId, references),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    await expect(
      new RunAttachmentContentReader(store).read(runId, [references[1]!]),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ['file.pdf', Buffer.from('%PDF-1.7')],
    ['archive.zip', Buffer.from('PK')],
    ['fake.png', Buffer.from('not an image')],
    ['file.txt', Buffer.from([255, 254])],
    ['binary.txt', Buffer.from([65, 0, 66])],
  ])('rejects unsupported or invalid contents: %s', (name, bytes) => {
    expect(() => readRunAttachmentContent(name, bytes)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });
  it('preserves BOM and whitespace, and needs no Run identifier when nothing is attached', async () => {
    expect(readRunAttachmentContent('source.ts', Buffer.from('\uFEFF  code\n'))).toMatchObject({
      text: '\uFEFF  code\n',
    });
    await expect(new RunAttachmentContentReader().read(undefined, [])).resolves.toEqual([]);
  });
});
