import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ValidatedProjectModeSnapshot } from './project-mode-snapshot';

export class ProjectModeBundleValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectModeBundleValidationError';
  }
}

interface ValidatedBundleFile {
  readonly relativePath: string;
  readonly contents: string;
}

interface ProjectModeMaterialization {
  readonly directory: Promise<string>;
  readonly files: readonly ValidatedBundleFile[];
}

export interface ProjectModeBundleMaterializerOptions {
  /** Test seam for the runtime-owned temporary parent. */
  readonly runtimeRoot?: string;
}

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const sessionDirectoryName = (sessionId: string): string =>
  createHash('sha256').update(sessionId).digest('hex');

/** Owns immutable, provider-readable MODE bundles for one CLI runtime. */
export class ProjectModeBundleMaterializer {
  private readonly materializations = new Map<string, ProjectModeMaterialization>();
  private runtimeRootPromise: Promise<string> | null = null;

  public constructor(private readonly options: ProjectModeBundleMaterializerOptions = {}) {}

  public validate(snapshot: ValidatedProjectModeSnapshot): void {
    this.validateFiles(snapshot);
  }

  private validateFiles(snapshot: ValidatedProjectModeSnapshot): readonly ValidatedBundleFile[] {
    const files: ValidatedBundleFile[] = [];
    const normalizedPaths = new Set<string>();

    for (const [capturedPath, contents] of Object.entries(snapshot.files.files)) {
      if (capturedPath.length === 0 || capturedPath.trim().length === 0) {
        throw new ProjectModeBundleValidationError('MODE bundle paths must not be empty.');
      }
      if (
        path.posix.isAbsolute(capturedPath) ||
        path.win32.isAbsolute(capturedPath) ||
        capturedPath.includes('\\') ||
        capturedPath.includes('\0')
      ) {
        throw new ProjectModeBundleValidationError(
          `MODE bundle path "${capturedPath}" must be a relative POSIX path.`,
        );
      }

      const segments = capturedPath.split('/');
      if (segments.some((segment) => segment === '..')) {
        throw new ProjectModeBundleValidationError(
          `MODE bundle path "${capturedPath}" contains traversal.`,
        );
      }
      const normalizedPath = path.posix.normalize(capturedPath);
      if (
        normalizedPath === '.' ||
        normalizedPath.length === 0 ||
        normalizedPath.startsWith('../') ||
        path.posix.isAbsolute(normalizedPath)
      ) {
        throw new ProjectModeBundleValidationError(
          `MODE bundle path "${capturedPath}" does not resolve to a contained file.`,
        );
      }
      if (normalizedPaths.has(normalizedPath)) {
        throw new ProjectModeBundleValidationError(
          `MODE bundle contains duplicate normalized path "${normalizedPath}".`,
        );
      }

      normalizedPaths.add(normalizedPath);
      files.push({ relativePath: normalizedPath, contents });
    }

    if (!normalizedPaths.has('MODE.md')) {
      throw new ProjectModeBundleValidationError('MODE bundle must contain MODE.md.');
    }

    for (const file of files) {
      const segments = file.relativePath.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const directoryPath = segments.slice(0, index).join('/');
        if (normalizedPaths.has(directoryPath)) {
          throw new ProjectModeBundleValidationError(
            `MODE bundle path "${file.relativePath}" collides with file "${directoryPath}".`,
          );
        }
      }
    }

    return Object.freeze(files.map((file) => Object.freeze(file)));
  }

  public async materialize(
    sessionId: string,
    snapshot: ValidatedProjectModeSnapshot,
  ): Promise<string> {
    const existing = this.materializations.get(sessionId);
    const validatedFiles = this.validateFiles(snapshot);
    if (existing) {
      const existingDirectory = await existing.directory;
      if (await this.isValidMaterialization(existingDirectory, existing.files)) {
        return existingDirectory;
      }
      if (this.materializations.get(sessionId) === existing) {
        this.materializations.delete(sessionId);
      }
      return await this.startMaterialization(sessionId, existing.files);
    }

    return await this.startMaterialization(sessionId, validatedFiles);
  }

  private async startMaterialization(
    sessionId: string,
    files: readonly ValidatedBundleFile[],
  ): Promise<string> {
    const materialization = this.writeAtomically(sessionId, files).catch(
      (error: unknown) => {
        this.materializations.delete(sessionId);
        throw error;
      },
    );
    this.materializations.set(sessionId, { directory: materialization, files });
    return await materialization;
  }

  public async dispose(): Promise<void> {
    const runtimeRootPromise = this.runtimeRootPromise;
    this.materializations.clear();
    this.runtimeRootPromise = null;
    if (!runtimeRootPromise) return;
    const runtimeRoot = await runtimeRootPromise;
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }

  private async runtimeRoot(): Promise<string> {
    if (!this.runtimeRootPromise) {
      const configuredRoot = this.options.runtimeRoot;
      this.runtimeRootPromise = configuredRoot
        ? fs.mkdir(configuredRoot, { recursive: true }).then(() => fs.realpath(configuredRoot))
        : fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-project-mode-runtime-'));
    }
    return this.runtimeRootPromise;
  }

  private async writeAtomically(
    sessionId: string,
    files: readonly ValidatedBundleFile[],
  ): Promise<string> {
    const runtimeRoot = await this.runtimeRoot();
    const bundleDirectory = path.join(runtimeRoot, sessionDirectoryName(sessionId));
    try {
      const existing = await fs.realpath(bundleDirectory);
      if (!isWithinRoot(existing, runtimeRoot)) {
        throw new ProjectModeBundleValidationError(
          'Existing MODE bundle directory resolves outside the runtime root.',
        );
      }
      if (await this.isValidMaterialization(existing, files)) return existing;
      await fs.rm(existing, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const stagingDirectory = await fs.mkdtemp(path.join(runtimeRoot, '.staging-'));
    try {
      for (const file of files) {
        const destination = path.resolve(stagingDirectory, file.relativePath);
        if (!isWithinRoot(destination, stagingDirectory)) {
          throw new ProjectModeBundleValidationError(
            `MODE bundle path "${file.relativePath}" escapes its staging directory.`,
          );
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.contents, { encoding: 'utf8', flag: 'wx' });
      }
      try {
        await fs.rename(stagingDirectory, bundleDirectory);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
      }
      return await fs.realpath(bundleDirectory);
    } finally {
      await fs.rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  private async isValidMaterialization(
    bundleDirectory: string,
    expectedFiles: readonly ValidatedBundleFile[],
  ): Promise<boolean> {
    try {
      const actualFiles = await this.readMaterializedFiles(bundleDirectory);
      if (actualFiles.size !== expectedFiles.length) return false;
      return expectedFiles.every((file) => actualFiles.get(file.relativePath) === file.contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async readMaterializedFiles(
    directory: string,
    relativeDirectory = '',
  ): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.readMaterializedFiles(absolutePath, relativePath);
        for (const [nestedPath, contents] of nested) files.set(nestedPath, contents);
      } else if (entry.isFile()) {
        files.set(relativePath, await fs.readFile(absolutePath, 'utf8'));
      } else {
        return new Map([['__invalid_entry__', '']]);
      }
    }
    return files;
  }
}
