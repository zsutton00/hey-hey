import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { FileScanner } from './scanner';
import type { DetectedLanguage, ScannerIndex, ScannerQuery, ScannerQueryResult } from './types';

const WATCH_SKIP_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);

export interface ScannerServiceOptions {
  maxDepth?: number;
  includeDotfiles?: boolean;
  watch?: boolean;
}

interface ScannerSession {
  canonicalRootPath: string;
  scanner: FileScanner;
  watcher: FSWatcher | null;
  dirty: boolean;
  refreshPromise: Promise<ScannerIndex> | null;
}

const shouldIgnoreWatchedPath = (watchedPath: string): boolean => {
  const segments = watchedPath.split(path.sep);
  return segments.some((segment) => WATCH_SKIP_SEGMENTS.has(segment));
};

const canonicalizeRootPath = async (rootPath: string): Promise<string> => {
  const absolutePath = path.isAbsolute(rootPath) ? rootPath : path.resolve(process.cwd(), rootPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error(`Scanner root path is not a directory: ${absolutePath}`);
  }
  return fs.realpath(absolutePath);
};

export class ScannerService {
  private readonly sessions = new Map<string, ScannerSession>();
  private readonly maxDepth: number;
  private readonly includeDotfiles: boolean;
  private readonly watch: boolean;

  constructor(options: ScannerServiceOptions = {}) {
    this.maxDepth = options.maxDepth ?? 6;
    this.includeDotfiles = options.includeDotfiles ?? false;
    this.watch = options.watch ?? true;
  }

  private createWatcher(entry: ScannerSession): FSWatcher | null {
    if (!this.watch) {
      return null;
    }

    const watcher = chokidar.watch(entry.canonicalRootPath, {
      ignored: shouldIgnoreWatchedPath,
      ignoreInitial: true,
      persistent: false,
      depth: this.maxDepth,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 60,
        pollInterval: 20,
      },
    });

    watcher.on('all', () => {
      entry.dirty = true;
    });

    watcher.on('error', () => {
      // Fall back to full refresh next query if watch stream is unstable.
      entry.dirty = true;
    });

    return watcher;
  }

  private async getOrCreateSession(rootPath: string): Promise<ScannerSession> {
    const canonicalRootPath = await canonicalizeRootPath(rootPath);
    const existing = this.sessions.get(canonicalRootPath);
    if (existing) {
      return existing;
    }

    const scanner = new FileScanner({
      rootPath: canonicalRootPath,
      maxDepth: this.maxDepth,
      includeDotfiles: this.includeDotfiles,
    });

    const entry: ScannerSession = {
      canonicalRootPath,
      scanner,
      watcher: null,
      dirty: true,
      refreshPromise: null,
    };

    entry.watcher = this.createWatcher(entry);
    this.sessions.set(canonicalRootPath, entry);
    return entry;
  }

  private async refreshSession(entry: ScannerSession): Promise<ScannerIndex> {
    if (entry.refreshPromise) {
      return entry.refreshPromise;
    }

    entry.refreshPromise = entry.scanner
      .refreshIndex()
      .then((index) => {
        entry.dirty = false;
        return index;
      })
      .finally(() => {
        entry.refreshPromise = null;
      });

    return entry.refreshPromise;
  }

  async ensureIndexed(rootPath: string): Promise<ScannerIndex> {
    const entry = await this.getOrCreateSession(rootPath);
    const currentIndex = entry.scanner.getIndex();

    if (!currentIndex || entry.dirty) {
      return this.refreshSession(entry);
    }

    return currentIndex;
  }

  async refresh(rootPath: string): Promise<ScannerIndex> {
    const entry = await this.getOrCreateSession(rootPath);
    return this.refreshSession(entry);
  }

  async markDirty(rootPath: string): Promise<void> {
    const entry = await this.getOrCreateSession(rootPath);
    entry.dirty = true;
  }

  async closeRoot(rootPath: string): Promise<void> {
    const canonicalRootPath = await canonicalizeRootPath(rootPath);
    const entry = this.sessions.get(canonicalRootPath);
    if (!entry) {
      return;
    }

    await entry.watcher?.close();
    this.sessions.delete(canonicalRootPath);
  }

  async queryFiles(rootPath: string, query: ScannerQuery = {}): Promise<ScannerQueryResult> {
    const entry = await this.getOrCreateSession(rootPath);
    await this.ensureIndexed(rootPath);
    return entry.scanner.queryFiles(query);
  }

  async getLanguageSummary(rootPath: string): Promise<Readonly<Record<DetectedLanguage, number>>> {
    const entry = await this.getOrCreateSession(rootPath);
    await this.ensureIndexed(rootPath);
    return entry.scanner.getLanguageSummary();
  }

  async getCandidateEntrypoints(rootPath: string): Promise<readonly string[]> {
    const entry = await this.getOrCreateSession(rootPath);
    await this.ensureIndexed(rootPath);
    return entry.scanner.getCandidateEntrypoints();
  }

  listTrackedRoots(): readonly string[] {
    return [...this.sessions.keys()].sort((a, b) => a.localeCompare(b));
  }

  async dispose(): Promise<void> {
    const closePromises = [...this.sessions.values()].map((entry) => entry.watcher?.close());
    await Promise.all(closePromises);
    this.sessions.clear();
  }
}
