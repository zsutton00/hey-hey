import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises';
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
  /** The environment attempt processes and test commands run with. */
  readonly environment: NodeJS.ProcessEnv;
  /** Time this attempt spent preparing dependencies or waiting for that preparation. */
  readonly preparationMs: number;
  /** Removes the directory and frees the slot. Safe to call more than once. */
  release(): Promise<void>;
}

export interface EvalWorkspaceRepositories {
  resolvePathForService(serviceId: ServiceId): Promise<string>;
}

export interface EvalWorkspacesOptions {
  rootDirectory?: string;
  /** Where prepared bases live; defaults to a directory beside `rootDirectory`. */
  preparedDirectory?: string;
  maxOpen?: number;
}

/** Directories (relative to the checkout) a prepared base shares read-only with its workspaces. */
type PreparedBase = { directory: string; sharedPaths: string[] };

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    env: stripCredentialEnvironment(process.env),
  });

  return stdout;
};

const run = async (cwd: string, command: string, args: readonly string[]): Promise<void> => {
  await execFileAsync(command, [...args], {
    cwd,
    env: stripCredentialEnvironment(process.env),
    maxBuffer: 16 * 1024 * 1024,
  });
};

/**
 * Preparation is derived from the lockfile at the pinned commit: a pnpm lockfile
 * means install its dependencies (the `bootstrap` script when the repository
 * defines one), then run the `generate:contracts` script if present. Services
 * without a pnpm lockfile are not prepared.
 */
const preparationSteps = async (source: string, commitSha: string): Promise<string[][]> => {
  const hasLockfile = await git(source, ['cat-file', '-e', `${commitSha}:pnpm-lock.yaml`]).then(
    () => true,
    () => false,
  );
  if (!hasLockfile) {
    return [];
  }
  const manifest = JSON.parse(await git(source, ['show', `${commitSha}:package.json`])) as {
    scripts?: Record<string, string>;
  };
  const scripts = manifest.scripts ?? {};
  const steps = [scripts['bootstrap'] ? ['run', 'bootstrap'] : ['install', '--frozen-lockfile']];
  if (scripts['generate:contracts']) {
    steps.push(['run', 'generate:contracts']);
  }

  return steps;
};

/** Git-ignored directories the preparation produced: installed dependencies and generated output. */
const listPreparedDirectories = async (directory: string): Promise<string[]> => {
  const output = await git(directory, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ]);

  return output
    .split('\0')
    .filter((entry) => entry.endsWith('/'))
    .map((entry) => entry.slice(0, -1));
};

/**
 * Removes write permission from the prepared output. This stops accidental
 * writes through a workspace's links; it is not a security boundary. The base is
 * owned by the user running the attempts, so a command that restores write
 * permission (`chmod`) can still change it. That is accepted: test commands come
 * from the case author, and the agent has no shell (see the coding-evaluation
 * Decision), so nothing the agent controls runs a command.
 */
const makeReadOnly = (directory: string): Promise<void> =>
  run(directory, 'chmod', ['-R', 'a-w', '.']);

const isInside = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Resolves when `signal` aborts; `stop` detaches the listener. */
const abortion = (
  signal: AbortSignal,
  message: string,
): { aborted: Promise<never>; stop: () => void } => {
  let stop = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(new Error(message));
    if (signal.aborted) {
      onAbort();

      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    stop = () => signal.removeEventListener('abort', onAbort);
  });
  // A rejection nobody raced against (the attempt finished first) is not an error.
  aborted.catch(() => undefined);

  return { aborted, stop };
};

const removeBase = async (directory: string): Promise<void> => {
  // Prepared output is read-only; it must be writable again to be deleted.
  await run(path.dirname(directory), 'chmod', ['-R', 'u+w', directory]).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
};

/**
 * Owns the throwaway checkouts coding eval attempts edit. Each is a clone that
 * shares no objects with the Service's repository and keeps no remote, push
 * target or credential helper, so nothing an attempt does can leave it.
 */
export class EvalWorkspaces {
  private readonly rootDirectory: string;
  private readonly preparedDirectory: string;
  /** One preparation per (Service, commit); concurrent first attempts share the same promise. */
  private readonly bases = new Map<string, Promise<PreparedBase | undefined>>();
  private readonly maxOpen: number;
  /** Open workspace directory -> the key of the prepared base it uses. */
  private readonly open = new Map<string, string>();
  /** Slots held by attempts, including one handed to a waiter that has not resumed yet. */
  private slotsInUse = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(
    private readonly repositories: EvalWorkspaceRepositories,
    private readonly logger: ServerLogger,
    options: EvalWorkspacesOptions = {},
  ) {
    this.rootDirectory = options.rootDirectory ?? path.join(resolveBaseDir(), 'eval-workspaces');
    this.preparedDirectory =
      options.preparedDirectory ?? path.join(path.dirname(this.rootDirectory), 'eval-prepared');
    this.maxOpen = options.maxOpen ?? DEFAULT_MAX_OPEN_WORKSPACES;
  }

  /** Waits for a free slot, then clones the Service at the pinned commit. */
  public async acquire(request: EvalWorkspaceRequest, signal: AbortSignal): Promise<EvalWorkspace> {
    await this.takeSlot(request.attemptId, signal);
    const directory = path.join(this.rootDirectory, randomUUID());
    const key = `${request.serviceId}@${request.commitSha}`;
    this.open.set(directory, key);
    let preparationMs = 0;

    try {
      const preparationStartedAt = Date.now();
      const source = await this.repositories.resolvePathForService(request.serviceId as ServiceId);
      const base = await this.untilPrepared(this.preparedBase(key, source, request), signal);
      preparationMs = Date.now() - preparationStartedAt;
      await this.checkout(directory, source, request.commitSha);
      if (base) {
        await this.linkPreparedOutput(directory, base);
      }
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
      environment: stripCredentialEnvironment(process.env),
      preparationMs,
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
    await this.removeStrayBases();
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
    await Promise.all(
      leftovers.map((directory) => rm(directory, { recursive: true, force: true })),
    );
    this.logger.info('run_eval.workspace.swept', { removed: leftovers.length });
  }

  /**
   * Removes the prepared bases no open workspace is using. Called when an eval
   * run ends. Eval runs can overlap in one CLI process (the runtime shares one
   * `EvalWorkspaces`, and nothing serializes `run_eval` Runs), so a base another
   * run's attempts still link to is kept; its own run removes it when it ends.
   */
  public async removePreparedBases(): Promise<void> {
    const inUse = new Set(this.open.values());
    const removable = [...this.bases].filter(([key]) => !inUse.has(key));
    for (const [key] of removable) {
      this.bases.delete(key);
    }
    const bases = await Promise.all(removable.map(([, base]) => base.catch(() => undefined)));
    await Promise.all(bases.map((base) => base && removeBase(base.directory)));
    this.logger.info('run_eval.workspace.bases_removed', {
      removed: removable.length,
      kept: this.bases.size,
    });
  }

  /**
   * Deletes prepared bases left by an interrupted run: every directory this
   * process is not tracking. Bases being prepared or in use by an overlapping
   * run are tracked, so they are kept.
   */
  private async removeStrayBases(): Promise<void> {
    const names = await readdir(this.preparedDirectory).catch(() => [] as string[]);
    const tracked = new Set(
      [...this.bases.keys()].map((key) => path.basename(this.baseDirectory(key))),
    );
    const strays = names.filter((name) => !tracked.has(name));
    await Promise.all(strays.map((name) => removeBase(path.join(this.preparedDirectory, name))));
  }

  private baseDirectory(key: string): string {
    return path.join(
      this.preparedDirectory,
      createHash('sha256').update(key).digest('hex').slice(0, 16),
    );
  }

  /**
   * Waits for the base, but a cancelled attempt stops waiting at once so its slot
   * is freed. The preparation carries on for the attempts still waiting on it.
   */
  private async untilPrepared<T>(preparation: Promise<T>, signal: AbortSignal): Promise<T> {
    const { aborted, stop } = abortion(
      signal,
      'Stopped while waiting for dependencies to be prepared.',
    );
    try {
      return await Promise.race([preparation, aborted]);
    } finally {
      stop();
    }
  }

  /**
   * The prepared base for the attempt's Service and commit, created by the first
   * attempt that asks. A failed preparation is remembered, so every attempt from
   * that commit fails with the same reason and none retries it.
   */
  private preparedBase(
    key: string,
    source: string,
    request: EvalWorkspaceRequest,
  ): Promise<PreparedBase | undefined> {
    let base = this.bases.get(key);
    if (!base) {
      base = this.createBase(key, source, request);
      this.bases.set(key, base);
    }

    return base;
  }

  private async createBase(
    key: string,
    source: string,
    request: EvalWorkspaceRequest,
  ): Promise<PreparedBase | undefined> {
    const directory = this.baseDirectory(key);
    const startedAt = Date.now();

    try {
      await mkdir(this.preparedDirectory, { recursive: true });
      const steps = await preparationSteps(source, request.commitSha);
      if (steps.length === 0) {
        this.logger.info('run_eval.workspace.base_not_needed', { key });

        return undefined;
      }
      await this.checkout(directory, source, request.commitSha);
      for (const step of steps) {
        await run(directory, 'pnpm', step);
      }
      const sharedPaths = await listPreparedDirectories(directory);
      await makeReadOnly(directory);
      this.logger.info('run_eval.workspace.base_prepared', {
        key,
        sharedPaths,
        elapsedMs: Date.now() - startedAt,
      });

      return { directory, sharedPaths };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn('run_eval.workspace.base_failed', { key, error: reason });
      await removeBase(directory);
      throw new Error(
        `Dependencies for commit ${request.commitSha} could not be prepared: ${reason}`,
        {
          cause: error,
        },
      );
    }
  }

  /** Links the base's dependency and generated-output directories into a workspace and hides them from git. */
  private async linkPreparedOutput(workspace: string, base: PreparedBase): Promise<void> {
    for (const sharedPath of base.sharedPaths) {
      const link = path.join(workspace, sharedPath);
      await mkdir(path.dirname(link), { recursive: true });
      if (path.basename(sharedPath) === 'node_modules') {
        await this.linkDependencies(workspace, base, sharedPath);
      } else {
        await symlink(path.join(base.directory, sharedPath), link, 'dir');
      }
    }
    const exclude = path.join(workspace, '.git', 'info', 'exclude');
    await mkdir(path.dirname(exclude), { recursive: true });
    await appendFile(exclude, base.sharedPaths.map((sharedPath) => `/${sharedPath}\n`).join(''));
  }

  /**
   * Links a `node_modules` directory entry by entry. A package manager workspace
   * link (`node_modules/a -> ../../a`) must point at the attempt's own copy of the
   * package, not at the base's, or a dependent package would run the base's code
   * instead of the attempt's edits. Those links are recreated relative to the
   * workspace; every other entry (external dependencies) is shared with the base.
   */
  private async linkDependencies(
    workspace: string,
    base: PreparedBase,
    sharedPath: string,
  ): Promise<void> {
    const baseModules = path.join(base.directory, sharedPath);
    const workspaceModules = path.join(workspace, sharedPath);
    await mkdir(workspaceModules, { recursive: true });

    for (const name of await readdir(baseModules)) {
      const entries = name.startsWith('@')
        ? (await readdir(path.join(baseModules, name))).map((scoped) => path.join(name, scoped))
        : [name];
      if (name.startsWith('@')) {
        await mkdir(path.join(workspaceModules, name), { recursive: true });
      }
      for (const entry of entries) {
        const baseEntry = path.join(baseModules, entry);
        const target = await readlink(baseEntry).catch(() => undefined);
        const resolved =
          target === undefined ? undefined : path.resolve(path.dirname(baseEntry), target);
        const isWorkspacePackage =
          resolved !== undefined &&
          isInside(base.directory, resolved) &&
          !base.sharedPaths.some((shared) => isInside(path.join(base.directory, shared), resolved));
        await symlink(
          isWorkspacePackage ? (target ?? baseEntry) : baseEntry,
          path.join(workspaceModules, entry),
          'dir',
        );
      }
    }
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
      await rm(directory, { recursive: true, force: true });
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
