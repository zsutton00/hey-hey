import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ServerLogger } from '../../../server/logger';
import { constants } from 'node:fs';
import path from 'node:path';
import createIgnore, { type Ignore } from 'ignore';
import type {
  CaptureIdentity,
  CaptureRoot,
  ContentSnapshotData,
  SnapshotEntry,
} from './observation';
import type { ObservationStore } from './observation-store';

const exec = promisify(execFile);

interface DirectoryIgnoreRules {
  relative: string;
  matcher: Ignore;
}

const isIgnored = (
  relative: string,
  directory: boolean,
  rules: readonly DirectoryIgnoreRules[],
): boolean => {
  let ignored = false;
  for (const rule of rules) {
    const localPath = path.posix.relative(rule.relative, relative) + (directory ? '/' : '');
    const result = rule.matcher.test(localPath);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
};

/** Owns diagnostic progress for one scan, including waits that never return. */
class SnapshotProgress {
  private readonly startedAt = Date.now();
  private operationStartedAt = this.startedAt;
  private operation = 'starting';
  private serviceId: string | null = null;
  private repoRelativePath = '';
  private fileCount = 0;
  private directoryCount = 0;
  private gapCount = 0;
  private byteCount = 0;
  private readMs = 0;
  private blobWriteMs = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  public constructor(
    private readonly logger: ServerLogger,
    rootCount: number,
    private readonly signal?: AbortSignal,
  ) {
    this.logger.debug('execution_capture.snapshot_started', { rootCount });
    this.timer = setInterval(() => this.report('execution_capture.snapshot_progress'), 10_000);
    this.timer.unref();
    signal?.addEventListener('abort', this.stopTimer, { once: true });
  }

  public checkDeadline(): void {
    this.signal?.throwIfAborted();
    if (Date.now() - this.startedAt >= 1500) {
      throw new Error('Snapshot capture budget exceeded');
    }
  }

  public step(serviceId: string, repoRelativePath: string, operation: string): void {
    this.checkDeadline();
    this.serviceId = serviceId;
    this.repoRelativePath = repoRelativePath;
    this.operation = operation;
    this.operationStartedAt = Date.now();
  }

  public directory(): void {
    this.directoryCount += 1;
  }

  public read(bytes: number, elapsedMs: number): void {
    this.byteCount += bytes;
    this.readMs += elapsedMs;
  }

  public blobWritten(elapsedMs: number): void {
    this.blobWriteMs += elapsedMs;
  }

  public file(entry: SnapshotEntry, startedAt: number): void {
    this.fileCount += 1;
    if (entry.gap !== null) this.gapCount += 1;
    const elapsedMs = Date.now() - startedAt;
    if (entry.gap !== null || elapsedMs >= 1000) {
      this.logger.debug('execution_capture.snapshot_file_completed', {
        serviceId: entry.serviceId,
        repoRelativePath: entry.path,
        elapsedMs,
        gap: entry.gap,
      });
    }
  }

  public rootFailed(serviceId: string, reason: string): void {
    this.logger.warn('execution_capture.snapshot_root_failed', { serviceId, reason });
  }

  public failure(error: unknown): void {
    this.logger.debug('execution_capture.snapshot_operation_failed', {
      serviceId: this.serviceId,
      repoRelativePath: this.repoRelativePath,
      operation: this.operation,
      operationElapsedMs: Date.now() - this.operationStartedAt,
      errorName: error instanceof Error ? error.name : 'NonErrorThrow',
      errorCode: error instanceof Error && 'code' in error ? error.code : null,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  private report(event: string): void {
    this.logger.debug(event, {
      serviceId: this.serviceId,
      repoRelativePath: this.repoRelativePath,
      operation: this.operation,
      operationElapsedMs: Date.now() - this.operationStartedAt,
      elapsedMs: Date.now() - this.startedAt,
      fileCount: this.fileCount,
      directoryCount: this.directoryCount,
      gapCount: this.gapCount,
      byteCount: this.byteCount,
      readMs: this.readMs,
      blobWriteMs: this.blobWriteMs,
    });
  }

  private readonly stopTimer = (): void => {
    clearInterval(this.timer);
  };

  public close(): void {
    this.signal?.removeEventListener('abort', this.stopTimer);
    this.stopTimer();
    this.report('execution_capture.snapshot_finished');
  }
}

/** Reads bytes without following file symlinks; inventories are evidence, never ownership. */
export class ContentSnapshot {
  public constructor(
    private readonly store: ObservationStore,
    private readonly logger: ServerLogger,
  ) {}

  public async capture(
    roots: readonly CaptureRoot[],
    identity: CaptureIdentity,
    snapshotPhase: 'baseline' | 'final' | 'interrupt',
    previous?: ContentSnapshotData | null,
    signal?: AbortSignal,
  ): Promise<ContentSnapshotData> {
    const progress = new SnapshotProgress(
      this.logger.child({ ...identity, snapshotPhase, snapshotId: randomUUID() }),
      roots.length,
      signal,
    );
    const snapshot: ContentSnapshotData = { entries: [], rootFailures: [] };
    try {
      for (const root of roots) {
        try {
          progress.step(root.serviceId, '', 'root_realpath');
          const canonicalRoot = await fs.realpath(root.root);
          if (canonicalRoot !== path.resolve(root.root)) {
            snapshot.rootFailures.push(root.serviceId);
            progress.rootFailed(root.serviceId, 'root-path-changed');
            continue;
          }
          if (root.paths) {
            await this.captureNamedPaths(root, root.paths, snapshot.entries, progress);
          } else if (identity.toolName === 'Bash') {
            progress.step(root.serviceId, '', 'git_status');
            const paths = await this.gitStatusPaths(root);
            if (snapshotPhase === 'baseline') {
              snapshot.gitHeads ??= {};
              snapshot.gitHeads[root.serviceId] = await this.gitHead(root);
            }
            if (previous?.gitHeads && root.serviceId in previous.gitHeads) {
              await this.captureCleanBaselines(root, paths, previous, progress);
            }
            for (const entry of previous?.entries ?? []) {
              if (entry.serviceId === root.serviceId) {
                paths.add(entry.path);
              }
            }
            await this.captureNamedPaths(root, [...paths], snapshot.entries, progress);
          } else {
            await this.walk(root, '', snapshot.entries, progress, []);
          }
        } catch (error) {
          progress.failure(error);
          snapshot.rootFailures.push(root.serviceId);
          progress.rootFailed(root.serviceId, 'scan-failed');
        }
      }
      return snapshot;
    } finally {
      progress.close();
    }
  }

  private async gitHead(root: CaptureRoot): Promise<string | null> {
    try {
      const { stdout } = await exec('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
        cwd: root.root,
        timeout: 1500,
      });
      return stdout.trim();
    } catch (error) {
      // An unborn repository has no committed files.
      if (error instanceof Error && 'code' in error && error.code === 1) {
        return null;
      }
      throw error;
    }
  }

  /** A file absent from the earlier status matched that earlier HEAD, not today's HEAD. */
  private async captureCleanBaselines(
    root: CaptureRoot,
    paths: Set<string>,
    before: ContentSnapshotData,
    progress: SnapshotProgress,
  ): Promise<void> {
    const known = new Set(
      before.entries
        .filter((entry) => entry.serviceId === root.serviceId)
        .map((entry) => entry.path),
    );
    const head = before.gitHeads![root.serviceId];
    for (const relative of paths) {
      if (known.has(relative)) {
        continue;
      }
      progress.step(root.serviceId, relative, 'clean_baseline');
      let hash: string | null = null;
      let mode = 0;
      if (head) {
        const { stdout } = await exec(
          'git',
          ['ls-tree', '-z', head, '--', `:(literal)${relative}`],
          { cwd: root.root, timeout: 1500 },
        );
        if (stdout) {
          const metadata = stdout.slice(0, stdout.indexOf('\t')).split(' ');
          if (metadata[1] !== 'blob') {
            throw new Error('Clean baseline is not a file');
          }
          mode = Number.parseInt(metadata[0]!, 8);
          const blob = await exec('git', ['cat-file', 'blob', metadata[2]!], {
            cwd: root.root,
            timeout: 1500,
            encoding: 'buffer',
            maxBuffer: 16 * 1024 * 1024,
          });
          hash = await this.store.putBlob(blob.stdout);
        }
      }
      before.entries.push({ serviceId: root.serviceId, path: relative, hash, mode, gap: null });
    }
  }

  /** NUL framing preserves spaces, newlines and rename sources without Git's quoting. */
  private async gitStatusPaths(root: CaptureRoot): Promise<Set<string>> {
    const { stdout } = await exec(
      'git',
      [
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=all',
        '--',
        '.',
      ],
      { cwd: root.root, timeout: 1500, maxBuffer: 16 * 1024 * 1024 },
    );
    const { stdout: prefixOutput } = await exec('git', ['rev-parse', '--show-prefix'], {
      cwd: root.root,
      timeout: 1500,
    });
    const prefix = prefixOutput.replace(/\n$/, '');
    const records = stdout.split('\0');
    const paths = new Set<string>();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      if (!record) {
        continue;
      }
      paths.add(record.slice(3));
      if (record.slice(0, 2).includes('R') || record.slice(0, 2).includes('C')) {
        paths.add(records[++index]!);
      }
    }
    return new Set(
      [...paths]
        .map((relative) => path.posix.relative(prefix, relative))
        .filter(
          (relative) =>
            relative !== '..' &&
            !relative.startsWith('../') &&
            !this.store.contains(path.join(root.root, relative)),
        ),
    );
  }

  /** Reads only the named files; one that does not exist is recorded as absent, not as a gap. */
  private async captureNamedPaths(
    root: CaptureRoot,
    paths: readonly string[],
    entries: SnapshotEntry[],
    progress: SnapshotProgress,
  ): Promise<void> {
    for (const repoRelativePath of paths) {
      progress.checkDeadline();
      const filePath = path.join(root.root, repoRelativePath);
      const startedAt = Date.now();
      const absent = await fs.lstat(filePath).then(
        () => false,
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT',
      );
      const entry: SnapshotEntry = absent
        ? { serviceId: root.serviceId, path: repoRelativePath, mode: 0, hash: null, gap: null }
        : await this.captureFile(root.serviceId, repoRelativePath, filePath, progress);
      entries.push(entry);
      progress.file(entry, startedAt);
    }
  }

  private async walk(
    root: CaptureRoot,
    relative: string,
    entries: SnapshotEntry[],
    progress: SnapshotProgress,
    inheritedRules: readonly DirectoryIgnoreRules[],
  ): Promise<void> {
    const directory = path.join(root.root, relative);
    progress.step(root.serviceId, relative, 'directory_realpath');
    // Do not traverse a directory swapped for a symlink after enumeration.
    if ((await fs.realpath(directory)) !== directory)
      throw new Error('Directory changed during capture');
    progress.step(root.serviceId, relative, 'directory_readdir');
    const items = await fs.readdir(directory, { withFileTypes: true });
    progress.directory();
    // Read rules only from directories we enter. An ignored parent cannot be
    // re-included by a .gitignore inside that parent.
    let rules = inheritedRules;
    const ignoreFile = items.find((item) => item.name === '.gitignore' && item.isFile());
    if (ignoreFile) {
      progress.step(root.serviceId, relative, 'gitignore_read');
      const handle = await fs.open(
        path.join(directory, ignoreFile.name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Ignore file changed during capture');
        rules = [
          ...inheritedRules,
          { relative, matcher: createIgnore().add(await handle.readFile('utf8')) },
        ];
      } finally {
        await handle.close();
      }
      this.logger.debug('execution_capture.snapshot_ignore_rules_loaded', {
        serviceId: root.serviceId,
        repoRelativePath: relative,
      });
    }
    for (const item of items) {
      if (item.name === '.git') continue;
      const filePath = path.join(directory, item.name);
      if (this.store.contains(filePath)) continue;
      const repoRelativePath = path.posix.join(relative, item.name);
      if (isIgnored(repoRelativePath, item.isDirectory(), rules)) {
        this.logger.trace('execution_capture.snapshot_path_ignored', {
          serviceId: root.serviceId,
          repoRelativePath,
          directory: item.isDirectory(),
        });
        continue;
      }
      if (item.isDirectory()) {
        try {
          await this.walk(root, repoRelativePath, entries, progress, rules);
        } catch (error) {
          progress.failure(error);
          entries.push({
            serviceId: root.serviceId,
            path: repoRelativePath,
            mode: 0,
            hash: null,
            gap: 'unreadable',
          });
        }
        continue;
      }
      const fileStartedAt = Date.now();
      const entry = await this.captureFile(root.serviceId, repoRelativePath, filePath, progress);
      entries.push(entry);
      progress.file(entry, fileStartedAt);
    }
  }

  private async captureFile(
    serviceId: string,
    relative: string,
    filePath: string,
    progress: SnapshotProgress,
  ): Promise<SnapshotEntry> {
    const entry: SnapshotEntry = { serviceId, path: relative, mode: 0, hash: null, gap: null };
    try {
      progress.step(serviceId, relative, 'file_realpath');
      if ((await fs.realpath(filePath)) !== filePath) return { ...entry, gap: 'symlink' };
      progress.step(serviceId, relative, 'file_lstat');
      const stat = await fs.lstat(filePath);
      entry.mode = stat.mode;
      if (stat.isSymbolicLink()) return { ...entry, gap: 'symlink' };
      if (!stat.isFile()) return { ...entry, gap: 'special_file' };
      progress.step(serviceId, relative, 'file_open');
      const handle = await fs.open(
        filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        progress.step(serviceId, relative, 'file_validate');
        const opened = await handle.stat();
        if (!opened.isFile()) return { ...entry, gap: 'special_file' };
        if (
          opened.ino !== stat.ino ||
          opened.dev !== stat.dev ||
          (await fs.realpath(filePath)) !== filePath
        )
          return { ...entry, gap: 'changed_during_capture' };
        progress.step(serviceId, relative, 'file_read');
        const readStartedAt = Date.now();
        const bytes = await handle.readFile();
        progress.read(bytes.length, Date.now() - readStartedAt);
        progress.step(serviceId, relative, 'file_post_read_stat');
        const after = await handle.stat();
        progress.step(serviceId, relative, 'blob_write');
        const blobStartedAt = Date.now();
        const hash = await this.store.putBlob(bytes);
        progress.blobWritten(Date.now() - blobStartedAt);
        const changed =
          opened.ino !== stat.ino ||
          opened.size !== after.size ||
          opened.mtimeMs !== after.mtimeMs ||
          opened.ctimeMs !== after.ctimeMs;
        return { ...entry, hash, gap: changed ? 'changed_during_capture' : null };
      } finally {
        await handle.close();
      }
    } catch (error) {
      progress.failure(error);
      return { ...entry, gap: 'unreadable' };
    }
  }
}
