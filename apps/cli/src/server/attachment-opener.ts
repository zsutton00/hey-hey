import { spawn } from 'node:child_process';
import path from 'node:path';
import { runAttachmentFormat } from '@hey-hey/ui-common/agents';
import type { LocalRunAttachmentOpenAction } from '../shared/local-agent-api/generated/api';

export class AttachmentOpenerUnavailableError extends Error {
  public constructor(command: string, options?: ErrorOptions) {
    super(`The opener command "${command}" is unavailable.`, options);
    this.name = 'AttachmentOpenerUnavailableError';
  }
}

export type LaunchOpener = (command: string, args: readonly string[]) => Promise<void>;

// Detached, no shell, argument array only: a stored file name is never re-parsed.
export const launchOpener: LaunchOpener = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', detached: true, shell: false });
    child.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new AttachmentOpenerUnavailableError(command, { cause: error })
          : error,
      ),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export type ShowAttachment = (filePath: string) => Promise<LocalRunAttachmentOpenAction>;

/**
 * Images open in the default viewer; every other file is only revealed so a
 * sent script can never run. `filePath` must come from
 * `RunAttachmentStore.resolvePaths`, never from a caller.
 */
export const createAttachmentShower =
  ({
    platform = process.platform,
    launch = launchOpener,
  }: { platform?: NodeJS.Platform; launch?: LaunchOpener } = {}): ShowAttachment =>
  async (filePath) => {
    const format = runAttachmentFormat(path.basename(filePath));
    const open = format !== null && format !== 'text';
    if (platform === 'darwin') await launch('open', open ? [filePath] : ['-R', filePath]);
    // `cmd /c start` would re-parse the file name, so explorer.exe is called directly.
    else if (platform === 'win32')
      await launch('explorer.exe', [open ? filePath : `/select,${filePath}`]);
    // The attachment's own directory holds only this file.
    else if (platform === 'linux')
      await launch('xdg-open', [open ? filePath : path.dirname(filePath)]);
    else throw new AttachmentOpenerUnavailableError(`no opener for ${platform}`);
    return open ? 'opened' : 'revealed';
  };
