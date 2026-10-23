import { copyFile, mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ServerLogger } from '../logger';

interface UsageFile {
  file: string;
  relative: string;
  homeIndex: number;
  kind: 'sessions' | 'archived_sessions';
}

const metadataSchema = z.object({
  type: z.literal('session_meta'),
  payload: z
    .object({
      id: z.string().optional(),
      forked_from_id: z.string().nullish(),
      source: z
        .union([
          z.string(),
          z
            .object({
              subagent: z
                .object({
                  thread_spawn: z.object({ parent_thread_id: z.string().optional() }).optional(),
                })
                .passthrough()
                .optional(),
            })
            .passthrough(),
        ])
        .optional(),
    })
    .passthrough(),
});

class UncertainInput extends Error {
  public constructor(public readonly reason: string) {
    super(reason);
  }
}

const isMissing = (error: object): boolean => 'code' in error && error.code === 'ENOENT';
const isDirectory = async (directory: string): Promise<boolean> => {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if (error instanceof Error && isMissing(error)) return false;
    throw error;
  }
};

const matches = (file: UsageFile, id: string): boolean => {
  const relativeId = file.relative.slice(0, -6).split(path.sep).join('/');
  return relativeId === id || relativeId.endsWith(`-${id}`);
};

/** Owns one read's isolated input files; never changes the original Codex home. */
export class CodexCostInput {
  public async read(
    sessionIds: readonly string[],
    env: NodeJS.ProcessEnv,
    execute: (env: NodeJS.ProcessEnv, restricted: boolean) => Promise<string>,
    logger?: ServerLogger,
  ): Promise<string> {
    const startedAt = Date.now();
    let directory: string | undefined;
    try {
      let scopedEnv: NodeJS.ProcessEnv;
      try {
        const homes =
          env['CODEX_HOME'] === undefined
            ? [path.join(homedir(), '.codex')]
            : env['CODEX_HOME']
                .split(',')
                .map((root) => root.trim())
                .filter(Boolean);
        logger?.debug('local.service.cost_input.discovery_started', {
          sessionCount: sessionIds.length,
        });
        const files = await this.discover(homes);
        const selected = await this.select(files, sessionIds);
        directory = await mkdtemp(path.join(tmpdir(), 'heyhey-cost-'));
        const roots = await this.prepare(directory, homes, selected);
        scopedEnv = { ...env, CODEX_HOME: roots.join(',') };
        logger?.debug('local.service.cost_input.prepared', {
          discoveredFiles: files.length,
          selectedFiles: selected.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        // Unknown filenames/metadata and archival races retain the canonical full
        // reader instead of silently omitting usage or guessing a parent.
        logger?.debug('local.service.cost_input.fallback', {
          reason: error instanceof UncertainInput ? error.reason : 'filesystem_unavailable',
          durationMs: Date.now() - startedAt,
        });
        return await execute(env, false);
      }
      return await execute(scopedEnv, true);
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        logger?.debug('local.service.cost_input.cleaned');
      }
    }
  }

  private async discover(homes: readonly string[]): Promise<UsageFile[]> {
    const files: UsageFile[] = [];
    const directories = new Set<string>();
    for (const [homeIndex, home] of homes.entries()) {
      const seen = new Set<string>();
      let found = false;
      for (const kind of ['sessions', 'archived_sessions'] as const) {
        const root = path.join(home, kind);
        if (!(await isDirectory(root))) continue;
        found = true;
        if (directories.has(root)) continue;
        directories.add(root);
        await this.walk(root, '', homeIndex, kind, seen, files);
      }
      if (!found && !directories.has(home) && (await isDirectory(home))) {
        directories.add(home);
        await this.walk(home, '', homeIndex, 'sessions', seen, files);
      }
    }
    return files;
  }

  private async walk(
    root: string,
    relative: string,
    homeIndex: number,
    kind: UsageFile['kind'],
    seen: Set<string>,
    files: UsageFile[],
  ): Promise<void> {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new UncertainInput('symlink_in_source');
      if (entry.isDirectory()) await this.walk(root, child, homeIndex, kind, seen, files);
      else if (entry.isFile() && child.endsWith('.jsonl') && !seen.has(child)) {
        seen.add(child); // Active copy precedes its duplicate in archived_sessions.
        files.push({ file: path.join(root, child), relative: child, homeIndex, kind });
      }
    }
  }

  private async parent(file: UsageFile): Promise<string | undefined> {
    const handle = await open(file.file, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      if (newline < 0 && bytesRead === buffer.length)
        throw new UncertainInput('metadata_too_large');
      let parsed: ReturnType<typeof metadataSchema.safeParse>;
      try {
        parsed = metadataSchema.safeParse(
          JSON.parse(buffer.subarray(0, newline < 0 ? bytesRead : newline).toString('utf8')),
        );
      } catch {
        throw new UncertainInput('metadata_unrecognized');
      }
      if (!parsed.success) throw new UncertainInput('metadata_unrecognized');
      const { id, forked_from_id, source } = parsed.data.payload;
      // Reverted/renamed rollouts may encode a different ID than their metadata.
      // Filename-only ancestor discovery is not authoritative for those layouts.
      if (!id || !matches(file, id)) throw new UncertainInput('metadata_identity_mismatch');
      const parent =
        forked_from_id ||
        (typeof source === 'object' ? source.subagent?.thread_spawn?.parent_thread_id : undefined);
      return parent && parent !== id ? parent : undefined;
    } finally {
      await handle.close();
    }
  }

  private async select(files: UsageFile[], sessionIds: readonly string[]): Promise<UsageFile[]> {
    const selected = new Set<UsageFile>();
    const add = async (id: string): Promise<void> => {
      const candidates = files.filter((file) => matches(file, id));
      if (!candidates.length) throw new UncertainInput('identity_not_resolved');
      for (const file of candidates) {
        if (selected.has(file)) continue;
        selected.add(file);
        const parent = await this.parent(file);
        if (parent) await add(parent);
      }
    };
    for (const id of sessionIds) await add(id);
    // Preserve the full reader's source/file ordering for duplicate metadata IDs.
    return files.filter((file) => selected.has(file));
  }

  private async prepare(
    directory: string,
    homes: readonly string[],
    files: UsageFile[],
  ): Promise<string[]> {
    const roots: string[] = [];
    for (const [index, home] of homes.entries()) {
      const root = path.join(directory, String(index));
      roots.push(root);
      await mkdir(path.join(root, 'sessions'), { recursive: true });
      try {
        await copyFile(path.join(home, 'config.toml'), path.join(root, 'config.toml'));
      } catch (error) {
        if (!(error instanceof Error && isMissing(error))) throw error;
      }
    }
    for (const file of files) {
      const root = roots[file.homeIndex];
      if (!root) throw new UncertainInput('source_not_resolved');
      const destination = path.join(root, file.kind, file.relative);
      await mkdir(path.dirname(destination), { recursive: true });
      const before = await stat(file.file);
      await copyFile(file.file, destination);
      const after = await stat(file.file);
      if (
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        throw new UncertainInput('source_changed');
      }
    }
    return roots;
  }
}
