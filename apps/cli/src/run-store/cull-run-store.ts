import { isAttachmentRunId } from '../server/run-attachment-store';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isRunFamilyManifestFileName,
  isRunMetadataFileName,
  legacyRunFamilyMemberFileName,
  RUN_FAMILY_MEMBERS,
  runFamilyFileNames,
  runIdFromFamilyManifestFileName,
  runIdFromMetadataFileName,
} from './run-files';
import { parsePersistedRunFamilyManifest } from './run-family';
import { resolveBaseDir } from '../session/paths';
import { RunStore } from './run-store';
import type { AgenticSession } from '../session/types';
import type { RunStoreInitializationProgress, RunStorePaths } from './types';

type RunStoreCullReason = 'redundant_legacy_file' | 'stale_generation' | 'expired_completed_run';

interface RunCullEntry {
  readonly runId: string;
  readonly reason: RunStoreCullReason;
  readonly paths: readonly string[];
  readonly logicalBytes: number;
  readonly updatedAt: string | null;
}

interface StagedAttachmentCullEntry {
  readonly attachmentId: string;
  readonly reason: 'expired_staged_attachment';
  readonly paths: readonly string[];
  readonly logicalBytes: number;
  readonly updatedAt: string;
}

type RunStoreCullEntry = RunCullEntry | StagedAttachmentCullEntry;

export interface CullRunStoreOptions {
  readonly apply?: boolean;
  readonly baseDir?: string;
  readonly completedBefore?: Date;
  readonly keepRecentCompleted?: number;
  readonly onProgress?: (progress: RunStoreInitializationProgress) => void;
  readonly retentionOnly?: boolean;
  readonly runStore?: RunStore;
}

export interface CullRunStoreResult {
  readonly applied: boolean;
  readonly runsDir: string;
  readonly compatibleRunCount: number;
  readonly incompatibleRunCount: number;
  readonly redundantLegacyFileCount: number;
  readonly staleGenerationCount: number;
  readonly expiredCompletedRunCount: number;
  readonly expiredStagedAttachmentCount: number;
  readonly plannedPathCount: number;
  readonly plannedLogicalBytes: number;
  readonly deletedPathCount: number;
  readonly deletedLogicalBytes: number;
  readonly entries: readonly RunStoreCullEntry[];
}

const resolvePaths = (baseDir: string): RunStorePaths => {
  const runsDir = path.join(baseDir, 'runs');
  return {
    baseDir,
    runsDir,
    indexPath: path.join(runsDir, 'run-index.json'),
    preferencesPath: path.join(baseDir, 'preferences.json'),
  };
};

const pathLogicalBytes = async (targetPath: string): Promise<number> => {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fs.readdir(targetPath, { withFileTypes: true })) {
    total += await pathLogicalBytes(path.join(targetPath, entry.name));
  }
  return total;
};

const assertCullTarget = (runsDir: string, targetPath: string): void => {
  const relativePath = path.relative(runsDir, targetPath);
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Refusing to cull a path outside the Run store: ${targetPath}`);
  }
};

const existingPaths = async (paths: readonly string[]): Promise<string[]> => {
  const existing: string[] = [];
  for (const candidate of paths) {
    try {
      await fs.lstat(candidate);
      existing.push(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return existing;
};

const totalLogicalBytes = async (paths: readonly string[]): Promise<number> => {
  let total = 0;
  for (const targetPath of paths) total += await pathLogicalBytes(targetPath);
  return total;
};

const completedRunsToCull = (
  runs: readonly AgenticSession[],
  completedBefore: Date | undefined,
  keepRecentCompleted: number,
): Set<string> => {
  if (!completedBefore) return new Set();
  const completed = runs
    .filter((run) => run.status === 'complete')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const protectedRunIds = new Set(
    completed.slice(0, keepRecentCompleted).map((run) => run.agentic_session_id),
  );
  return new Set(
    completed
      .filter(
        (run) =>
          !protectedRunIds.has(run.agentic_session_id) &&
          Date.parse(run.updatedAt) < completedBefore.getTime(),
      )
      .map((run) => run.agentic_session_id),
  );
};

const staleGenerationPaths = async (
  runsDir: string,
  runId: string,
  currentGenerationId: string,
): Promise<string[]> => {
  const familyRoot = path.join(runsDir, '.run-families', runId);
  try {
    const entries = await fs.readdir(familyRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== currentGenerationId)
      .map((entry) => path.join(familyRoot, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const removeEntries = async (
  runsDir: string,
  entries: readonly RunStoreCullEntry[],
): Promise<void> => {
  for (const entry of entries) {
    for (const targetPath of entry.paths) {
      assertCullTarget(runsDir, targetPath);
      await fs.rm(targetPath, { recursive: true, force: true });
    }
  }
};

// Staging contains only direct regular files. Preserve unexpected layouts and links.
const inspectExpiredStaging = async (
  stagingRoot: string,
  attachmentId: string,
  completedBefore: Date,
): Promise<StagedAttachmentCullEntry | null> => {
  if (!isAttachmentRunId(attachmentId)) return null;
  const directory = path.join(stagingRoot, attachmentId);
  assertCullTarget(stagingRoot, directory);
  try {
    if (!(await fs.lstat(stagingRoot)).isDirectory()) return null;
    if (!(await fs.lstat(directory)).isDirectory()) return null;
    const files = await fs.readdir(directory, { withFileTypes: true });
    if (files.length === 0) return null;
    let logicalBytes = 0;
    let newestMtime = -Infinity;
    for (const file of files) {
      const stat = await fs.lstat(path.join(directory, file.name));
      if (!stat.isFile() || stat.mtimeMs >= completedBefore.getTime()) return null;
      logicalBytes += stat.size;
      newestMtime = Math.max(newestMtime, stat.mtimeMs);
    }
    return {
      attachmentId,
      reason: 'expired_staged_attachment',
      paths: [directory],
      logicalBytes,
      updatedAt: new Date(newestMtime).toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return null;
    console.error('run.retention.staging_entry_failed', { attachmentId });
    return null;
  }
};

const discoverExpiredStaging = async (
  stagingRoot: string,
  completedBefore: Date | undefined,
): Promise<StagedAttachmentCullEntry[]> => {
  if (!completedBefore) return [];
  let names: string[];
  try {
    if (!(await fs.lstat(stagingRoot)).isDirectory()) return [];
    names = await fs.readdir(stagingRoot);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      console.error('run.retention.staging_scan_failed');
    return [];
  }
  const entries: StagedAttachmentCullEntry[] = [];
  for (const name of names) {
    const entry = await inspectExpiredStaging(stagingRoot, name, completedBefore);
    if (entry) entries.push(entry);
  }
  return entries;
};

export const cullRunStore = async (
  options: CullRunStoreOptions = {},
): Promise<CullRunStoreResult> => {
  const applied = options.apply ?? false;
  const keepRecentCompleted = options.keepRecentCompleted ?? 0;
  if (!Number.isInteger(keepRecentCompleted) || keepRecentCompleted < 0) {
    throw new Error('keepRecentCompleted must be a non-negative integer.');
  }
  if (options.completedBefore && Number.isNaN(options.completedBefore.getTime())) {
    throw new Error('completedBefore must be a valid date.');
  }

  const paths = resolvePaths(options.baseDir ?? resolveBaseDir());
  let directoryEntries: string[];
  let runsDirectoryExists = true;
  try {
    directoryEntries = await fs.readdir(paths.runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    directoryEntries = [];
    runsDirectoryExists = false;
  }

  const incompatibleRunIds = new Set<string>();
  const runStore =
    options.runStore ??
    new RunStore({
      paths,
      onCompatibilityDiagnostic: (diagnostic) => {
        if (diagnostic.familyId.startsWith('run:')) {
          incompatibleRunIds.add(diagnostic.familyId.slice('run:'.length));
        }
      },
      ...(options.onProgress ? { onInitializationProgress: options.onProgress } : {}),
    });
  if (runsDirectoryExists && !options.runStore && !options.retentionOnly) {
    await runStore.initialize({ promoteCompatibility: false, reconcileIndex: false });
  }
  const retentionScan = options.retentionOnly ? await runStore.scanRunMetadataForRetention() : null;
  for (const runId of retentionScan?.preservedRunIds ?? []) incompatibleRunIds.add(runId);
  const compatibleRuns: AgenticSession[] = retentionScan ? [...retentionScan.runs] : [];
  if (!retentionScan) {
    const runIds = [
      ...new Set([
        ...directoryEntries.filter(isRunMetadataFileName).map(runIdFromMetadataFileName),
        ...directoryEntries
          .filter(isRunFamilyManifestFileName)
          .map(runIdFromFamilyManifestFileName),
      ]),
    ];
    for (const runId of runIds) {
      try {
        const run = await runStore.inspectRunFamily(runId);
        if (run) compatibleRuns.push(run);
      } catch {
        // The selected-family reader records structured compatibility diagnostics.
      }
    }
  }
  const compatibleRunById = new Map(
    compatibleRuns.map((run) => [run.agentic_session_id, run] as const),
  );
  const expiredRunIds = completedRunsToCull(
    compatibleRuns,
    options.completedBefore,
    keepRecentCompleted,
  );
  const stagingRoot = path.join(paths.baseDir, 'run-attachments-staging');
  const entries: RunStoreCullEntry[] = await discoverExpiredStaging(
    stagingRoot,
    options.completedBefore,
  );
  const scheduledCompletedRunIds = new Set<string>();

  for (const manifestFileName of directoryEntries.filter(isRunFamilyManifestFileName)) {
    const runId = runIdFromFamilyManifestFileName(manifestFileName);
    const run = compatibleRunById.get(runId);
    if (!run || incompatibleRunIds.has(runId)) continue;
    try {
      const manifestPath = path.join(paths.runsDir, manifestFileName);
      const manifest = parsePersistedRunFamilyManifest(
        runId,
        await fs.readFile(manifestPath, 'utf8'),
      );
      const familyRoot = path.join(paths.runsDir, '.run-families', runId);

      if (expiredRunIds.has(runId)) {
        const targets = await existingPaths([
          manifestPath,
          familyRoot,
          path.join(paths.baseDir, 'run-attachments', runId),
          ...runFamilyFileNames(runId).map((fileName) => path.join(paths.runsDir, fileName)),
        ]);
        entries.push({
          runId,
          reason: 'expired_completed_run',
          paths: targets,
          logicalBytes: await totalLogicalBytes(targets),
          updatedAt: run.updatedAt,
        });
        scheduledCompletedRunIds.add(runId);
        continue;
      }

      const legacyPaths = options.retentionOnly
        ? []
        : await existingPaths(
            RUN_FAMILY_MEMBERS.map((member) =>
              path.join(paths.runsDir, legacyRunFamilyMemberFileName(runId, member)),
            ),
          );
      if (legacyPaths.length > 0) {
        entries.push({
          runId,
          reason: 'redundant_legacy_file',
          paths: legacyPaths,
          logicalBytes: await totalLogicalBytes(legacyPaths),
          updatedAt: run.updatedAt,
        });
      }

      for (const stalePath of options.retentionOnly
        ? []
        : await staleGenerationPaths(paths.runsDir, runId, manifest.generationId)) {
        entries.push({
          runId,
          reason: 'stale_generation',
          paths: [stalePath],
          logicalBytes: await pathLogicalBytes(stalePath),
          updatedAt: run.updatedAt,
        });
      }
    } catch {
      scheduledCompletedRunIds.add(runId);
      console.error('run.retention.preview_failed', { runId });
    }
  }

  for (const runId of expiredRunIds) {
    if (scheduledCompletedRunIds.has(runId)) continue;
    const run = compatibleRunById.get(runId);
    if (!run) continue;
    try {
      const targets = await existingPaths([
        path.join(paths.baseDir, 'run-attachments', runId),
        path.join(paths.runsDir, '.run-families', runId),
        ...runFamilyFileNames(runId).map((fileName) => path.join(paths.runsDir, fileName)),
      ]);
      if (targets.length === 0) continue;
      entries.push({
        runId,
        reason: 'expired_completed_run',
        paths: targets,
        logicalBytes: await totalLogicalBytes(targets),
        updatedAt: run.updatedAt,
      });
      scheduledCompletedRunIds.add(runId);
    } catch {
      console.error('run.retention.preview_failed', { runId });
    }
  }

  const plannedPathCount = entries.reduce((total, entry) => total + entry.paths.length, 0);
  const plannedLogicalBytes = entries.reduce((total, entry) => total + entry.logicalBytes, 0);
  let deletedPathCount = 0;
  let deletedLogicalBytes = 0;
  let deletedRunCount = 0;
  let deletedStagedAttachmentCount = 0;
  if (applied) {
    const ordinaryEntries = entries.filter(
      (entry) =>
        entry.reason !== 'expired_completed_run' && entry.reason !== 'expired_staged_attachment',
    );
    await removeEntries(paths.runsDir, ordinaryEntries);
    deletedPathCount += ordinaryEntries.reduce((total, entry) => total + entry.paths.length, 0);
    deletedLogicalBytes += ordinaryEntries.reduce((total, entry) => total + entry.logicalBytes, 0);
    if (options.completedBefore) {
      for (const entry of entries) {
        if (entry.reason !== 'expired_staged_attachment') continue;
        const eligible = await inspectExpiredStaging(
          stagingRoot,
          entry.attachmentId,
          options.completedBefore,
        );
        if (!eligible) continue;
        try {
          await fs.rm(eligible.paths[0]!, { recursive: true });
          deletedPathCount += eligible.paths.length;
          deletedLogicalBytes += eligible.logicalBytes;
          deletedStagedAttachmentCount += 1;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
          console.error('run.retention.staging_delete_failed', {
            attachmentId: entry.attachmentId,
          });
        }
      }
      const deletion = await runStore.deleteCompletedFamiliesForRetention({
        runIds: entries
          .filter(
            (candidate): candidate is RunCullEntry => candidate.reason === 'expired_completed_run',
          )
          .map((entry) => entry.runId),
        completedBefore: options.completedBefore,
      });
      deletedRunCount += deletion.deletedRunCount;
      deletedPathCount += deletion.pathCount;
      deletedLogicalBytes += deletion.logicalBytes;
    }
  }

  return {
    applied,
    runsDir: paths.runsDir,
    compatibleRunCount: compatibleRuns.length,
    incompatibleRunCount: incompatibleRunIds.size,
    redundantLegacyFileCount: entries
      .filter((entry) => entry.reason === 'redundant_legacy_file')
      .reduce((total, entry) => total + entry.paths.length, 0),
    staleGenerationCount: entries.filter((entry) => entry.reason === 'stale_generation').length,
    expiredCompletedRunCount: applied
      ? deletedRunCount
      : entries.filter((entry) => entry.reason === 'expired_completed_run').length,
    expiredStagedAttachmentCount: applied
      ? deletedStagedAttachmentCount
      : entries.filter((entry) => entry.reason === 'expired_staged_attachment').length,
    plannedPathCount,
    plannedLogicalBytes,
    deletedPathCount,
    deletedLogicalBytes,
    entries,
  };
};
