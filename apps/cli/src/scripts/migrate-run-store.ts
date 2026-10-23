/**
 * Validate and compact every persisted Run family. Dry-run is the default.
 *
 * Stop the local CLI server before using --apply.
 *
 *   pnpm migrate:run-store
 *   pnpm migrate:run-store -- --apply
 *   pnpm migrate:run-store -- --apply --verbose
 *   HEYHEY_SESSION_DIR=/path pnpm migrate:run-store -- --apply
 */

import { migrateRunStore } from '../run-store/migrate-run-families';
import { parseMigrateRunStoreArguments } from './migrate-run-store-args';

const main = async (): Promise<void> => {
  const args = parseMigrateRunStoreArguments(process.argv.slice(2));
  let lastReportedFamily = 0;
  const result = await migrateRunStore({
    apply: args.apply,
    onProgress: (progress) => {
      if (
        progress.operation !== 'run_family' ||
        progress.status === 'started' ||
        !progress.familyIndex ||
        !progress.familyCount
      ) {
        return;
      }
      if (
        args.verbose ||
        progress.status === 'incompatible' ||
        progress.familyIndex === progress.familyCount ||
        progress.familyIndex - lastReportedFamily >= 100
      ) {
        lastReportedFamily = progress.familyIndex;
        console.log(
          `Processed Run families: ${String(progress.familyIndex)}/${String(progress.familyCount)}`,
        );
      }
    },
  });

  console.log(`${args.apply ? 'APPLY' : 'DRY RUN'}: ${result.runsDir}`);
  if (result.legacySessionsDetected) {
    const legacyMigration = result.legacyMigration;
    console.log(
      `${args.apply ? 'Imported' : 'Would import'} legacy Runs: ${String(legacyMigration?.migratedRunCount ?? 0)}`,
    );
    console.log(
      `${args.apply ? 'Imported' : 'Would import'} legacy event files: ${String(legacyMigration?.migratedEventFileCount ?? 0)}`,
    );
    if (legacyMigration && legacyMigration.skippedCorruptedSessions.length > 0) {
      console.log(
        `Corrupted legacy sessions preserved: ${String(legacyMigration.skippedCorruptedSessions.length)}`,
      );
    }
  }
  console.log(`Run families scanned: ${String(result.scannedRunCount)}`);
  console.log(
    `${args.apply ? 'Compacted' : 'Would compact'} Run families: ${String(result.migratedRunCount)}`,
  );
  console.log(`Already canonical: ${String(result.currentRunCount)}`);
  console.log(`Incompatible or failed, preserved: ${String(result.incompatibleRunCount)}`);
  console.log(`Missing families: ${String(result.absentRunCount)}`);

  if (args.verbose) {
    for (const entry of result.entries) {
      const diagnostic = entry.diagnostic?.errorMessage;
      console.log(`  ${entry.status}: ${entry.runId}${diagnostic ? ` — ${diagnostic}` : ''}`);
    }
  }

  if (!args.apply) {
    console.log(
      'No Run-family authority changed. Stop the CLI server, review this preview, then add --apply.',
    );
    return;
  }

  console.log(
    'Migration complete. Legacy source files remain until reviewed by cleanup:run-store.',
  );
};

void main();
