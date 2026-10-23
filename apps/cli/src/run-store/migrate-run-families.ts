import path from 'node:path';
import { hasLegacySessions, migrateSessionsToRuns, type MigrationResult } from './migrate-sessions';
import { resolveBaseDir } from '../session/paths';
import { RunStore } from './run-store';
import type {
  RunFamilyMigrationOptions,
  RunFamilyMigrationResult,
  RunStoreInitializationProgress,
  RunStorePaths,
} from './types';

export interface MigrateRunStoreOptions {
  readonly apply?: boolean;
  readonly baseDir?: string;
  readonly onProgress?: (progress: RunStoreInitializationProgress) => void;
}

export interface MigrateRunStoreResult extends RunFamilyMigrationResult {
  readonly applied: boolean;
  readonly runsDir: string;
  readonly legacySessionsDetected: boolean;
  readonly legacyMigration: MigrationResult | null;
}

const pathsFromBaseDir = (baseDir: string): RunStorePaths => ({
  baseDir,
  runsDir: path.join(baseDir, 'runs'),
  indexPath: path.join(baseDir, 'runs', 'run-index.json'),
  preferencesPath: path.join(baseDir, 'preferences.json'),
});

/**
 * Validate and optionally promote every local Run family. The operation is
 * intentionally resumable by idempotence: already-promoted families are
 * validated and skipped, while incompatible families remain untouched.
 */
export const migrateRunStore = async (
  options: MigrateRunStoreOptions = {},
): Promise<MigrateRunStoreResult> => {
  const applied = options.apply ?? false;
  const baseDir = options.baseDir ?? resolveBaseDir();
  const paths = pathsFromBaseDir(baseDir);
  const legacySessionsDetected = await hasLegacySessions(baseDir);
  const legacyMigration = legacySessionsDetected
    ? await migrateSessionsToRuns(path.join(baseDir, 'sessions'), paths, { apply: applied })
    : null;

  const runStore = new RunStore({
    paths,
    ...(options.onProgress ? { onInitializationProgress: options.onProgress } : {}),
  });
  await runStore.initialize({
    migrateLegacySessions: false,
    reconcileIndex: applied,
  });

  const migrationOptions: RunFamilyMigrationOptions = { promote: applied };
  const migration = await runStore.migrateAllRunFamilies(migrationOptions);
  return {
    ...migration,
    applied,
    runsDir: paths.runsDir,
    legacySessionsDetected,
    legacyMigration,
  };
};
