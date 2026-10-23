import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ChangeWalkthroughExcerpt,
  ChangeWalkthroughReportPayload,
} from '../../shared/api/index';
import { reportErrorSchemas } from '../../shared/api/generated/report-error-schemas';
import type { AgenticSession } from '../../session/types';

const execFileAsync = promisify(execFile);
const parsePayload = addFormats(new Ajv({ strict: false })).compile<ChangeWalkthroughReportPayload>(
  reportErrorSchemas.ChangeWalkthroughReportPayload,
);

export function parseChangeWalkthroughPayload(value: unknown): ChangeWalkthroughReportPayload {
  if (!parsePayload(value)) throw new Error('Invalid CHANGE_WALKTHROUGH payload');
  return value;
}

const contained = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('../') &&
    !path.isAbsolute(relative)
  );
};

export function walkthroughServiceRoot(
  session: Pick<AgenticSession, 'agentic_session_id' | 'services' | 'worktreeState' | 'worktree'>,
  serviceId: string,
): string | null {
  const service = session.services?.find((entry) => entry.id === serviceId);
  if (!service) return null;
  const worktrees = session.worktreeState;
  if (session.worktree?.enabled || (worktrees && Object.keys(worktrees).length > 0)) {
    return worktrees?.[serviceId]?.worktreePath || null;
  }
  return service.path || null;
}

/** Failure belongs to this excerpt; source evidence never changes canonical file membership. */
export async function verifyWalkthroughExcerpt(
  excerpt: ChangeWalkthroughExcerpt,
  root: string | null,
  checkedAt: string,
): Promise<ChangeWalkthroughExcerpt> {
  const unresolved = (reason: string): ChangeWalkthroughExcerpt => ({
    ...excerpt,
    verification: { status: 'UNRESOLVED', reason },
  });
  if (!root) return unresolved('Service workspace unavailable');
  if (
    excerpt.file.includes('\\') ||
    path.isAbsolute(excerpt.file) ||
    excerpt.file.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return unresolved('Source path is not repository-relative');
  }
  if (excerpt.endLine < excerpt.startLine) return unresolved('Invalid inclusive line range');
  try {
    const canonicalRoot = await realpath(root);
    let content: string;
    if (excerpt.sourceVersion.kind === 'GIT') {
      const revision = excerpt.sourceVersion.revision;
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(revision))
        return unresolved('Immutable revision required');
      const commit = await execFileAsync('git', ['rev-parse', '--verify', revision + '^{commit}'], {
        cwd: canonicalRoot,
      });
      if (commit.stdout.trim() !== revision) return unresolved('Revision is not a commit');
      const blob = await execFileAsync('git', ['show', revision + ':' + excerpt.file], {
        cwd: canonicalRoot,
        maxBuffer: 4 * 1024 * 1024,
      });
      content = blob.stdout;
    } else {
      const file = await realpath(path.resolve(canonicalRoot, excerpt.file));
      if (!contained(canonicalRoot, file)) return unresolved('Source escapes Service workspace');
      content = await readFile(file, 'utf8');
    }
    const lines = content.split('\n');
    if (content.endsWith('\n')) lines.pop();
    if (
      excerpt.endLine > lines.length ||
      lines.slice(excerpt.startLine - 1, excerpt.endLine).join('\n') !== excerpt.code
    ) {
      return unresolved('Source lines do not match the inspected excerpt');
    }
    return { ...excerpt, verification: { status: 'VERIFIED', checkedAt } };
  } catch {
    return unresolved('Source file or revision unavailable');
  }
}

export async function verifyChangeWalkthrough(
  payload: ChangeWalkthroughReportPayload,
  session: Pick<AgenticSession, 'agentic_session_id' | 'services' | 'worktreeState' | 'worktree'>,
  checkedAt: string,
): Promise<ChangeWalkthroughReportPayload> {
  return {
    ...payload,
    targetRunId: session.agentic_session_id,
    groups: await Promise.all(
      payload.groups.map(async (group) => ({
        ...group,
        changes: await Promise.all(
          group.changes.map(async (change) => ({
            ...change,
            walkthrough: await Promise.all(
              change.walkthrough.map(async (step) => ({
                ...step,
                excerpt: await verifyWalkthroughExcerpt(
                  step.excerpt,
                  walkthroughServiceRoot(session, step.excerpt.serviceId),
                  checkedAt,
                ),
              })),
            ),
          })),
        ),
      })),
    ),
  };
}
