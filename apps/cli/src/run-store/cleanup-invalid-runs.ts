import fs from 'node:fs/promises';
import path from 'node:path';
import { RunIndexStore } from './run-index';
import { resolveBaseDir } from '../session/paths';
import { RunStore } from './run-store';
import {
  isRunFamilyManifestFileName,
  isRunMetadataFileName,
  runFamilyFileNames,
  runIdFromFamilyManifestFileName,
  runIdFromMetadataFileName,
} from './run-files';
import type { RunStorePaths } from './types';

interface InvalidRunCleanupEntry {
  runId: string;
  reason: string;
  files: string[];
}

export interface InvalidRunCleanupResult {
  applied: boolean;
  runsDir: string;
  scannedMetadataCount: number;
  validRunCount: number;
  invalidRunCount: number;
  incompatibleRunCount: number;
  deletedFileCount: number;
  invalidRuns: InvalidRunCleanupEntry[];
}

export interface CleanupInvalidRunsOptions {
  apply?: boolean;
  baseDir?: string;
}

const DELETE_BATCH_SIZE = 64;

const resolvePaths = (baseDir: string): RunStorePaths => {
  const runsDir = path.join(baseDir, 'runs');
  return {
    baseDir,
    runsDir,
    indexPath: path.join(runsDir, 'run-index.json'),
    preferencesPath: path.join(baseDir, 'preferences.json'),
  };
};

const deleteFilesInBatches = async (runsDir: string, files: string[]): Promise<void> => {
  for (let offset = 0; offset < files.length; offset += DELETE_BATCH_SIZE) {
    const batch = files.slice(offset, offset + DELETE_BATCH_SIZE);
    await Promise.all(
      batch.map((fileName) => fs.rm(path.join(runsDir, fileName), { force: true })),
    );
  }
};

export const cleanupInvalidRuns = async (
  options: CleanupInvalidRunsOptions = {},
): Promise<InvalidRunCleanupResult> => {
  const applied = options.apply ?? false;
  const paths = resolvePaths(options.baseDir ?? resolveBaseDir());

  let entries: string[];
  try {
    entries = await fs.readdir(paths.runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        applied,
        runsDir: paths.runsDir,
        scannedMetadataCount: 0,
        validRunCount: 0,
        invalidRunCount: 0,
        incompatibleRunCount: 0,
        deletedFileCount: 0,
        invalidRuns: [],
      };
    }
    throw error;
  }

  const entrySet = new Set(entries);
  const invalidReasons = new Map<string, string>();
  const incompatibleRunIds = new Set<string>();
  const runStore = new RunStore({
    paths,
    onInvalidRunMetadata: ({ runId, error }) => {
      invalidReasons.set(runId, error.message);
    },
    onCompatibilityDiagnostic: (diagnostic) => {
      if (diagnostic.familyId.startsWith('run:')) {
        incompatibleRunIds.add(diagnostic.familyId.slice('run:'.length));
      }
    },
  });
  await runStore.initialize({ promoteCompatibility: false, reconcileIndex: false });
  const runIds = [
    ...new Set([
      ...entries.filter(isRunMetadataFileName).map(runIdFromMetadataFileName),
      ...entries.filter(isRunFamilyManifestFileName).map(runIdFromFamilyManifestFileName),
    ]),
  ];
  const validRuns = [];
  for (const runId of runIds) {
    try {
      const run = await runStore.inspectRunFamily(runId);
      if (run) validRuns.push(run);
    } catch {
      // Compatibility diagnostics are recorded by the selected-family reader.
    }
  }
  const invalidRuns = runIds.flatMap((runId) => {
    if (incompatibleRunIds.has(runId)) return [];
    const reason = invalidReasons.get(runId);
    if (!reason) return [];
    return [
      {
        runId,
        reason,
        files: runFamilyFileNames(runId).filter((candidate) => entrySet.has(candidate)),
      },
    ];
  });
  const filesToDelete = invalidRuns.flatMap((run) => run.files);

  if (applied) {
    await deleteFilesInBatches(paths.runsDir, filesToDelete);
    const indexStore = new RunIndexStore();
    const rebuiltIndex = indexStore.rebuildFromRuns(validRuns);
    await indexStore.save(paths.indexPath, rebuiltIndex);
  }

  return {
    applied,
    runsDir: paths.runsDir,
    scannedMetadataCount: runIds.length,
    validRunCount: validRuns.length,
    invalidRunCount: invalidRuns.length,
    incompatibleRunCount: incompatibleRunIds.size,
    deletedFileCount: applied ? filesToDelete.length : 0,
    invalidRuns,
  };
};
