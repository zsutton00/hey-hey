/**
 * One-off maintenance script: delete daily_session runs from the local store.
 *
 * Daily sessions are recreated by the platform on demand, so wiping the local
 * records is safe — use this to clear a poisoned/stale daily session that the
 * startup trigger keeps re-selecting. Deletes the run metadata, every sidecar
 * (events log, tool-usage, touched-files, idempotency token), and the matching
 * run-index entries.
 *
 * Dry-run by default (prints what it would delete). Pass --apply to delete.
 *
 *   pnpm tsx src/scripts/delete-daily-session-runs.ts            # preview
 *   pnpm tsx src/scripts/delete-daily-session-runs.ts --apply    # delete
 *   HEYHEY_SESSION_DIR=/path pnpm tsx src/scripts/delete-daily-session-runs.ts --apply
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveBaseDir } from '../session/paths';
import { RunIndexStore } from '../run-store/run-index';
import type { AgenticSession } from '../session/types';

const UUID_JSON_RE = /^[0-9a-fA-F-]{36}\.json$/;
const SIDECAR_SUFFIXES = [
  '.events.jsonl',
  '.tool-usage.json',
  '.touched-files.json',
  '.idempotency.json',
];

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const runsDir = path.join(resolveBaseDir(), 'runs');

  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    console.error(`No runs directory at ${runsDir} — nothing to do.`);
    return;
  }

  const dailyRuns: AgenticSession[] = [];
  for (const entry of entries) {
    if (!UUID_JSON_RE.test(entry)) continue;
    const run = JSON.parse(await fs.readFile(path.join(runsDir, entry), 'utf8')) as AgenticSession;
    if (run.promptType === 'daily_session') dailyRuns.push(run);
  }

  console.log(
    `${apply ? 'DELETING' : 'DRY RUN —'} ${String(dailyRuns.length)} daily_session run(s) in ${runsDir}`,
  );
  for (const run of dailyRuns) console.log(`  ${run.agentic_session_id}`);

  if (!apply) {
    console.log('\nNo files changed. Re-run with --apply to delete.');
    return;
  }
  if (dailyRuns.length === 0) return;

  for (const run of dailyRuns) {
    const id = run.agentic_session_id;
    await fs.rm(path.join(runsDir, `${id}.json`), { force: true });
    for (const suffix of SIDECAR_SUFFIXES) {
      await fs.rm(path.join(runsDir, `${id}${suffix}`), { force: true });
    }
  }

  // Drop the deleted runs from the index so lookups don't resolve dangling ids.
  const indexManager = new RunIndexStore();
  const indexPath = path.join(runsDir, 'run-index.json');
  const index = await indexManager.load(indexPath);
  for (const run of dailyRuns) indexManager.removeRun(index, run);
  await indexManager.save(indexPath, index);

  console.log(`\nDeleted ${String(dailyRuns.length)} daily_session run(s).`);
};

void main();
