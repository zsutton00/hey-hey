/**
 * Reclaim redundant Run-store data. Dry-run is the default.
 *
 * Always eligible after compatibility verification:
 * - legacy flat files superseded by a valid manifest-owned generation
 * - generation directories not referenced by the current valid manifest
 *
 * Optional retention policy:
 * - completed Runs older than --completed-before, after protecting the newest
 *   --keep-recent-completed Runs
 * - retention scans only manifests and metadata; apply revalidates selected
 *   families immediately before deletion
 *
 * Stop the local CLI server before using --apply.
 *
 *   pnpm cleanup:run-store
 *   pnpm cleanup:run-store -- --apply
 *   pnpm cleanup:run-store -- --completed-before=2026-07-01 --keep-recent-completed=100
 */

import { cullRunStore } from '../run-store/cull-run-store';
import { parseCullRunStoreArguments } from './cull-run-store-args';

const formatBytes = (bytes: number): string => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

const main = async (): Promise<void> => {
  const args = parseCullRunStoreArguments(process.argv.slice(2));
  let lastReportedFamily = 0;
  const result = await cullRunStore({
    apply: args.apply,
    ...(args.completedBefore ? { completedBefore: args.completedBefore } : {}),
    keepRecentCompleted: args.keepRecentCompleted,
    retentionOnly: Boolean(args.completedBefore),
    onProgress: (progress) => {
      if (
        progress.operation !== 'run_family' ||
        progress.status !== 'completed' ||
        !progress.familyIndex ||
        !progress.familyCount
      ) {
        return;
      }
      if (
        args.verbose ||
        progress.familyIndex === progress.familyCount ||
        progress.familyIndex - lastReportedFamily >= 100
      ) {
        lastReportedFamily = progress.familyIndex;
        console.log(
          `Verified selected Run families: ${String(progress.familyIndex)}/${String(progress.familyCount)}`,
        );
      }
    },
  });

  console.log(`${args.apply ? 'APPLY' : 'DRY RUN'}: ${result.runsDir}`);
  console.log(
    `${args.completedBefore ? 'Metadata-readable' : 'Compatible'} Runs: ${String(result.compatibleRunCount)}`,
  );
  console.log(
    `${args.completedBefore ? 'Unverified or incompatible' : 'Incompatible'} Runs preserved: ${String(result.incompatibleRunCount)}`,
  );
  console.log(`Redundant legacy files: ${String(result.redundantLegacyFileCount)}`);
  console.log(`Stale generations: ${String(result.staleGenerationCount)}`);
  console.log(`Expired completed Runs: ${String(result.expiredCompletedRunCount)}`);
  console.log(`Expired staged attachments: ${String(result.expiredStagedAttachmentCount)}`);
  console.log(`Planned paths: ${String(result.plannedPathCount)}`);
  console.log(`Planned logical bytes: ${formatBytes(result.plannedLogicalBytes)}`);

  if (args.verbose) {
    for (const entry of result.entries) {
      console.log(
        `  ${entry.reason}: ${entry.reason === 'expired_staged_attachment' ? entry.attachmentId : entry.runId} (${String(entry.paths.length)} path(s), ${formatBytes(entry.logicalBytes)})`,
      );
    }
  }

  if (!args.apply) {
    console.log('No files changed. Stop the CLI server, review this preview, then add --apply.');
    return;
  }
  console.log(`Deleted paths: ${String(result.deletedPathCount)}`);
  console.log(`Deleted logical bytes: ${formatBytes(result.deletedLogicalBytes)}`);
};

void main();
