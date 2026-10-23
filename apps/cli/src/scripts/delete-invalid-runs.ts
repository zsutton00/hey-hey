/**
 * Delete invalid persisted Runs from the local Run store.
 *
 * Run this while the local CLI server is stopped. The script is a dry run by
 * default. Pass --apply to delete invalid Run metadata and its known sidecars,
 * then rebuild the Run index from valid survivors.
 *
 *   pnpm cleanup:invalid-runs
 *   pnpm cleanup:invalid-runs -- --apply
 *   pnpm cleanup:invalid-runs -- --apply --verbose
 *   HEYHEY_SESSION_DIR=/path pnpm cleanup:invalid-runs -- --apply
 */

import { cleanupInvalidRuns } from '../run-store/cleanup-invalid-runs';
import { parseDeleteInvalidRunsArguments } from './delete-invalid-runs-args';

const main = async (): Promise<void> => {
  const { apply, verbose } = parseDeleteInvalidRunsArguments(process.argv.slice(2));
  const result = await cleanupInvalidRuns({ apply });
  const affectedFileCount = result.invalidRuns.reduce((total, run) => total + run.files.length, 0);

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${result.runsDir}`);
  console.log(`Scanned Run metadata: ${String(result.scannedMetadataCount)}`);
  console.log(`Valid Runs: ${String(result.validRunCount)}`);
  console.log(`Invalid Runs: ${String(result.invalidRunCount)}`);
  console.log(`Incompatible Runs preserved: ${String(result.incompatibleRunCount)}`);
  console.log(`Affected files: ${String(affectedFileCount)}`);

  if (verbose) {
    for (const run of result.invalidRuns) {
      console.log(`  ${run.runId}: ${run.reason} (${String(run.files.length)} file(s))`);
    }
  }

  if (!apply) {
    console.log('No files changed. Stop the CLI server, then re-run with --apply to clean up.');
    return;
  }

  console.log(`Deleted files: ${String(result.deletedFileCount)}`);
  console.log('Rebuilt run-index.json from valid Runs.');
};

void main();
