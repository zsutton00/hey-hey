import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { stripCredentialEnvironment } from '../../agent-runtime/node/credential-environment';
import type { ServerLogger } from '../../server/logger';
import { resolveBaseDir } from '../../session/paths';
import type { ServiceId } from '../../repo/types';

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_OPEN_WORKSPACES = 3;

export interface EvalWorkspaceRequest {
  attemptId: string;
  serviceId: string;
  commitSha: string;
}

export interface EvalWorkspace {
  /** The throwaway clone; the attempt's only writable directory. */
  readonly directory: string;
  /** Removes the directory and frees the slot. Safe to call more than once. */
  release(): Promise<void>;
}

export interface EvalWorkspaceRepositories {
  resolvePathForService(serviceId: ServiceId): Promise<string>;
}

export interface EvalWorkspacesOptions {
  rootDirectory?: string;
  maxOpen?: number;
}

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    env: stripCredentialEnvironment(process.env),
  });

  return stdout;
};

/**
 * Deletes a directory tree. Trees the agent or a package manager made read-only
 * (and the read-only bases older versions prepared) must be writable to be removed.
 */
const removeTree = async (directory: string): Promise<void> => {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    await execFileAsync('chmod', ['-R', 'u+w', directory]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
};

/**
 * Owns the throwaway checkouts coding eval attempts edit. Each is a clone that
 * shares no objects with the Service's repository and keeps no remote, push
 * target or credential helper, so nothing an attempt does can leave it.
 */
export class EvalWorkspaces {
  private readonly rootDirectory: string;
  /** Where older versions prepared shared dependencies; only ever deleted. */
  private readonly legacyPreparedDirectory: string;
  private readonly maxOpen: number;
  private readonly open = new Set<string>();
  /** Slots held by attempts, including one handed to a waiter that has not resumed yet. */
  private slotsInUse = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(
    private readonly repositories: EvalWorkspaceRepositories,
    private readonly logger: ServerLogger,
    options: EvalWorkspacesOptions = {},
  ) {
    this.rootDirectory = options.rootDirectory ?? path.join(resolveBaseDir(), 'eval-workspaces');
    this.legacyPreparedDirectory = path.join(path.dirname(this.rootDirectory), 'eval-prepared');
    this.maxOpen = options.maxOpen ?? DEFAULT_MAX_OPEN_WORKSPACES;
  }

  /** Waits for a free slot, then clones the Service at the pinned commit. */
  public async acquire(request: EvalWorkspaceRequest, signal: AbortSignal): Promise<EvalWorkspace> {
    await this.takeSlot(request.attemptId, signal);
    const directory = path.join(this.rootDirectory, randomUUID());
    this.open.add(directory);

    try {
      const source = await this.repositories.resolvePathForService(request.serviceId as ServiceId);
      await this.checkout(directory, source, request.commitSha);
    } catch (error) {
      this.logger.warn('run_eval.workspace.acquire_failed', {
        attemptId: request.attemptId,
        serviceId: request.serviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.remove(directory);
      throw new Error(
        `The attempt's workspace could not be created: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    this.logger.info('run_eval.workspace.acquired', {
      attemptId: request.attemptId,
      serviceId: request.serviceId,
      commitSha: request.commitSha,
      directory,
    });

    let released = false;

    return {
      directory,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await this.remove(directory);
        this.logger.info('run_eval.workspace.released', {
          attemptId: request.attemptId,
          directory,
        });
      },
    };
  }

  /**
   * Deletes every workspace directory no open attempt owns, left by an interrupted run.
   * Assumes a single CLI process owns the `eval-workspaces` directory.
   */
  public async sweep(): Promise<void> {
    await removeTree(this.legacyPreparedDirectory);
    let names: string[];
    try {
      names = await readdir(this.rootDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    const leftovers = names
      .map((name) => path.join(this.rootDirectory, name))
      .filter((directory) => !this.open.has(directory));
    await Promise.all(leftovers.map((directory) => removeTree(directory)));
    this.logger.info('run_eval.workspace.swept', { removed: leftovers.length });
  }

  private async takeSlot(attemptId: string, signal: AbortSignal): Promise<void> {
    if (this.slotsInUse < this.maxOpen && this.waiting.length === 0) {
      this.slotsInUse += 1;

      return;
    }
    this.logger.info('run_eval.workspace.waiting', { attemptId, open: this.slotsInUse });
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiting.indexOf(wake);
        if (index >= 0) {
          this.waiting.splice(index, 1);
        }
        reject(new Error('Stopped while waiting for a free workspace.'));
      };
      const wake = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      if (signal.aborted) {
        onAbort();

        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(wake);
    });
  }

  private async checkout(directory: string, source: string, commitSha: string): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await git(this.rootDirectory, [
      'clone',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      source,
      directory,
    ]);
    await git(directory, ['checkout', '--detach', commitSha]);

    const remotes = (await git(directory, ['remote'])).split('\n').filter(Boolean);
    for (const remote of remotes) {
      await git(directory, ['remote', 'remove', remote]);
    }
    await git(directory, ['config', '--local', 'push.default', 'nothing']);
    await git(directory, ['config', '--local', '--replace-all', 'credential.helper', '']);
  }

  /**
   * Removes the directory and frees its slot. A waiting attempt receives the slot
   * directly, so the count never drops while it is being handed over.
   */
  private async remove(directory: string): Promise<void> {
    try {
      await removeTree(directory);
    } finally {
      this.open.delete(directory);
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.slotsInUse -= 1;
      }
    }
  }
}
