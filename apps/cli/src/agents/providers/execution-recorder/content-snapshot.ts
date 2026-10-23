import fs from 'node:fs/promises';
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
  ) {
    this.logger.debug('execution_capture.snapshot_started', { rootCount });
    this.timer = setInterval(() => this.report('execution_capture.snapshot_progress'), 10_000);
    this.timer.unref();
  }

  public step(serviceId: string, repoRelativePath: string, operation: string): void {
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

  public failure(errorName: string, errorCode: string | null): void {
    this.logger.debug('execution_capture.snapshot_operation_failed', {
      serviceId: this.serviceId,
      repoRelativePath: this.repoRelativePath,
      operation: this.operation,
      operationElapsedMs: Date.now() - this.operationStartedAt,
      errorName,
      errorCode,
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

  public close(): void {
    clearInterval(this.timer);
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
  ): Promise<ContentSnapshotData> {
    const progress = new SnapshotProgress(
      this.logger.child({ ...identity, snapshotPhase, snapshotId: randomUUID() }),
      roots.length,
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
          await this.walk(root, '', snapshot.entries, progress, []);
        } catch (error) {
          progress.failure(
            error instanceof Error ? error.name : 'NonErrorThrow',
            error instanceof Error && 'code' in error && typeof error.code === 'string'
              ? error.code
              : null,
          );
          snapshot.rootFailures.push(root.serviceId);
          progress.rootFailed(root.serviceId, 'scan-failed');
        }
      }
      return snapshot;
    } finally {
      progress.close();
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
          progress.failure(
            error instanceof Error ? error.name : 'NonErrorThrow',
            error instanceof Error && 'code' in error && typeof error.code === 'string'
              ? error.code
              : null,
          );
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
        progress.step(serviceId, relative, 'file_close');
        await handle.close();
      }
    } catch (error) {
      progress.failure(
        error instanceof Error ? error.name : 'NonErrorThrow',
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null,
      );
      return { ...entry, gap: 'unreadable' };
    }
  }
}
