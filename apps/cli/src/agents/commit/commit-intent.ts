import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgenticSession } from '../../session/types';
import { canonicalFileChangeKey } from '../../run/file-change-facts';

const exec = promisify(execFile);
export const commitIntentSchema = z.object({
  id: z.string().uuid(),
  service: z.string(),
  branch: z.string(),
  prefix: z.string(),
  summary: z.string(),
  versions: z.record(z.string(), z.string().nullable()),
  implementReportIds: z.array(z.string()),
});
export type CommitIntent = z.infer<typeof commitIntentSchema>;

/** Resolve the immutable commit carrying this attempt's trailer, even after HEAD advances. */
export async function resolveCommitIntent(session: AgenticSession, intent: CommitIntent) {
  const service = session.services.find(({ id }) => id === intent.service);
  if (!service) {
    throw new Error(`Commit intent references missing service ${intent.service}`);
  }
  const cwd = session.worktreeState?.[service.id]?.worktreePath ?? service.path;
  const options = { cwd, maxBuffer: 50 * 1024 * 1024 };
  const reflog = await exec(
    'git',
    ['log', '-g', '--all', '-1', '--format=%H', `--grep-reflog=^${intent.id}:`],
    options,
  );
  // The commit trailer remains discoverable after normal reflog expiry.
  const result = reflog.stdout.trim()
    ? reflog
    : await exec(
        'git',
        [
          'log',
          '--all',
          '--reflog',
          '-1',
          '--format=%H',
          `--grep=^Hey-Hey-Commit-Id: ${intent.id}$`,
        ],
        options,
      );
  const oid = result.stdout.trim();
  if (!oid) {
    return null;
  }
  const { stdout } = await exec(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '--root', '-r', '-z', oid],
    options,
  );
  const files = stdout.split('\0').filter(Boolean).sort();
  const paths = new Set(files);
  const versions = Object.fromEntries(
    Object.entries(intent.versions)
      .filter(([file]) => paths.has(intent.prefix + file))
      .map(([file, version]) => [canonicalFileChangeKey(service.id, file), version]),
  );
  const hash = (await exec('git', ['rev-parse', '--short', oid], options)).stdout.trim();
  return { hash, files, versions };
}

export async function projectPendingCommit(session: AgenticSession) {
  if (session.commitIntent) {
    const outcome = await resolveCommitIntent(session, session.commitIntent);
    if (outcome) {
      session.committedFileVersions = { ...session.committedFileVersions, ...outcome.versions };
    }
  }
}
