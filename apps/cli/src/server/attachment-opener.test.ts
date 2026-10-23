import { describe, expect, it, vi } from 'vitest';
import {
  AttachmentOpenerUnavailableError,
  createAttachmentShower,
  launchOpener,
} from './attachment-opener';

const dir = '/base/run-attachments/run/attachment';
const launched = async (platform: NodeJS.Platform, fileName: string) => {
  const launch = vi.fn(async () => undefined);
  const action = await createAttachmentShower({ platform, launch })(`${dir}/${fileName}`);
  return { action, calls: launch.mock.calls };
};

describe('createAttachmentShower', () => {
  it.each(['photo.png', 'photo.JPG', 'photo.jpeg', 'photo.webp'])(
    'opens image %s',
    async (name) => {
      expect(await launched('darwin', name)).toEqual({
        action: 'opened',
        calls: [['open', [`${dir}/${name}`]]],
      });
    },
  );

  it.each(['run.sh', 'run.command', 'page.html', 'notes.txt', 'unknown.bin'])(
    'reveals %s without opening it',
    async (name) => {
      expect(await launched('darwin', name)).toEqual({
        action: 'revealed',
        calls: [['open', ['-R', `${dir}/${name}`]]],
      });
    },
  );

  it('uses explorer.exe directly on Windows', async () => {
    expect((await launched('win32', 'a.png')).calls).toEqual([['explorer.exe', [`${dir}/a.png`]]]);
    expect((await launched('win32', 'a.sh')).calls).toEqual([
      ['explorer.exe', [`/select,${dir}/a.sh`]],
    ]);
  });

  it('opens the attachment directory instead of the file on Linux', async () => {
    expect((await launched('linux', 'a.webp')).calls).toEqual([['xdg-open', [`${dir}/a.webp`]]]);
    expect((await launched('linux', 'a.command')).calls).toEqual([['xdg-open', [dir]]]);
  });

  it('reports a missing opener as unavailable', async () => {
    await expect(
      createAttachmentShower({ platform: 'aix' })(`${dir}/a.png`),
    ).rejects.toBeInstanceOf(AttachmentOpenerUnavailableError);
  });

  it('maps a spawn ENOENT to unavailable', async () => {
    await expect(launchOpener('heyhey-missing-opener-command', [])).rejects.toBeInstanceOf(
      AttachmentOpenerUnavailableError,
    );
  });
});
