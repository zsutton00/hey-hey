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

/**
 * Locates the excerpt's file in the current workspace so a reader can inspect it, whether or not
 * its lines still match. Returns null unless the file is repository-relative, exists and stays
 * inside the Service workspace.
 */
export async function resolveWalkthroughWorkspaceFile(
  excerpt: ChangeWalkthroughExcerpt,
  root: string | null,
): Promise<string | null> {
  if (!root || excerpt.sourceVersion.kind !== 'WORKSPACE') return null;
  if (
    excerpt.file.includes('\\') ||
    path.isAbsolute(excerpt.file) ||
    excerpt.file.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  try {
    const canonicalRoot = await realpath(root);
    const file = await realpath(path.resolve(canonicalRoot, excerpt.file));
    return contained(canonicalRoot, file) ? path.resolve(root, excerpt.file) : null;
  } catch {
    return null;
  }
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Review submits the walkthrough without the host-owned `targetRunId` and per-excerpt
 * `verification`. Fill placeholders so the full schema check covers everything the agent
 * does own; `verifyChangeWalkthrough` then overwrites both with host-computed values.
 */
export function withHostOwnedWalkthroughFields(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value['groups'])) return value;
  const placeholder = { status: 'UNRESOLVED', reason: 'Awaiting host verification' };
  const mapItems = (items: unknown, map: (item: Record<string, unknown>) => unknown): unknown =>
    Array.isArray(items) ? items.map((item) => (isRecord(item) ? map(item) : item)) : items;
  return {
    ...value,
    targetRunId: '00000000-0000-4000-8000-000000000000',
    groups: mapItems(value['groups'], (group) => ({
      ...group,
      changes: mapItems(group['changes'], (change) => ({
        ...change,
        walkthrough: mapItems(change['walkthrough'], (step) => ({
          ...step,
          excerpt: isRecord(step['excerpt'])
            ? { ...step['excerpt'], verification: placeholder }
            : step['excerpt'],
        })),
      })),
    })),
  };
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
